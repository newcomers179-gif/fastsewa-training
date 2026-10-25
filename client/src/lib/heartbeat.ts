/**
 * The "I am still on this lesson" signal.
 *
 * The server never trusts a time the phone reports. It counts the gaps between the heartbeats it
 * receives itself (gaps of 1–30 seconds count; longer ones are treated as a pause) and only accepts
 * "mark as complete" once enough time has accumulated. So the app's job is simply to knock every
 * ~10 seconds while the learner is really there, and to stop when they are not (video paused, screen
 * left, app in the background). Nothing here knows about React or the network: `send` is handed in.
 */
export const HEARTBEAT_MS = 10_000;

export interface HeartbeatOptions {
  /** Delivers one heartbeat. A rejection is swallowed here: the caller decides what an error means. */
  send: (positionSeconds: number | undefined) => Promise<unknown>;
  getPosition: () => number | undefined;
  intervalMs?: number;
}

export interface Heartbeat {
  /** The learner is (again) really on the lesson: beat now, then every interval. */
  start(): void;
  /** Paused, left or backgrounded: save the position once more and stop. */
  stop(): void;
  /** Stop without a final beat (the session is gone, or the screen was torn down for good). */
  dispose(): void;
  readonly running: boolean;
}

export function createHeartbeat(options: HeartbeatOptions): Heartbeat {
  const interval = options.intervalMs ?? HEARTBEAT_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let queued = false;
  let disposed = false;

  async function beat(): Promise<void> {
    if (disposed) return;
    if (inFlight) {
      queued = true; // never two at once; one more right after the current one finishes
      return;
    }
    inFlight = true;
    try {
      await options.send(options.getPosition());
    } catch {
      /* a lost beat costs a few seconds of credit, nothing else */
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        void beat();
      }
    }
  }

  return {
    start() {
      if (timer || disposed) return;
      void beat();
      timer = setInterval(() => void beat(), interval);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      void beat();
    },
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    get running() {
      return timer !== null;
    },
  };
}
