"use client";

import { useEffect, useRef } from "react";
import { saveLabelSetData } from "@/features/projects/service/api";
import { useStore } from "@/lib/store";

/**
 * Debounced server save for the active label set's classes / annotations /
 * classifications. Runs inside <LabelingWorkspace>.
 *
 * Frame lifecycle is owned by the label set's image membership (managed via
 * the labelset PATCH endpoint), so this hook only persists labeling state.
 */
export function useLabelSetSync({
  projectId,
  labelsetId,
  initialized,
}: {
  projectId: string;
  labelsetId: string;
  initialized: boolean;
}) {
  const annotations = useStore((s) => s.annotations);
  const classifications = useStore((s) => s.classifications);
  const classes = useStore((s) => s.classes);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [projectId, labelsetId]);

  useEffect(() => {
    if (!initialized) return;
    const gen = generationRef.current;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (generationRef.current !== gen) return;
      void saveLabelSetData(projectId, labelsetId, {
        classes,
        annotations,
        classifications,
      }).catch(() => {});
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [annotations, classes, classifications, initialized, labelsetId, projectId]);
}
