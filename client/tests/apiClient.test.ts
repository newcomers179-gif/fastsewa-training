/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACCESS_TOKEN_KEY, ApiError, REFRESH_TOKEN_KEY, createApiClient, createTokenStore } from "../src/lib/apiClient";
import { json, memoryStore, scriptedFetch, sleep } from "./helpers";

const BASE = "https://api.example.test";

function setup(routes: Parameters<typeof scriptedFetch>[0], seed: Record<string, string> = { [ACCESS_TOKEN_KEY]: "access-1", [REFRESH_TOKEN_KEY]: "refresh-1" }, extra: { timeoutMs?: number } = {}) {
  const store = memoryStore(seed);
  const tokens = createTokenStore(store);
  const fake = scriptedFetch(routes);
  const events = { lost: 0, passwordChange: 0 };
  const client = createApiClient({
    baseUrl: `${BASE}/`,
    tokens,
    fetchImpl: fake.fetchImpl,
    timeoutMs: extra.timeoutMs,
    onSessionLost: () => void (events.lost += 1),
    onPasswordChangeRequired: () => void (events.passwordChange += 1),
  });
  return { client, store, fake, events };
}

async function failure<T>(promise: Promise<T>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, `expected an ApiError, got ${String(error)}`);
    return error;
  }
  assert.fail("expected the request to fail");
}

describe("requests", () => {
  it("sends the bearer token, JSON bodies and a clean URL (empty query values are dropped)", async () => {
    const { client, fake } = setup({ "POST /api/v1/progress/lesson": json(200, { ok: true }), "GET /api/v1/courses": json(200, []) });
    await client.post("/progress/lesson", { lessonId: "l1", completed: true });
    await client.get("/courses", { query: { category: null, q: "", limit: 20, offset: 0, flag: false, name: "a b&c" } });
    const [post, get] = fake.calls;
    assert.equal(post!.url, `${BASE}/api/v1/progress/lesson`);
    assert.equal(post!.headers.authorization, "Bearer access-1");
    assert.equal(post!.headers["content-type"], "application/json");
    assert.deepEqual(post!.body, { lessonId: "l1", completed: true });
    assert.equal(get!.url, `${BASE}/api/v1/courses?limit=20&offset=0&flag=false&name=a%20b%26c`);
    assert.equal(get!.headers["content-type"], undefined, "a GET carries no body type");
  });

  it("calls without a session send no Authorization header and never try to refresh", async () => {
    const { client, fake } = setup({ "GET /api/v1/config": json(200, { registrationMode: "open" }) }, {});
    assert.deepEqual(await client.get("/config", { auth: false }), { registrationMode: "open" });
    assert.equal(fake.calls[0]!.headers.authorization, undefined);
    assert.equal(fake.calls.length, 1);
  });

  it("answers undefined for 204 and BAD_RESPONSE for a body that is not JSON", async () => {
    const { client } = setup({
      "DELETE /api/v1/auth/push-token": new Response(null, { status: 204 }),
      "GET /api/v1/courses": new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }),
    });
    assert.equal(await client.delete("/auth/push-token", { token: "t" }), undefined);
    assert.equal((await failure(client.get("/courses"))).code, "BAD_RESPONSE");
  });

  it("reads X-Total-Count for paged lists", async () => {
    const { client } = setup({
      "GET /api/v1/courses": json(200, [{ id: "a" }], { "x-total-count": "41" }),
      "GET /api/v1/certificates": json(200, []),
    });
    assert.deepEqual(await client.getWithMeta("/courses"), { data: [{ id: "a" }], total: 41 });
    assert.deepEqual(await client.getWithMeta("/certificates"), { data: [], total: undefined });
  });
});

