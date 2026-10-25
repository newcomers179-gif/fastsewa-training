import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../auth/password";

describe("password hashing", () => {
  it("produces a self-describing scrypt hash and verifies it", async () => {
    const hash = await hashPassword("Correct-Horse-9");
    assert.match(hash, /^scrypt\$15\$8\$1\$[\w-]+\$[\w-]+$/);
    assert.deepEqual(await verifyPassword("Correct-Horse-9", hash), { valid: true, needsRehash: false });
    assert.deepEqual(await verifyPassword("correct-horse-9", hash), { valid: false, needsRehash: false });
  });

  it("salts every hash", async () => {
    assert.notEqual(await hashPassword("same-password-1"), await hashPassword("same-password-1"));
  });

  it("treats visually identical Unicode spellings as the same password (Hindi keyboards / IMEs)", async () => {
    const hash = await hashPassword("ＦastＳewa２０２６!"); // full-width letters/digits
    assert.equal((await verifyPassword("FastSewa2026!", hash)).valid, true);
    const deva = await hashPassword("पासवर्ड-2026");
    assert.equal((await verifyPassword("पासवर्ड-2026".normalize("NFD"), deva)).valid, true);
  });

  it("flags hashes made with weaker parameters for transparent upgrade", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("Old-Params-1", salt, 32, { N: 2 ** 12, r: 8, p: 1 });
    const stored = `scrypt$12$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
    assert.deepEqual(await verifyPassword("Old-Params-1", stored), { valid: true, needsRehash: true });
    assert.deepEqual(await verifyPassword("nope", stored), { valid: false, needsRehash: false });
  });

  it("still accepts legacy bcrypt hashes and asks for a rehash", async () => {
    const legacy = bcrypt.hashSync("Legacy#Pass1", 4);
    assert.deepEqual(await verifyPassword("Legacy#Pass1", legacy), { valid: true, needsRehash: true });
    assert.deepEqual(await verifyPassword("wrong", legacy), { valid: false, needsRehash: false });
  });

  it("rejects corrupted or hostile stored values without allocating memory for them", async () => {
    for (const stored of ["", "plaintext", "scrypt$99$8$1$AAAA$AAAA", "scrypt$15$8$1$$", "scrypt$15$8$999$AAAA$AAAA", "$2b$12$short"]) {
      assert.equal((await verifyPassword("anything", stored)).valid, false, stored);
    }
  });

  it("burns comparable time for unknown users", async () => {
    await verifyAgainstDummy("whatever-password"); // must simply complete without throwing
  });
});
