import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_DWELL_SECONDS, requiredWatchSeconds, WATCH_THRESHOLD } from "../services/progress";

const video = (seconds: number | null) => ({ contentType: "video" as const, videoDurationSeconds: seconds });

describe("requiredWatchSeconds", () => {
  it("asks for the watch share of a normal video", () => {
    assert.equal(requiredWatchSeconds(video(100)), 70);
    assert.equal(requiredWatchSeconds(video(212)), Math.ceil(212 * WATCH_THRESHOLD));
  });

  it("never asks for less than the minimum dwell on a video long enough to allow it", () => {
    assert.equal(requiredWatchSeconds(video(6)), MIN_DWELL_SECONDS);
    assert.equal(requiredWatchSeconds(video(7)), MIN_DWELL_SECONDS);
  });

  it("never asks for more time than a very short clip lasts", () => {
    for (const seconds of [1, 2, 3, 4, 5]) {
      const needed = requiredWatchSeconds(video(seconds));
      assert.ok(needed >= 1 && needed <= seconds, `${seconds} s clip needs ${needed} s`);
    }
    assert.equal(requiredWatchSeconds(video(3)), 2);
  });

  it("uses the minimum dwell when there is no usable length, or the lesson is not a video", () => {
    assert.equal(requiredWatchSeconds(video(null)), MIN_DWELL_SECONDS);
    assert.equal(requiredWatchSeconds(video(0)), MIN_DWELL_SECONDS);
    assert.equal(requiredWatchSeconds({ contentType: "text", videoDurationSeconds: 120 }), MIN_DWELL_SECONDS);
    assert.equal(requiredWatchSeconds({ contentType: "image", videoDurationSeconds: null }), MIN_DWELL_SECONDS);
  });

  it("is monotonic: a longer video never needs less time", () => {
    let previous = 0;
    for (let seconds = 6; seconds <= 3600; seconds += 1) {
      const needed = requiredWatchSeconds(video(seconds));
      assert.ok(needed >= previous, `${seconds} s needs ${needed} after ${previous}`);
      previous = needed;
    }
  });
});