describe("errors", () => {
  it("turns the server's error body into an ApiError with a stable code", async () => {
    const { client } = setup({
      "POST /api/v1/auth/register": json(400, { error: "Invalid request", code: "VALIDATION_ERROR", requestId: "req-9", details: { fields: { username: ["Too short"], "profile.email": "Bad" } } }),
    });
    const error = await failure(client.post("/auth/register", {}, { auth: false }));
    assert.equal(error.status, 400);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.requestId, "req-9");
    assert.deepEqual(error.fields, { username: ["Too short"], "profile.email": ["Bad"] });
    assert.equal(error.isConnectionProblem, false);
  });

  it("does not choke on an HTML error page from a proxy: the status picks the code", async () => {
    for (const [status, code] of [
      [502, "SERVICE_UNAVAILABLE"],
      [503, "SERVICE_UNAVAILABLE"],
      [500, "INTERNAL"],
      [418, "UNKNOWN"],
      [413, "PAYLOAD_TOO_LARGE"],
    ] as const) {
      const { client } = setup({ "GET /api/v1/courses": new Response("<h1>oops</h1>", { status, headers: { "content-type": "text/html", "x-request-id": "edge-1" } }) });
      const error = await failure(client.get("/courses"));
      assert.equal(error.code, code, String(status));
      assert.equal(error.requestId, "edge-1");
    }
  });

  it("keeps how long the server asked us to wait (Retry-After header or details)", async () => {
    const header = setup({ "POST /api/v1/quiz/q1/submit": json(429, { error: "slow down", code: "QUIZ_ATTEMPTS_EXCEEDED" }, { "retry-after": "3600" }) });
    assert.equal((await failure(header.client.post("/quiz/q1/submit", {}))).retryAfterSeconds, 3600);
    const details = setup({ "POST /api/v1/auth/login": json(429, { error: "slow", code: "RATE_LIMITED", details: { retryAfterSeconds: 42 } }) });
    assert.equal((await failure(details.client.post("/auth/login", {}, { auth: false }))).retryAfterSeconds, 42);
  });

  it("calls an unreachable server NETWORK and a hung one TIMEOUT, both connection problems", async () => {
    const down = setup({ "GET /api/v1/courses": new TypeError("fetch failed") });
    const network = await failure(down.client.get("/courses"));
    assert.equal(network.code, "NETWORK");
    assert.equal(network.isConnectionProblem, true);

    // a fetch that never answers but, like the real one, rejects when its signal aborts
    const store = memoryStore({ [ACCESS_TOKEN_KEY]: "a", [REFRESH_TOKEN_KEY]: "r" });
    const client = createApiClient({
      baseUrl: BASE,
      tokens: createTokenStore(store),
      timeoutMs: 40,
      fetchImpl: ((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })) as typeof fetch,
    });
    const timeout = await failure(client.get("/courses"));
    assert.equal(timeout.code, "TIMEOUT");
    assert.equal(timeout.isConnectionProblem, true);
  });

  it("lets a cancelled request surface as an AbortError, not as a network error", async () => {
    const store = memoryStore({ [ACCESS_TOKEN_KEY]: "a", [REFRESH_TOKEN_KEY]: "r" });
    const client = createApiClient({
      baseUrl: BASE,
      tokens: createTokenStore(store),
      fetchImpl: ((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })) as typeof fetch,
    });
    const controller = new AbortController();
    const pending = client.get("/courses", { signal: controller.signal });
    await sleep(10);
    controller.abort();
    await assert.rejects(pending, (e: Error) => e.name === "AbortError");
  });

  it("asks the app to show the 'choose a new password' screen when the server says so", async () => {
    const { client, events } = setup({ "GET /api/v1/courses": json(403, { error: "change it", code: "PASSWORD_CHANGE_REQUIRED" }) });
    const error = await failure(client.get("/courses"));
    assert.equal(error.code, "PASSWORD_CHANGE_REQUIRED");
    assert.equal(events.passwordChange, 1);
    assert.equal(events.lost, 0);
  });

  it("a wrong password at sign-in is an error to show, never a lost session", async () => {
    const { client, fake, events } = setup({ "POST /api/v1/auth/login": json(401, { error: "Invalid username or password", code: "INVALID_CREDENTIALS" }) }, {});
    const error = await failure(client.post("/auth/login", { username: "a", password: "b" }, { auth: false }));
    assert.equal(error.code, "INVALID_CREDENTIALS");
    assert.equal(events.lost, 0);
    assert.equal(fake.calls.length, 1);
  });

  it("a wrong current password (400) while signed in does not sign the learner out", async () => {
    const { client, events } = setup({ "POST /api/v1/auth/change-password": json(400, { error: "x", code: "CURRENT_PASSWORD_INCORRECT" }) });
    assert.equal((await failure(client.post("/auth/change-password", {}))).code, "CURRENT_PASSWORD_INCORRECT");
    assert.equal(events.lost, 0);
  });
});

