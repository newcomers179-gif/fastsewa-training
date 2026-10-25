import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PlayerProps } from "./types";

/** The browser build is for development only; YouTube lessons need the phone app (they play in a WebView there). */
export function YouTubePlayer(_props: PlayerProps & { videoId: string; label: string }) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>YouTube videos play in the phone app.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: "100%", height: "100%", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  text: { color: "#fff" },
});
