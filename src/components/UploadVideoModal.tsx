"use client";

import { useEffect, useState } from "react";
import { MediaDropzone } from "@/features/media";
import type { MediaSource } from "@/features/media";
import {
  evenlySpacedTimes,
  extractFrames,
} from "@/features/media/service/capture";
import type { VideoMeta } from "@/features/projects";
import {
  uploadPreviews,
  uploadVideo,
} from "@/features/projects/service/api";

const PREVIEW_COUNT = 10;

type Props = {
  projectId: string;
  onClose: () => void;
  onUploaded: (video: VideoMeta) => void;
};

type Stage = "idle" | "uploading" | "thumbnails";

export function UploadVideoModal({ projectId, onClose, onUploaded }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const saving = stage !== "idle";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleComplete = async (media: MediaSource) => {
    if (!media.file) {
      setError("파일을 읽을 수 없습니다.");
      return;
    }
    setError(null);
    setStage("uploading");
    try {
      const video = await uploadVideo(projectId, {
        file: media.file,
        name: media.name,
        kind: media.kind,
        width: media.width,
        height: media.height,
        duration: media.duration,
        ingestVia: media.ingestVia,
      });

      // For videos, generate ~10 evenly-spaced preview thumbnails so the
      // detail page can render the hover reel + inline first thumb.
      // Image uploads skip this — the source itself is the preview.
      if (media.kind === "video" && media.duration && media.duration > 0) {
        setStage("thumbnails");
        try {
          const times = evenlySpacedTimes(media.duration, PREVIEW_COUNT);
          const previewFrames = await extractFrames(media, {
            times,
            quality: 0.7,
          });
          const blobs = await Promise.all(
            previewFrames.map((f) => fetch(f.url).then((r) => r.blob())),
          );
          // Caller (MediaDropzone) revokes media.url after onComplete, but
          // these per-frame URLs are owned by us — clean them up.
          previewFrames.forEach((f) => URL.revokeObjectURL(f.url));
          if (blobs.length > 0) {
            await uploadPreviews(projectId, video.id, blobs);
          }
        } catch {
          // Preview generation is best-effort; the video itself is already
          // saved. Swallow errors so the upload doesn't fail because of it.
        }
      }

      onUploaded(video);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setStage("idle");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <div className="text-sm font-semibold">동영상 추가</div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
          >
            닫기 (Esc)
          </button>
        </header>
        <div className="min-h-[360px] flex-1 overflow-auto">
          <MediaDropzone onComplete={handleComplete} />
        </div>
        {(saving || error) && (
          <footer className="flex items-center justify-between border-t border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-xs">
            {stage === "uploading" ? (
              <span className="text-[var(--color-muted)]">서버에 저장 중…</span>
            ) : stage === "thumbnails" ? (
              <span className="text-[var(--color-muted)]">미리보기 썸네일 생성 중…</span>
            ) : (
              <span className="text-[var(--color-danger)]">{error}</span>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
