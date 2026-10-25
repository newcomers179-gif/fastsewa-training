/** What a video player tells the lesson screen about what the learner is doing. */
export interface PlayerReport {
  playing: boolean;
  /** Whole seconds into the video. */
  position: number;
}

export interface PlayerProps {
  startAt: number;
  onReport: (report: PlayerReport) => void;
  /** The video could not be loaded or is not allowed to play here. */
  onError: (reason: "load" | "blocked") => void;
}
