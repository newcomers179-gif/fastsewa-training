/**
 * Password hashing.
 *
 * New hashes use scrypt (built into Node, memory-hard, runs on the libuv
 * thread-pool so it never blocks the event loop). The previous implementation
 * used the pure-JavaScript `bcryptjs` at cost 12, which burns the single
 * Node.js thread for ~250 ms per login — a handful of simultaneous logins
 * froze the whole API. Existing bcrypt hashes keep working and are upgraded
 * transparently on the user's next successful login.
 *
 * Stored format:  scrypt$<log2 N>$<r>$<p>$<salt b64url>$<key b64url>
 * The parameters live inside the hash, so they can be raised later; verify()
 * reports `needsRehash` when a stored hash is weaker than the current setting.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import bcrypt from "bcryptjs";
import { err } from "../errors";

const LOG_N = 15; // N = 32768 → ~32 MiB and ~100 ms on a 2-vCPU server
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const MAX_MEM = 128 * 1024 * 1024;

/** Bound the number of simultaneous hash computations so a login flood cannot exhaust CPU/memory. */
class Limiter {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private readonly maxActive: number,
    private readonly maxQueue: number
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxActive) {
      if (this.waiting.length >= this.maxQueue) throw err("SERVER_BUSY");
      // Ownership of the slot is handed over by release(), so `active` stays constant.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const limiter = new Limiter(Math.max(2, Number(process.env.PASSWORD_HASH_CONCURRENCY) || 3), 200);

function scryptAsync(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, opts, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** NFKC so the same password typed on different keyboards/IMEs (common with Hindi input) hashes identically. */
const normalize = (password: string) => password.normalize("NFKC");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await limiter.run(() =>
    scryptAsync(normalize(password), salt, KEY_LEN, { N: 2 ** LOG_N, r: R, p: P, maxmem: MAX_MEM })
  );
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export interface VerifyResult {
  valid: boolean;
  /** The stored hash is legacy (bcrypt) or uses weaker parameters than the current ones. */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string): Promise<VerifyResult> {
  if (stored.startsWith("scrypt$")) {
    const [, logN, r, p, saltB64, keyB64] = stored.split("$");
    const n = 2 ** Number(logN);
    const rr = Number(r);
    const pp = Number(p);
    if (!Number.isInteger(n) || !Number.isInteger(rr) || !Number.isInteger(pp) || !saltB64 || !keyB64) {
      return { valid: false, needsRehash: false };
    }
    // Refuse absurd parameters from a corrupted row rather than allocating gigabytes.
    if (128 * n * rr > MAX_MEM || pp > 16) return { valid: false, needsRehash: false };
    const expected = Buffer.from(keyB64, "base64url");
    const key = await limiter.run(() =>
      scryptAsync(normalize(password), Buffer.from(saltB64, "base64url"), expected.length, {
        N: n,
        r: rr,
        p: pp,
        maxmem: MAX_MEM,
      })
    );
    const valid = key.length === expected.length && timingSafeEqual(key, expected);
    const weaker = Number(logN) < LOG_N || rr < R || pp < P;
    return { valid, needsRehash: valid && weaker };
  }

  if (/^\$2[aby]\$/.test(stored)) {
    // Legacy bcrypt (bcryptjs is pure JS: slow, so it shares the same concurrency gate).
    const valid = await limiter.run(() => bcrypt.compare(password, stored).catch(() => false));
    return { valid, needsRehash: valid };
  }

  return { valid: false, needsRehash: false };
}

let dummyHash: Promise<string> | null = null;

/**
 * Burns the same CPU time as a real verification. Called when the username
 * does not exist so response time cannot be used to discover valid usernames.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(12).toString("base64url"));
  await verifyPassword(password, await dummyHash);
}
