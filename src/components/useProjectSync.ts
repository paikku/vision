"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import {
  deleteFrame as apiDeleteFrame,
  frameImageUrl,
  saveVideoData,
  uploadFrames,
} from "@/features/projects/service/api";

/**
 * Keeps the workspace store in sync with server persistence for a single
 * project/video context. Runs inside <ProjectWorkspace>.
 *
 * Responsibilities:
 *  - Upload newly-captured frames (blob: URLs) to the server, swap their
 *    in-store URL to the server-backed URL, revoke the blob.
 *  - Delete frames on the server when removed from the store.
 *  - Debounce-save classes/annotations to data.json on any change.
 *
 * The initial hydration (loading data.json into the store) is performed by
 * the caller before mounting this hook — so if `initialized` hasn't been
 * flipped yet, the effects skip work.
 */
export function useProjectSync({
  projectId,
  videoId,
  initialized,
}: {
  projectId: string;
  videoId: string;
  initialized: boolean;
}) {
  const frames = useStore((s) => s.frames);
  const annotations = useStore((s) => s.annotations);
  const classes = useStore((s) => s.classes);

  // Track which frame ids we've already persisted, so we don't re-upload
  // every render. Seeded from the hydration step (see ProjectWorkspace).
  const knownFrameIdsRef = useRef<Set<string>>(new Set());
  const uploadingRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Frame sync: upload new, delete removed.
  useEffect(() => {
    if (!initialized) return;
    const currentIds = new Set(frames.map((f) => f.id));

    // Deletions (on server)
    for (const prev of knownFrameIdsRef.current) {
      if (!currentIds.has(prev)) {
        void apiDeleteFrame(projectId, videoId, prev).catch(() => {});
        knownFrameIdsRef.current.delete(prev);
      }
    }

    // New frames: upload blobs, then swap url + update known set.
    const newFrames = frames.filter(
      (f) =>
        !knownFrameIdsRef.current.has(f.id) &&
        !uploadingRef.current.has(f.id) &&
        typeof f.url === "string" &&
        f.url.startsWith("blob:"),
    );
    if (newFrames.length > 0) {
      newFrames.forEach((f) => uploadingRef.current.add(f.id));
      void (async () => {
        const inputs = await Promise.all(
          newFrames.map(async (f) => ({
            id: f.id,
            blob: await fetch(f.url).then((r) => r.blob()),
            width: f.width,
            height: f.height,
            timestamp: f.timestamp,
            label: f.label,
          })),
        );
        try {
          const stored = await uploadFrames(projectId, videoId, inputs);
          const idToExt = new Map(stored.map((s) => [s.id, s.ext]));

          // Rewrite the store's frames array: server URLs replace blobs. We
          // go through useStore.setState directly because there's no public
          // action for bulk URL swap (adding one would bloat the slice for a
          // one-off sync concern).
          useStore.setState((s) => ({
            frames: s.frames.map((f) => {
              if (!idToExt.has(f.id)) return f;
              // Revoke the old blob URL now that the server copy is live.
              if (f.url.startsWith("blob:")) URL.revokeObjectURL(f.url);
              return { ...f, url: frameImageUrl(projectId, videoId, f.id) };
            }),
          }));
          for (const s of stored) {
            knownFrameIdsRef.current.add(s.id);
            uploadingRef.current.delete(s.id);
          }
        } catch {
          for (const f of newFrames) uploadingRef.current.delete(f.id);
        }
      })();
    }

    // Also catch non-blob frames that were hydrated after this hook mounted
    // (e.g. loaded via URL from server) — mark them known so we don't delete.
    for (const f of frames) {
      if (!knownFrameIdsRef.current.has(f.id) && !f.url.startsWith("blob:")) {
        knownFrameIdsRef.current.add(f.id);
      }
    }
  }, [frames, initialized, projectId, videoId]);

  // Debounced data.json save for classes/annotations. Frame lifecycle goes
  // through the frame endpoints (POST/DELETE) so we don't send frames here.
  useEffect(() => {
    if (!initialized) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveVideoData(projectId, videoId, {
        classes,
        frames: [],
        annotations,
      }).catch(() => {});
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [annotations, classes, initialized, projectId, videoId]);
}
