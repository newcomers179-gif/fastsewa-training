/// <reference types="node" />
/** Small fakes shared by the client tests: an in-memory key/value store and a scripted `fetch`. */
import type { KeyValueStore } from "../src/lib/apiClient";

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string>; writes: string[] } {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data,
    writes,
    async getItem(key) {
      return data.get(key) ?? null;
    },
    async setItem(key, value) {
      writes.push(key);
      data.set(key, value);
    },
    async removeItem(key) {
      data.delete(key);
    },
  };
}

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply = Response | Error | ((call: RecordedCall) => Response | Promise<Response>);

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/**
 * A fetch that answers from a script: `routes["METHOD /path"]` is a reply, or a list of replies used
 * one after another (the last one repeats). Every call is recorded. Unknown routes answer 404, so a
 * test fails loudly when the client calls something it should not.
 */
export function scriptedFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: RecordedCall[] = [];
  const counters = new Map<string, number>();
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    const parsed = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const call: RecordedCall = {
      method,
      url,
      path: parsed.pathname + parsed.search,
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const key = `${method} ${parsed.pathname}`;
    const entry = routes[key];
    if (entry === undefined) return json(404, { error: "Not found", code: "NOT_FOUND" });
    const list = Array.isArray(entry) ? entry : [entry];
    const index = Math.min(counters.get(key) ?? 0, list.length - 1);
    counters.set(key, (counters.get(key) ?? 0) + 1);
    const reply = list[index]!;
    if (reply instanceof Error) throw reply;
    const out = typeof reply === "function" ? await reply(call) : reply;
    // A Response body can be read once; routes that repeat get a fresh copy each time.
    return out.clone();
  }) as typeof fetch;
  return { fetchImpl, calls, count: (key: string) => calls.filter((c) => `${c.method} ${new URL(c.url).pathname}` === key).length };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
