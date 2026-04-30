import type { StateCreator } from "zustand";
import {
  DEFAULT_SEGMENT_MODEL,
  SEGMENT_MODELS,
  type SegmentModelId,
  type SegmentModelInfo,
} from "./service/segment";
import type {
  Annotation,
  ClassShortcutKey,
  LabelClass,
  ToolId,
} from "./types";

/**
 * Mirror of the enclosing LabelSet's type. Drives whether the stage runs
 * the rect/polygon drawing pipeline or the click-to-classify pipeline. Null
 * when there is no LabelSet in scope (no labeling page mounted).
 */
export type LabelSetType = "polygon" | "bbox" | "classify";

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

export type AnnotationsSlice = {
  classes: LabelClass[];
  activeClassId: string | null;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  activeToolId: ToolId;
  interactionMode: "draw" | "edit";
  segmentModel: SegmentModelId;
  /**
   * Available segmentation models advertised by the server (via
   * `GET /v1/segment/models`). Seeded from the built-in fallback so
   * the UI has something to render before the fetch completes.
   */
  segmentModels: SegmentModelInfo[];
  /**
   * Annotation ids currently waiting on a segmentation response. Surfaced
   * here (rather than as local state) so the canvas overlay and the side
   * panel can reflect the same loading status.
   */
  segmentingIds: Record<string, true>;
  /**
   * Per-annotation timestamp of the most recent segment request. Used to
   * enforce a minimum interval between repeated `H` presses on the same
   * annotation (see `LabelPanel`).
   */
  lastSegmentRequestAt: Record<string, number>;

  addClass: (name?: string) => LabelClass;
  removeClass: (id: string) => void;
  renameClass: (id: string, name: string) => void;
  setActiveClass: (id: string | null) => void;
  setClassColor: (classId: string, color: string) => void;
  setClassShortcut: (classId: string, key: ClassShortcutKey | null) => void;

  addAnnotation: (a: Omit<Annotation, "id" | "createdAt">) => Annotation;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  selectAnnotation: (id: string | null) => void;
  setHoveredAnnotation: (id: string | null) => void;

  setActiveTool: (id: ToolId) => void;
  setInteractionMode: (mode: "draw" | "edit") => void;
  labelSetType: LabelSetType | null;
  setLabelSetType: (type: LabelSetType | null) => void;
  setSegmentModel: (id: SegmentModelId) => void;
  setSegmentModels: (models: SegmentModelInfo[]) => void;
  setSegmenting: (id: string, on: boolean) => void;
  markSegmentRequested: (id: string, at: number) => void;
};

export const createAnnotationsSlice: StateCreator<
  AnnotationsSlice,
  [],
  [],
  AnnotationsSlice
> = (set, get) => ({
  classes: [{ id: "default", name: "object", color: PALETTE[0] }],
  activeClassId: "default",
  annotations: [],
  selectedAnnotationId: null,
  hoveredAnnotationId: null,
  activeToolId: "rect",
  interactionMode: "draw",
  segmentModel: DEFAULT_SEGMENT_MODEL,
  segmentModels: [...SEGMENT_MODELS],
  segmentingIds: {},
  lastSegmentRequestAt: {},
  labelSetType: null,

  addClass: (name) => {
    const c: LabelClass = {
      id: uid(),
      name: name?.trim() || `class ${get().classes.length + 1}`,
      color: PALETTE[get().classes.length % PALETTE.length],
    };
    set((s) => ({ classes: [...s.classes, c], activeClassId: c.id }));
    return c;
  },

  removeClass: (id) =>
    set((s) => {
      const classes = s.classes.filter((c) => c.id !== id);
      const annotations = s.annotations.filter((a) => a.classId !== id);
      const activeClassId =
        s.activeClassId === id ? (classes[0]?.id ?? null) : s.activeClassId;
      return { classes, annotations, activeClassId };
    }),

  renameClass: (id, name) =>
    set((s) => ({
      classes: s.classes.map((c) => (c.id === id ? { ...c, name } : c)),
    })),

  setClassColor: (classId, color) =>
    set((s) => ({
      classes: s.classes.map((c) => (c.id === classId ? { ...c, color } : c)),
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
    set((s) => {
      // Classify is single-class-per-image: drop any prior classify on the
      // same image before appending this one. rect/polygon stay multi-shape.
      const annotations =
        ann.kind === "classify"
          ? s.annotations.filter(
              (x) => !(x.kind === "classify" && x.frameId === ann.frameId),
            )
          : s.annotations;
      return {
        annotations: [...annotations, ann],
        selectedAnnotationId: ann.id,
      };
    });
    return ann;
  },

  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    })),

  removeAnnotation: (id) =>
    set((s) => {
      const segmentingIds =
        id in s.segmentingIds
          ? Object.fromEntries(
              Object.entries(s.segmentingIds).filter(([k]) => k !== id),
            )
          : s.segmentingIds;
      const lastSegmentRequestAt =
        id in s.lastSegmentRequestAt
          ? Object.fromEntries(
              Object.entries(s.lastSegmentRequestAt).filter(([k]) => k !== id),
            )
          : s.lastSegmentRequestAt;
      return {
        annotations: s.annotations.filter((a) => a.id !== id),
        selectedAnnotationId:
          s.selectedAnnotationId === id ? null : s.selectedAnnotationId,
        segmentingIds,
        lastSegmentRequestAt,
      };
    }),

  selectAnnotation: (id) => set({ selectedAnnotationId: id }),
  setHoveredAnnotation: (id) => set({ hoveredAnnotationId: id }),

  setActiveTool: (id) => set({ activeToolId: id }),
  setInteractionMode: (interactionMode) => set({ interactionMode }),
  setLabelSetType: (labelSetType) => set({ labelSetType }),
  setSegmentModel: (segmentModel) => set({ segmentModel }),
  setSegmentModels: (segmentModels) => set({ segmentModels }),

  setSegmenting: (id, on) =>
    set((s) => {
      const has = id in s.segmentingIds;
      if (on) {
        if (has) return s;
        return { segmentingIds: { ...s.segmentingIds, [id]: true } };
      }
      if (!has) return s;
      const next = { ...s.segmentingIds };
      delete next[id];
      return { segmentingIds: next };
    }),

  markSegmentRequested: (id, at) =>
    set((s) => ({
      lastSegmentRequestAt: { ...s.lastSegmentRequestAt, [id]: at },
    })),
});
