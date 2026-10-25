/**
 * Create an admin (or trainer) account, or recover a locked-out one.
 *
 *   npm run create-admin -- <username> ["Display Name"] [--role admin|trainer] [--generate]
 *   npm run create-admin -- --reset <username>
 *
 * The password is never taken from the command line (it would end up in shell history and
 * `ps`). Provide it in ADMIN_PASSWORD, pipe it on stdin, or type it at the hidden prompt.
 *   --generate   create the account with a random one-time password that must be changed at
 *                the first sign-in, and print it once
 *   --reset      give an existing account a new one-time password, sign it out everywhere
 *                (the way back in when the only admin forgot the password)
 *
 * In the production image: `node dist/create-admin.js …`
 */
import { createInterface } from "node:readline";
import { eq } from "drizzle-orm";
import { users } from "../shared/schema";
import { db, closeDatabase } from "../server/db";
import { hashPassword } from "../server/auth/password";
import { assertPasswordAllowed, cleanUsername, generateTemporaryPassword, setTemporaryPassword, STAFF_TEMP_PASSWORD_LENGTH } from "../server/services/accounts";

async function readSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    const line = await new Promise<string>((resolve) => rl.once("line", resolve));
    rl.close();
    return line;
  }
  process.stdout.write(question);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buffer = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") process.exit(130); // Ctrl-C
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(buffer);
          return;
        }
        buffer = ch === "\u007f" || ch === "\b" ? buffer.slice(0, -1) : buffer + ch;
      }
    };
    stdin.on("data", onData);
  });
}

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--generate" || a === "--reset") flags.add(a);
    else if (a === "--role") values.role = argv[++i] ?? "";
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  return { flags, role: values.role, positional };
}

async function main(): Promise<void> {
  const { flags, role, positional } = parseArgs(process.argv.slice(2));

  if (flags.has("--reset")) {
    const username = cleanUsername(positional[0] ?? "");
    const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.username, username)).limit(1);
    if (!user) throw new Error(`No account named "${username}"`);
    const temporary = await setTemporaryPassword(user.id, db, user.role === "worker" ? undefined : STAFF_TEMP_PASSWORD_LENGTH);
    console.log(`\nOne-time password for ${username}: ${temporary}`);
    console.log("It works once; the account must choose a new password at the next sign-in. All sessions were signed out.\n");
    return;
  }

  if (positional.length === 0) {
    throw new Error('Usage: create-admin <username> ["Display Name"] [--role admin|trainer] [--generate]   |   create-admin --reset <username>');
  }
  const username = cleanUsername(positional[0]);
  const displayName = (positional[1] ?? "Admin").trim() || "Admin";
  const accountRole = role || "admin";
  if (accountRole !== "admin" && accountRole !== "trainer") throw new Error('--role must be "admin" or "trainer"');

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (existing) throw new Error(`The username "${username}" is already taken`);

  let password: string;
  const generated = flags.has("--generate");
  if (generated) password = generateTemporaryPassword(STAFF_TEMP_PASSWORD_LENGTH);
  else {
    password = process.env.ADMIN_PASSWORD ?? (await readSecret("Password (min 12 characters): "));
    assertPasswordAllowed(password, username, accountRole);
  }

  const [created] = await db
    .insert(users)
    .values({
      username,
      passwordHash: await hashPassword(password),
      displayName,
      role: accountRole,
      mustChangePassword: generated,
    })
    .returning({ id: users.id, username: users.username });

  console.log(`\n✅ ${accountRole} created: ${created.username}`);
  if (generated) console.log(`One-time password: ${password}\nIt must be changed at the first sign-in.\n`);
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    const e = error as { message?: string; code?: string; details?: unknown };
    console.error(`\n❌ ${e.message ?? error}`);
    if (e.code) console.error(`   (${e.code})`);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
