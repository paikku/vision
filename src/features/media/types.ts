export type MediaKind = "image" | "video";

export type MediaSource = {
  id: string;
  kind: MediaKind;
  name: string;
  url: string; // object URL for the original upload
  width: number;
  height: number;
  duration?: number; // seconds, for video
  file?: File; // normalized file used by the current session
  originalFile?: File; // original upload file (before normalization)
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
};
