import { useEventListener } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import React from "react";
import { StyleSheet } from "react-native";
import type { PlayerProps } from "./types";

/** A video file (uploaded to the media store, or a direct link) played by the phone's own player. */
export function FilePlayer({ uri, startAt, onReport, onError }: PlayerProps & { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 1;
    if (startAt > 0) p.currentTime = startAt;
  });

  useEventListener(player, "playingChange", ({ isPlaying }) => onReport({ playing: isPlaying, position: Math.floor(player.currentTime) }));
  useEventListener(player, "timeUpdate", ({ currentTime }) => onReport({ playing: player.playing, position: Math.floor(currentTime) }));
  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") onError("load");
  });

  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" allowsFullscreen allowsPictureInPicture={false} />;
}

const styles = StyleSheet.create({
  video: { width: "100%", height: "100%", backgroundColor: "#000" },
});
