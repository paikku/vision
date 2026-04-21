import type { StateCreator } from "zustand";
import type { Frame } from "./types";

export type FramesSlice = {
  frames: Frame[];
  activeFrameId: string | null;
  keepZoomOnFrameChange: boolean;
  exceptedFrameIds: Record<string, boolean>;
  addFrames: (frames: Frame[]) => void;
  setKeepZoomOnFrameChange: (keep: boolean) => void;
  toggleFrameException: (id: string) => void;
};

export const createFramesSlice: StateCreator<FramesSlice, [], [], FramesSlice> = (
  set,
) => ({
  frames: [],
  activeFrameId: null,
  keepZoomOnFrameChange: false,
  exceptedFrameIds: {},

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
});
