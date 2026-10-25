/**
 * YouTube lessons play inside a WebView that hosts the official IFrame Player API. The page below
 * reports what the learner is really doing (playing or not, and where) back to the app with
 * `postMessage`; the app turns that into lesson heartbeats. (The old app tried to read the player by
 * injecting JavaScript into YouTube's own embed page, which cannot work: that page runs on another origin.)
 *
 * Pure string work, so it is tested without a phone: client/tests/video.test.ts.
 */

export interface PlayerMessage {
  type: "ready" | "state" | "time" | "error";
  playing?: boolean;
  position?: number;
  duration?: number;
  /** YouTube's own error number (2 invalid id, 100 removed, 101/150 embedding disabled, 153 missing referrer). */
  code?: number;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** Where the player page claims to come from. YouTube refuses embeds that send no referrer at all (error 153). */
export const YOUTUBE_BASE_URL = "https://www.youtube.com";

export function youTubeHtml(videoId: string, startSeconds = 0): string {
  // The id goes into a script: refuse anything but the characters a real id has.
  if (!VIDEO_ID.test(videoId)) throw new Error("Not a YouTube video id");
  const start = Number.isFinite(startSeconds) ? Math.max(0, Math.floor(startSeconds)) : 0;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;top:0;left:0;width:100%;height:100%}</style>
</head><body><div id="p"></div><script>
var player = null, timer = null;
function post(m) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
function report() {
  if (!player || !player.getCurrentTime) return;
  post({ type: "time", position: Math.floor(player.getCurrentTime() || 0), duration: Math.floor(player.getDuration() || 0) });
}
function onYouTubeIframeAPIReady() {
  player = new YT.Player("p", {
    videoId: "${videoId}",
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: ${start}, origin: "${YOUTUBE_BASE_URL}" },
    events: {
      onReady: function () { post({ type: "ready" }); },
      onStateChange: function (e) {
        var playing = e.data === 1;
        post({ type: "state", playing: playing });
        if (playing) { if (!timer) timer = setInterval(report, 1000); }
        else { if (timer) { clearInterval(timer); timer = null; } report(); }
      },
      onError: function (e) { post({ type: "error", code: e.data }); }
    }
  });
}
var s = document.createElement("script");
s.src = "https://www.youtube.com/iframe_api";
s.onerror = function () { post({ type: "error", code: -1 }); };
document.head.appendChild(s);
</script></body></html>`;
}

/** Reads one `postMessage` payload from the player page; anything unexpected is ignored. */
export function parsePlayerMessage(raw: unknown): PlayerMessage | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  switch (m.type) {
    case "ready":
      return { type: "ready" };
    case "state":
      return typeof m.playing === "boolean" ? { type: "state", playing: m.playing } : null;
    case "time": {
      const position = num(m.position);
      if (position === undefined) return null;
      const duration = num(m.duration);
      return duration === undefined ? { type: "time", position } : { type: "time", position, duration };
    }
    case "error":
      return { type: "error", code: typeof m.code === "number" ? m.code : -1 };
    default:
      return null;
  }
}

/** Pages the WebView may navigate to: only the player itself. A tap on the YouTube logo must not take the learner away from the lesson. */
export function isAllowedPlayerUrl(url: string): boolean {
  if (url === "about:blank" || url === `${YOUTUBE_BASE_URL}/`) return true;
  return /^https:\/\/(www\.)?youtube(-nocookie)?\.com\/(embed\/|iframe_api|s\/player\/)/.test(url);
}
