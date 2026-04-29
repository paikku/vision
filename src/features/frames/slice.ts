import type { StateCreator } from "zustand";
import type { Frame } from "./types";

export type FrameSortOrder = "added" | "time";

/** Inclusive [start, end] range in seconds, used by the range filter and
 * the timeline's range-extraction track. */
export type FrameRange = { start: number; end: number };

export type FramesSlice = {
  frames: Frame[];
  activeFrameId: string | null;
  keepZoomOnFrameChange: boolean;
  exceptedFrameIds: Record<string, boolean>;
  frameSortOrder: FrameSortOrder;
  /** Independent toggle: when true, hide frames that already have annotations. */
  unlabeledOnly: boolean;
  /** Independent toggle: when true, hide frames whose timestamp is outside `frameRange`. */
  rangeFilterEnabled: boolean;
  /** Range, in seconds, used by both the range filter and the extraction tools. */
  frameRange: FrameRange | null;
  addFrames: (frames: Frame[]) => void;
  setKeepZoomOnFrameChange: (keep: boolean) => void;
  toggleFrameException: (id: string) => void;
  setFrameSortOrder: (order: FrameSortOrder) => void;
  setUnlabeledOnly: (value: boolean) => void;
  setRangeFilterEnabled: (value: boolean) => void;
  setFrameRange: (range: FrameRange | null) => void;
};

export const createFramesSlice: StateCreator<FramesSlice, [], [], FramesSlice> = (
  set,
) => ({
  frames: [],
  activeFrameId: null,
  keepZoomOnFrameChange: false,
  exceptedFrameIds: {},
  frameSortOrder: "added",
  unlabeledOnly: false,
  rangeFilterEnabled: false,
  frameRange: null,

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
  setUnlabeledOnly: (unlabeledOnly) => set({ unlabeledOnly }),
  setRangeFilterEnabled: (rangeFilterEnabled) => set({ rangeFilterEnabled }),
  setFrameRange: (frameRange) => set({ frameRange }),
});
