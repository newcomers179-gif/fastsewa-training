// Must stay the first import: it switches the limiters back on before the configuration is read.
import "./limitsOn";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildLimiters } from "../middleware/rateLimit";
import { createUser, resetDatabase, shutdown, signIn, startServer, STRONG_PASSWORD, uniq, type Api, type TestServer } from "./helpers";

before(async () => {
  await resetDatabase();
});
after(shutdown);

/** Every test gets its own server (and so its own counters): all requests come from 127.0.0.1. */
async function withServer(run: (api: Api) => Promise<void>): Promise<void> {
  const server: TestServer = await startServer(buildLimiters());
  try {
    await run(server.api);
  } finally {
    await server.close();
  }
}

const wrongLogin = (api: Api, username: string) => api.post("/api/v1/auth/login", { username, password: "Wrong#Pass-1234" });

describe("sign-in limits", () => {
  it("stop a password-guessing run on one account but leave its neighbours alone", async () => {
    await withServer(async (api) => {
      const victim = await createUser();
      const neighbour = await createUser();

      for (let i = 1; i <= 8; i++) {
        const res = await wrongLogin(api, victim.username);
        assert.equal(res.status, 401, `attempt ${i}`);
        assert.equal(res.body.code, "INVALID_CREDENTIALS");
      }

      // From now on even the right password is refused, until the window passes.
      const blocked = await api.post("/api/v1/auth/login", { username: victim.username, password: victim.password });
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.code, "RATE_LIMITED");
      assert.ok(blocked.body.requestId, "the standard error body is kept");
      const retry = Number(blocked.headers.get("retry-after"));
      assert.ok(retry > 0 && retry <= 15 * 60, `Retry-After ${retry}`);
      assert.equal(blocked.body.details.retryAfterSeconds, retry);

      // Spelling the name differently does not reset the counter.
      assert.equal((await wrongLogin(api, victim.username.toUpperCase())).status, 429);
      assert.equal((await wrongLogin(api, `  ${victim.username} `)).status, 429);

      // Someone else on the same site Wi-Fi is not affected.
      assert.equal((await api.post("/api/v1/auth/login", { username: neighbour.username, password: neighbour.password })).status, 200);
    });
  });

  it("do not count successful sign-ins, so crews logging in all day are never locked out", async () => {
    await withServer(async (api) => {
      const user = await createUser();
      for (let i = 0; i < 12; i++) assert.equal((await api.post("/api/v1/auth/login", { username: user.username, password: user.password })).status, 200, `sign-in ${i + 1}`);
      assert.equal((await wrongLogin(api, user.username)).status, 401, "typos are still just typos");
    });
  });

  it("slow down password guessing across many usernames from one address", async () => {
    await withServer(async (api) => {
      let blockedAt = 0;
      for (let i = 1; i <= 70; i++) {
        const res = await wrongLogin(api, uniq("ghost"));
        if (res.status === 429) {
          blockedAt = i;
          break;
        }
        assert.equal(res.status, 401);
      }
      assert.equal(blockedAt, 61, "60 failures per 15 minutes per address");
    });
  });
});

describe("password-reset limits", () => {
  it("allow three e-mails per address per hour and answer unknown addresses the same way", async () => {
    await withServer(async (api) => {
      const email = `${uniq("nobody")}@example.com`;
      const bodies: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await api.post("/api/v1/auth/forgot-password", { email });
        assert.equal(res.status, 200);
        bodies.push(res.body);
      }
      assert.deepEqual(bodies[0], bodies[1]);
      assert.deepEqual(bodies[1], bodies[2]);
      const fourth = await api.post("/api/v1/auth/forgot-password", { email: email.toUpperCase() });
      assert.equal(fourth.status, 429, "case does not matter");
      assert.equal(fourth.body.code, "RATE_LIMITED");
      assert.equal((await api.post("/api/v1/auth/forgot-password", { email: `${uniq("other")}@example.com` })).status, 200, "another address is fine");
    });
  });
});

describe("other limits", () => {
  it("cap registrations per address", async () => {
    await withServer(async (api) => {
      const statuses: number[] = [];
      for (let i = 0; i < 41; i++) statuses.push((await api.post("/api/v1/auth/register", {})).status);
      assert.deepEqual(new Set(statuses.slice(0, 40)), new Set([400]), "the first 40 are just invalid");
      assert.equal(statuses[40], 429);
    });
  });

  it("count signed-in traffic per person, not per address", async () => {
    await withServer(async (api) => {
      const busy = await signIn(api, await createUser());
      const other = await signIn(api, await createUser());
      let first429 = 0;
      for (let i = 1; i <= 305; i++) {
        const res = await api.get("/api/v1/auth/me", busy.token);
        if (res.status === 429) {
          first429 = i;
          break;
        }
        assert.equal(res.status, 200);
      }
      assert.equal(first429, 301, "300 requests a minute per person");
      assert.equal((await api.get("/api/v1/auth/me", other.token)).status, 200, "the colleague on the same Wi-Fi is unaffected");
    });
  });

  it("cap account export and password changes per person", async () => {
    await withServer(async (api) => {
      const me = await signIn(api, await createUser());
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) statuses.push((await api.get("/api/v1/auth/me/export", me.token)).status);
      assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
      assert.equal(statuses[10], 429);
      const change = await api.post("/api/v1/auth/change-password", { currentPassword: STRONG_PASSWORD, newPassword: "Another#Pass-99" }, me.token);
      assert.equal(change.status, 429, "shares the same budget");
    });
  });
});
