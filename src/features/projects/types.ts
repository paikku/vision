import type { Annotation, LabelClass } from "@/features/annotations/types";

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: number;
  videoCount: number;
  annotationCount: number;
  frameCount: number;
};

export type ProjectMember = { id: string; name: string; role: string };

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  members: ProjectMember[];
};

export type VideoMeta = {
  id: string;
  name: string;
  kind: "video" | "image";
  width: number;
  height: number;
  duration?: number;
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
  sourceExt: string;
  /** Number of preview thumbnails on disk (0..previewCount-1). */
  previewCount?: number;
  createdAt: number;
};

export type VideoSummary = VideoMeta & {
  frameCount: number;
  annotationCount: number;
};

export type StoredFrame = {
  id: string;
  videoId: string;
  width: number;
  height: number;
  timestamp?: number;
  label: string;
  ext: string;
  createdAt: number;
};

export type VideoData = {
  classes: LabelClass[];
  frames: StoredFrame[];
  annotations: Annotation[];
};
