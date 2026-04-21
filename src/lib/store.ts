"use client";

import { create } from "zustand";
import {
  type AnnotationsSlice,
  createAnnotationsSlice,
} from "@/features/annotations/slice";
import { exportJson as exportJsonImpl } from "@/features/export/service/exportJson";
import {
  type FramesSlice,
  createFramesSlice,
} from "@/features/frames/slice";
import type { Frame } from "@/features/frames/types";
import {
  type MediaSlice,
  createMediaSlice,
} from "@/features/media/slice";
import type { MediaSource } from "@/features/media/types";

/**
 * Composition root for the workspace store.
 *
 * Each feature owns a slice (state + intra-feature actions). Cross-slice
 * transitions — object URL teardown, cascading deletes, global reset — live
 * here, in one place, so a future event bus can replace this block without
 * touching features.
 */
export type StoreState = MediaSlice &
  FramesSlice &
  AnnotationsSlice & {
    setMedia: (m: MediaSource | null) => void;
    setActiveFrame: (id: string | null) => void;
    removeFrame: (id: string) => void;
    reset: () => void;
    exportJson: () => string;
  };

export const useStore = create<StoreState>()((set, get, store) => ({
  ...createMediaSlice(set, get, store),
  ...createFramesSlice(set, get, store),
  ...createAnnotationsSlice(set, get, store),

  setMedia: (media) => {
    const prev = get().media;
    if (prev?.url && prev.url !== media?.url) URL.revokeObjectURL(prev.url);
    // Switching media wipes derived state.
    get().frames.forEach((f) => URL.revokeObjectURL(f.url));
    set({
      media,
      frames: [],
      activeFrameId: null,
      annotations: [],
      selectedAnnotationId: null,
      centerViewMode: media?.kind === "video" ? "video" : "frame",
    });
  },

  setActiveFrame: (id) =>
    set({
      activeFrameId: id,
      selectedAnnotationId: null,
      hoveredAnnotationId: null,
      centerViewMode: id ? "frame" : get().centerViewMode,
    }),

  removeFrame: (id) => {
    const s = get();
    const target = s.frames.find((f) => f.id === id);
    if (target) URL.revokeObjectURL(target.url);
    const frames = s.frames.filter((f) => f.id !== id);
    const annotations = s.annotations.filter((a) => a.frameId !== id);
    const activeFrameId =
      s.activeFrameId === id ? (frames[0]?.id ?? null) : s.activeFrameId;
    set({ frames, annotations, activeFrameId });
  },

  reset: () => {
    const s = get();
    if (s.media?.url) URL.revokeObjectURL(s.media.url);
    s.frames.forEach((f) => URL.revokeObjectURL(f.url));
    set({
      media: null,
      frames: [],
      activeFrameId: null,
      annotations: [],
      selectedAnnotationId: null,
      centerViewMode: "video",
      keepZoomOnFrameChange: false,
      interactionMode: "draw",
      exceptedFrameIds: {},
    });
  },

  exportJson: () => {
    const { media, frames, classes, annotations } = get();
    return exportJsonImpl({ media, frames, classes, annotations });
  },
}));

/**
 * Cross-slice selector: frames as currently sorted + filtered in the strip.
 * Lives in the composition root because it joins frames, annotations,
 * and exceptedFrameIds. Accepts a structural subset so callers can pass
 * `useStore.getState()` directly or memoize over the specific inputs.
 */
export function selectVisibleFrames(state: {
  frames: StoreState["frames"];
  annotations: StoreState["annotations"];
  exceptedFrameIds: StoreState["exceptedFrameIds"];
  frameSortOrder: StoreState["frameSortOrder"];
  frameFilterMode: StoreState["frameFilterMode"];
}): Frame[] {
  const {
    frames,
    annotations,
    exceptedFrameIds,
    frameSortOrder,
    frameFilterMode,
  } = state;

  const sorted =
    frameSortOrder === "time"
      ? [...frames].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      : frames;

  if (frameFilterMode === "all") return sorted;

  const counts = new Map<string, number>();
  for (const a of annotations) {
    counts.set(a.frameId, (counts.get(a.frameId) ?? 0) + 1);
  }
  return sorted.filter(
    (f) => (counts.get(f.id) ?? 0) === 0 && !exceptedFrameIds[f.id],
  );
}
