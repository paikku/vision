import type {
  Annotation,
  Classification,
  LabelClass,
  TaskType,
} from "@/features/annotations/types";
import type { Frame } from "@/features/frames/types";

export type ExportSnapshot = {
  labelsetId: string;
  labelsetName: string;
  taskType: TaskType;
  frames: Frame[];
  classes: LabelClass[];
  annotations: Annotation[];
  classifications: Classification[];
};

export function exportJson(snapshot: ExportSnapshot): string {
  const { labelsetId, labelsetName, taskType, frames, classes, annotations, classifications } =
    snapshot;
  const payload = {
    version: 2,
    labelset: { id: labelsetId, name: labelsetName, taskType },
    classes,
    images: frames.map((f) => ({
      id: f.id,
      width: f.width,
      height: f.height,
      timestamp: f.timestamp,
      label: f.label,
    })),
    annotations,
    classifications,
  };
  return JSON.stringify(payload, null, 2);
}
