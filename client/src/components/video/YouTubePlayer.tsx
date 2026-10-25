import React, { useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { isAllowedPlayerUrl, parsePlayerMessage, youTubeHtml, YOUTUBE_BASE_URL } from "@/lib/video";
import type { PlayerProps } from "./types";

/**
 * The official YouTube player inside a WebView. The page it loads (lib/video.ts) reports "playing or
 * not" and the position back through postMessage; nothing is injected into YouTube's own pages.
 */
export function YouTubePlayer({ videoId, startAt, onReport, onError, label }: PlayerProps & { videoId: string; label: string }) {
  // Built once: reloading the page whenever progress changes would restart the video.
  const [html] = useState(() => youTubeHtml(videoId, startAt));
  const state = useRef({ playing: false, position: startAt });

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parsePlayerMessage(event.nativeEvent.data);
    if (!message) return;
    switch (message.type) {
      case "state":
        state.current.playing = message.playing ?? false;
        break;
      case "time":
        state.current.position = message.position ?? state.current.position;
        break;
      case "error":
        // 2: bad id · 5: HTML5 error · 100: removed/private · 101/150: embedding switched off · 153: no referrer · -1: the player script did not load
        onError(message.code === 101 || message.code === 150 || message.code === 153 ? "blocked" : "load");
        return;
      default:
        return; // "ready"
    }
    onReport({ playing: state.current.playing, position: state.current.position });
  };

  return (
    <WebView
      source={{ html, baseUrl: YOUTUBE_BASE_URL }}
      style={styles.video}
      originWhitelist={["https://*", "about:*"]}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => isAllowedPlayerUrl(request.url)}
      onMessage={onMessage}
      onError={() => onError("load")}
      onHttpError={() => onError("load")}
      accessibilityLabel={label}
    />
  );
}

const styles = StyleSheet.create({
  video: { width: "100%", height: "100%", backgroundColor: "#000" },
});
