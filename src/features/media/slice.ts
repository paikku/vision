import type { StateCreator } from "zustand";
import type { MediaSource } from "./types";

export type MediaSlice = {
  media: MediaSource | null;
};

export const createMediaSlice: StateCreator<MediaSlice, [], [], MediaSlice> = () => ({
  media: null,
});
