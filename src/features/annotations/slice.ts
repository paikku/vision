import type { StateCreator } from "zustand";
import {
  DEFAULT_SEGMENT_MODEL,
  SEGMENT_MODELS,
  type SegmentModelId,
  type SegmentModelInfo,
} from "./service/segment";
import type {
  Annotation,
  Classification,
  ClassShortcutKey,
  LabelClass,
  TaskType,
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

export type AnnotationsSlice = {
  /** Active label set's task type. Drives which UI mode the workspace shows. */
  taskType: TaskType;
  setTaskType: (t: TaskType) => void;

  classes: LabelClass[];
  activeClassId: string | null;

  /** Shape annotations (bbox / polygon). */
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  hoveredAnnotationId: string | null;

  /** Image-level class assignments (classify task). */
  classifications: Classification[];

  activeToolId: ToolId;
  interactionMode: "draw" | "edit";
  segmentModel: SegmentModelId;
  segmentModels: SegmentModelInfo[];
  segmentingIds: Record<string, true>;
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

  /** Toggle a (imageId, classId) classification. Multi-label, idempotent. */
  toggleClassification: (imageId: string, classId: string) => void;
  setClassification: (imageId: string, classId: string, on: boolean) => void;

  setActiveTool: (id: ToolId) => void;
  setInteractionMode: (mode: "draw" | "edit") => void;
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
  taskType: "bbox",
  classes: [{ id: "default", name: "object", color: PALETTE[0] }],
  activeClassId: "default",
  annotations: [],
  classifications: [],
  selectedAnnotationId: null,
  hoveredAnnotationId: null,
  activeToolId: "rect",
  interactionMode: "draw",
  segmentModel: DEFAULT_SEGMENT_MODEL,
  segmentModels: [...SEGMENT_MODELS],
  segmentingIds: {},
  lastSegmentRequestAt: {},

  setTaskType: (taskType) =>
    set((s) => ({
      taskType,
      // For polygon task default tool to polygon, bbox to rect.
      activeToolId:
        taskType === "polygon"
          ? "polygon"
          : taskType === "bbox"
            ? "rect"
            : s.activeToolId,
    })),

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
      const classifications = s.classifications.filter(
        (c) => c.classId !== id,
      );
      const activeClassId =
        s.activeClassId === id ? (classes[0]?.id ?? null) : s.activeClassId;
      return { classes, annotations, classifications, activeClassId };
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
              ? undefined
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

  toggleClassification: (imageId, classId) =>
    set((s) => {
      const has = s.classifications.some(
        (c) => c.imageId === imageId && c.classId === classId,
      );
      if (has) {
        return {
          classifications: s.classifications.filter(
            (c) => !(c.imageId === imageId && c.classId === classId),
          ),
        };
      }
      const c: Classification = {
        id: uid(),
        imageId,
        classId,
        createdAt: Date.now(),
      };
      return { classifications: [...s.classifications, c] };
    }),

  setClassification: (imageId, classId, on) =>
    set((s) => {
      const has = s.classifications.some(
        (c) => c.imageId === imageId && c.classId === classId,
      );
      if (on && !has) {
        return {
          classifications: [
            ...s.classifications,
            {
              id: uid(),
              imageId,
              classId,
              createdAt: Date.now(),
            },
          ],
        };
      }
      if (!on && has) {
        return {
          classifications: s.classifications.filter(
            (c) => !(c.imageId === imageId && c.classId === classId),
          ),
        };
      }
      return s;
    }),

  setActiveTool: (id) => set({ activeToolId: id }),
  setInteractionMode: (interactionMode) => set({ interactionMode }),
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