describe("keeping the session alive", () => {
  const expired = () => json(401, { error: "Access token expired", code: "TOKEN_EXPIRED" });

  it("refreshes an expired token once and repeats the request with the new one", async () => {
    const { client, fake, store } = setup({
      "GET /api/v1/progress/stats": [expired(), json(200, { lessons: 3 })],
      "POST /api/v1/auth/refresh": json(200, { accessToken: "access-2", refreshToken: "refresh-2" }),
    });
    assert.deepEqual(await client.get("/progress/stats"), { lessons: 3 });
    assert.equal(fake.calls[0]!.headers.authorization, "Bearer access-1");
    assert.deepEqual(fake.calls[1]!.body, { refreshToken: "refresh-1" });
    assert.equal(fake.calls[1]!.headers.authorization, undefined, "the refresh call itself carries no bearer token");
    assert.equal(fake.calls[2]!.headers.authorization, "Bearer access-2");
    assert.equal(store.data.get(ACCESS_TOKEN_KEY), "access-2");
    assert.equal(store.data.get(REFRESH_TOKEN_KEY), "refresh-2");
  });

  it("shares ONE refresh between requests that fail together (the server rotates refresh tokens)", async () => {
    let refreshed = false;
    const { client, fake } = setup({
      "GET /api/v1/courses": (call) => (call.headers.authorization === "Bearer access-2" ? json(200, ["ok"]) : expired()),
      "POST /api/v1/auth/refresh": async () => {
        refreshed = true;
        await sleep(30); // slow enough for all five requests to be waiting on it
        return json(200, { accessToken: "access-2", refreshToken: "refresh-2" });
      },
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => client.get<string[]>("/courses")));
    assert.ok(refreshed);
    assert.deepEqual(results, Array.from({ length: 5 }, () => ["ok"]));
    assert.equal(fake.count("POST /api/v1/auth/refresh"), 1);
  });

  it("ends the session (once) when the refresh token is refused, and wipes the stored tokens", async () => {
    const { client, store, events } = setup({
      "GET /api/v1/courses": expired(),
      "POST /api/v1/auth/refresh": json(401, { error: "Invalid refresh token", code: "UNAUTHORIZED" }),
    });
    const error = await failure(client.get("/courses"));
    assert.equal(error.code, "SESSION_EXPIRED");
    assert.equal(events.lost, 1);
    assert.equal(store.data.size, 0);
  });

  it("does NOT sign the learner out when the server is merely struggling or unreachable during a refresh", async () => {
    const busy = setup({ "GET /api/v1/courses": expired(), "POST /api/v1/auth/refresh": json(503, { error: "busy", code: "SERVER_BUSY" }) });
    assert.equal((await failure(busy.client.get("/courses"))).code, "SERVER_BUSY");
    assert.equal(busy.events.lost, 0);
    assert.equal(busy.store.data.get(REFRESH_TOKEN_KEY), "refresh-1", "the token is kept for the next try");

    const offline = setup({ "GET /api/v1/courses": expired(), "POST /api/v1/auth/refresh": new TypeError("fetch failed") });
    assert.equal((await failure(offline.client.get("/courses"))).code, "NETWORK");
    assert.equal(offline.events.lost, 0);
    assert.equal(offline.store.data.get(REFRESH_TOKEN_KEY), "refresh-1");

    const limited = setup({ "GET /api/v1/courses": expired(), "POST /api/v1/auth/refresh": json(429, { error: "slow", code: "RATE_LIMITED" }, { "retry-after": "20" }) });
    const error = await failure(limited.client.get("/courses"));
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.retryAfterSeconds, 20);
    assert.equal(limited.events.lost, 0);
  });

  it("treats an unreadable refresh answer as a bad response, not as a lost session", async () => {
    const { client, events } = setup({ "GET /api/v1/courses": expired(), "POST /api/v1/auth/refresh": json(200, { nothing: "useful" }) });
    assert.equal((await failure(client.get("/courses"))).code, "BAD_RESPONSE");
    assert.equal(events.lost, 0);
  });

  it("refreshes first when only a refresh token is stored (the app was killed mid-refresh)", async () => {
    const { client, fake } = setup(
      {
        "POST /api/v1/auth/refresh": json(200, { accessToken: "fresh", refreshToken: "fresh-r" }),
        "GET /api/v1/courses": json(200, []),
      },
      { [REFRESH_TOKEN_KEY]: "only-refresh" }
    );
    await client.get("/courses");
    assert.equal(fake.calls[0]!.path, "/api/v1/auth/refresh");
    assert.equal(fake.calls[1]!.headers.authorization, "Bearer fresh");
  });

  it("with no tokens at all a protected call is a lost session, not an endless loop", async () => {
    const { client, fake, events } = setup({ "GET /api/v1/courses": json(401, { error: "auth", code: "UNAUTHORIZED" }) }, {});
    const error = await failure(client.get("/courses"));
    assert.equal(error.code, "SESSION_EXPIRED");
    assert.equal(events.lost, 1);
    assert.ok(fake.calls.length <= 2);
  });

  it("gives up after one retry: a 401 that survives a fresh token ends the session", async () => {
    const { client, fake, events } = setup({
      "GET /api/v1/courses": json(401, { error: "auth", code: "UNAUTHORIZED" }),
      "POST /api/v1/auth/refresh": json(200, { accessToken: "a2", refreshToken: "r2" }),
    });
    assert.equal((await failure(client.get("/courses"))).code, "SESSION_EXPIRED");
    assert.equal(events.lost, 1);
    assert.equal(fake.count("GET /api/v1/courses"), 2);
    assert.equal(fake.count("POST /api/v1/auth/refresh"), 1);
  });
});

describe("token storage", () => {
  it("writes the refresh token before the access token and clears both", async () => {
    const store = memoryStore();
    const tokens = createTokenStore(store);
    await tokens.write({ accessToken: "a", refreshToken: "r" });
    assert.deepEqual(store.writes, [REFRESH_TOKEN_KEY, ACCESS_TOKEN_KEY]);
    assert.deepEqual(await tokens.read(), { accessToken: "a", refreshToken: "r" });
    await tokens.clear();
    assert.deepEqual(await tokens.read(), { accessToken: null, refreshToken: null });
  });

  it("uses only characters expo-secure-store accepts in a key", () => {
    for (const key of [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]) assert.match(key, /^[A-Za-z0-9._-]+$/);
  });
});
