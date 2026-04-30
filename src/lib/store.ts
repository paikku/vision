"use client";

import { create } from "zustand";
import {
  type AnnotationsSlice,
  createAnnotationsSlice,
} from "@/features/annotations/slice";
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
  };

/** Tolerance in seconds when checking whether a captured frame's timestamp
 *  collides with an existing frame. Half a 60fps interval is small enough to
 *  never merge legitimately distinct frames yet large enough to absorb the
 *  rounding noise from independent capture paths. */
const TIMESTAMP_DEDUPE_EPS = 0.008;

export const useStore = create<StoreState>()((set, get, store) => ({
  ...createMediaSlice(set, get, store),
  ...createFramesSlice(set, get, store),
  ...createAnnotationsSlice(set, get, store),

  addFrames: (newFrames) => {
    const s = get();
    const existingTs: number[] = [];
    for (const f of s.frames) {
      if (typeof f.timestamp === "number") existingTs.push(f.timestamp);
    }
    const accepted: Frame[] = [];
    const acceptedTs: number[] = [];
    for (const f of newFrames) {
      const t = typeof f.timestamp === "number" ? f.timestamp : null;
      const isDup =
        t !== null &&
        (existingTs.some((et) => Math.abs(et - t) < TIMESTAMP_DEDUPE_EPS) ||
          acceptedTs.some((at) => Math.abs(at - t) < TIMESTAMP_DEDUPE_EPS));
      if (isDup) {
        if (f.url.startsWith("blob:")) URL.revokeObjectURL(f.url);
        continue;
      }
      accepted.push(f);
      if (t !== null) acceptedTs.push(t);
    }
    if (accepted.length === 0) return;
    set({
      frames: [...s.frames, ...accepted],
      activeFrameId: s.activeFrameId ?? accepted[0]?.id ?? null,
    });
  },

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
      unlabeledOnly: false,
      rangeFilterEnabled: true,
      frameRange: null,
    });
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
  unlabeledOnly: StoreState["unlabeledOnly"];
  rangeFilterEnabled: StoreState["rangeFilterEnabled"];
  frameRange: StoreState["frameRange"];
}): Frame[] {
  const {
    frames,
    annotations,
    exceptedFrameIds,
    frameSortOrder,
    unlabeledOnly,
    rangeFilterEnabled,
    frameRange,
  } = state;

  const sorted =
    frameSortOrder === "time"
      ? [...frames].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
      : frames;

  if (!unlabeledOnly && !(rangeFilterEnabled && frameRange)) return sorted;

  const counts = new Map<string, number>();
  if (unlabeledOnly) {
    for (const a of annotations) {
      counts.set(a.frameId, (counts.get(a.frameId) ?? 0) + 1);
    }
  }

  return sorted.filter((f) => {
    if (unlabeledOnly) {
      if ((counts.get(f.id) ?? 0) !== 0) return false;
      if (exceptedFrameIds[f.id]) return false;
    }
    if (rangeFilterEnabled && frameRange) {
      if (typeof f.timestamp !== "number") return false;
      if (f.timestamp < frameRange.start || f.timestamp > frameRange.end) return false;
    }
    return true;
  });
}
