import type { StateCreator } from "zustand";
import type { Frame } from "./types";

export type FrameSortOrder = "added" | "time";
export type FrameFilterMode = "all" | "unlabeled";

export type FramesSlice = {
  frames: Frame[];
  activeFrameId: string | null;
  keepZoomOnFrameChange: boolean;
  exceptedFrameIds: Record<string, boolean>;
  frameSortOrder: FrameSortOrder;
  frameFilterMode: FrameFilterMode;
  addFrames: (frames: Frame[]) => void;
  setKeepZoomOnFrameChange: (keep: boolean) => void;
  toggleFrameException: (id: string) => void;
  setFrameSortOrder: (order: FrameSortOrder) => void;
  setFrameFilterMode: (mode: FrameFilterMode) => void;
};

export const createFramesSlice: StateCreator<FramesSlice, [], [], FramesSlice> = (
  set,
) => ({
  frames: [],
  activeFrameId: null,
  keepZoomOnFrameChange: false,
  exceptedFrameIds: {},
  frameSortOrder: "added",
  frameFilterMode: "all",

  addFrames: (frames) =>
    set((s) => ({
      frames: [...s.frames, ...frames],
      activeFrameId: s.activeFrameId ?? frames[0]?.id ?? null,
    })),

  setKeepZoomOnFrameChange: (keepZoomOnFrameChange) =>
    set({ keepZoomOnFrameChange }),

  toggleFrameException: (id) =>
    set((s) => ({
      exceptedFrameIds: s.exceptedFrameIds[id]
        ? Object.fromEntries(
            Object.entries(s.exceptedFrameIds).filter(([k]) => k !== id),
          )
        : { ...s.exceptedFrameIds, [id]: true },
    })),

  setFrameSortOrder: (frameSortOrder) => set({ frameSortOrder }),
  setFrameFilterMode: (frameFilterMode) => set({ frameFilterMode }),
});
