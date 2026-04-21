import type { Annotation, LabelClass } from "@/features/annotations/types";
import type { Frame } from "@/features/frames/types";
import type { MediaSource } from "@/features/media/types";

export type ExportSnapshot = {
  media: MediaSource | null;
  frames: Frame[];
  classes: LabelClass[];
  annotations: Annotation[];
};

export function exportJson(snapshot: ExportSnapshot): string {
  const { media, frames, classes, annotations } = snapshot;
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
}
