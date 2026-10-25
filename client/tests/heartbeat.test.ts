/// <reference types="node" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { HEARTBEAT_MS, createHeartbeat } from "../src/lib/heartbeat";

/** Lets the promise chains inside a beat settle (the fake clock does not move microtasks). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("heartbeat", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setInterval"] }));
  afterEach(() => mock.timers.reset());

  function make(send: (position: number | undefined) => Promise<unknown>, position: () => number | undefined = () => undefined) {
    return createHeartbeat({ send, getPosition: position });
  }

  it("beats at once when it starts, then every ten seconds, carrying the current position", async () => {
    const sent: (number | undefined)[] = [];
    let position = 12;
    const beat = make(async (p) => void sent.push(p), () => position);
    beat.start();
    await settle();
    assert.deepEqual(sent, [12]);
    position = 22;
    mock.timers.tick(HEARTBEAT_MS);
    await settle();
    position = 32;
    mock.timers.tick(HEARTBEAT_MS);
    await settle();
    assert.deepEqual(sent, [12, 22, 32]);
    assert.equal(beat.running, true);
    beat.dispose();
  });

  it("saves the position one last time when it stops, then goes quiet", async () => {
    const sent: (number | undefined)[] = [];
    let position = 5;
    const beat = make(async (p) => void sent.push(p), () => position);
    beat.start();
    await settle();
    position = 9;
    beat.stop();
    await settle();
    assert.deepEqual(sent, [5, 9]);
    assert.equal(beat.running, false);
    mock.timers.tick(HEARTBEAT_MS * 3);
    await settle();
    assert.equal(sent.length, 2, "no beats after stopping");
    beat.stop(); // stopping twice sends nothing more
    await settle();
    assert.equal(sent.length, 2);
  });

  it("ignores a second start while running (one timer, one beat)", async () => {
    let count = 0;
    const beat = make(async () => void (count += 1));
    beat.start();
    beat.start();
    await settle();
    assert.equal(count, 1);
    mock.timers.tick(HEARTBEAT_MS);
    await settle();
    assert.equal(count, 2);
    beat.dispose();
  });

  it("never has two beats in flight: a slow network gets exactly one catch-up beat", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let total = 0;
    const releases: (() => void)[] = [];
    const beat = make(
      () =>
        new Promise<void>((resolve) => {
          total += 1;
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          releases.push(() => {
            inFlight -= 1;
            resolve();
          });
        })
    );
    beat.start();
    await settle();
    mock.timers.tick(HEARTBEAT_MS); // the first beat is still on its way
    mock.timers.tick(HEARTBEAT_MS);
    await settle();
    assert.equal(total, 1);
    releases.shift()!();
    await settle();
    assert.equal(total, 2, "one catch-up beat, not one per missed interval");
    releases.shift()!();
    await settle();
    assert.equal(maxInFlight, 1);
    beat.dispose();
  });

  it("survives a failing network: errors are swallowed and the next beat still goes out", async () => {
    let attempts = 0;
    const beat = make(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("offline");
    });
    beat.start();
    await settle();
    mock.timers.tick(HEARTBEAT_MS);
    await settle();
    mock.timers.tick(HEARTBEAT_MS);
    await settle();
    assert.equal(attempts, 3);
    beat.dispose();
  });

  it("dispose stops everything without a final beat and cannot be restarted", async () => {
    let count = 0;
    const beat = make(async () => void (count += 1));
    beat.start();
    await settle();
    beat.dispose();
    mock.timers.tick(HEARTBEAT_MS * 2);
    await settle();
    beat.start();
    beat.stop();
    await settle();
    assert.equal(count, 1);
    assert.equal(beat.running, false);
  });

  it("honours a custom interval", async () => {
    let count = 0;
    const beat = createHeartbeat({ send: async () => void (count += 1), getPosition: () => undefined, intervalMs: 1000 });
    beat.start();
    await settle();
    for (let i = 0; i < 3; i++) {
      mock.timers.tick(1000);
      await settle();
    }
    assert.equal(count, 4);
    beat.dispose();
  });
});
