import type { StateCreator } from "zustand";
import type { MediaSource } from "./types";

export type MediaSlice = {
  media: MediaSource | null;
  centerViewMode: "video" | "frame";
  setCenterViewMode: (mode: "video" | "frame") => void;
};

export const createMediaSlice: StateCreator<MediaSlice, [], [], MediaSlice> = (
  set,
) => ({
  media: null,
  centerViewMode: "video",
  setCenterViewMode: (centerViewMode) => set({ centerViewMode }),
});
