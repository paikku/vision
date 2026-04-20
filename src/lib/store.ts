"use client";

import { create } from "zustand";
import type {
  Annotation,
  ClassShortcutKey,
  Frame,
  LabelClass,
  MediaSource,
  ToolId,
} from "./types";

const PALETTE = [
  "#5b8cff",
  "#ffb35b",
  "#5bff9c",
  "#ff5bd1",
  "#ffe45b",
  "#5bf2ff",
  "#a35bff",
  "#ff8a5b",
];

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

type StoreState = {
  media: MediaSource | null;
  frames: Frame[];
  activeFrameId: string | null;

  classes: LabelClass[];
  activeClassId: string | null;

  annotations: Annotation[];
  selectedAnnotationId: string | null;
  hoveredAnnotationId: string | null;

  activeToolId: ToolId;
  centerViewMode: "video" | "frame";
  keepZoomOnFrameChange: boolean;
  interactionMode: "draw" | "edit";

  // media + frames
  setMedia: (m: MediaSource | null) => void;
  addFrames: (frames: Frame[]) => void;
  removeFrame: (id: string) => void;
  setActiveFrame: (id: string | null) => void;
  setCenterViewMode: (mode: "video" | "frame") => void;
  setKeepZoomOnFrameChange: (keep: boolean) => void;

  // classes
  addClass: (name?: string) => LabelClass;
  removeClass: (id: string) => void;
  renameClass: (id: string, name: string) => void;
  setActiveClass: (id: string | null) => void;
  setClassShortcut: (classId: string, key: ClassShortcutKey | null) => void;

  // annotations
  addAnnotation: (a: Omit<Annotation, "id" | "createdAt">) => Annotation;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  selectAnnotation: (id: string | null) => void;
  setHoveredAnnotation: (id: string | null) => void;

  // tool
  setActiveTool: (id: ToolId) => void;
  setInteractionMode: (mode: "draw" | "edit") => void;

  // utility
  reset: () => void;
  exportJson: () => string;
};

export const useStore = create<StoreState>((set, get) => ({
  media: null,
  frames: [],
  activeFrameId: null,

  classes: [{ id: "default", name: "object", color: PALETTE[0] }],
  activeClassId: "default",

  annotations: [],
  selectedAnnotationId: null,
  hoveredAnnotationId: null,

  activeToolId: "rect",
  centerViewMode: "video",
  keepZoomOnFrameChange: false,
  interactionMode: "draw",

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

  addFrames: (frames) => {
    set((s) => ({
      frames: [...s.frames, ...frames],
      activeFrameId: s.activeFrameId ?? frames[0]?.id ?? null,
    }));
  },

  removeFrame: (id) => {
    set((s) => {
      const target = s.frames.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.url);
      const frames = s.frames.filter((f) => f.id !== id);
      const annotations = s.annotations.filter((a) => a.frameId !== id);
      const activeFrameId =
        s.activeFrameId === id ? (frames[0]?.id ?? null) : s.activeFrameId;
      return { frames, annotations, activeFrameId };
    });
  },

  setActiveFrame: (id) =>
    set({
      activeFrameId: id,
      selectedAnnotationId: null,
      hoveredAnnotationId: null,
      centerViewMode: id ? "frame" : get().centerViewMode,
    }),

  setCenterViewMode: (mode) => set({ centerViewMode: mode }),
  setKeepZoomOnFrameChange: (keepZoomOnFrameChange) => set({ keepZoomOnFrameChange }),

  addClass: (name) => {
    const c: LabelClass = {
      id: uid(),
      name: name?.trim() || `class ${get().classes.length + 1}`,
      color: PALETTE[get().classes.length % PALETTE.length],
    };
    set((s) => ({ classes: [...s.classes, c], activeClassId: c.id }));
    return c;
  },

  removeClass: (id) => {
    set((s) => {
      const classes = s.classes.filter((c) => c.id !== id);
      const annotations = s.annotations.filter((a) => a.classId !== id);
      const activeClassId =
        s.activeClassId === id ? (classes[0]?.id ?? null) : s.activeClassId;
      return { classes, annotations, activeClassId };
    });
  },

  renameClass: (id, name) =>
    set((s) => ({
      classes: s.classes.map((c) => (c.id === id ? { ...c, name } : c)),
    })),

  setActiveClass: (id) => set({ activeClassId: id }),

  setClassShortcut: (classId, key) =>
    set((s) => ({
      classes: s.classes.map((c) => ({
        ...c,
        shortcutKey:
          c.id === classId
            ? (key ?? undefined)
            : c.shortcutKey === key
              ? undefined // remove from previous holder
              : c.shortcutKey,
      })),
    })),

  addAnnotation: (a) => {
    const ann: Annotation = { id: uid(), createdAt: Date.now(), ...a };
    set((s) => ({
      annotations: [...s.annotations, ann],
      selectedAnnotationId: ann.id,
    }));
    return ann;
  },

  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    })),

  removeAnnotation: (id) =>
    set((s) => ({
      annotations: s.annotations.filter((a) => a.id !== id),
      selectedAnnotationId:
        s.selectedAnnotationId === id ? null : s.selectedAnnotationId,
    })),

  selectAnnotation: (id) => set({ selectedAnnotationId: id }),
  setHoveredAnnotation: (id) => set({ hoveredAnnotationId: id }),

  setActiveTool: (id) => set({ activeToolId: id }),
  setInteractionMode: (interactionMode) =>
    set({
      interactionMode,
      hoveredAnnotationId: interactionMode === "edit" ? get().hoveredAnnotationId : null,
    }),

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
    });
  },

  exportJson: () => {
    const { media, frames, classes, annotations } = get();
    const payload = {
      version: 1,
      media: media
        ? {
            id: media.id,
            kind: media.kind,
            name: media.name,
            width: media.width,
            height: media.height,
            duration: media.duration,
          }
        : null,
      classes,
      frames: frames.map((f) => ({
        id: f.id,
        width: f.width,
        height: f.height,
        timestamp: f.timestamp,
        label: f.label,
      })),
      annotations,
    };
    return JSON.stringify(payload, null, 2);
  },
}));
