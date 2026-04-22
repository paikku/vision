"use client";

import { useEffect, useState } from "react";
import { MediaDropzone } from "@/features/media";
import type { MediaSource } from "@/features/media";
import type { VideoMeta } from "@/features/projects";
import { uploadVideo } from "@/features/projects/service/api";

type Props = {
  projectId: string;
  onClose: () => void;
  onUploaded: (video: VideoMeta) => void;
};

export function UploadVideoModal({ projectId, onClose, onUploaded }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setSaving(true);
    setError(null);
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
      onUploaded(video);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setSaving(false);
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
            {saving ? (
              <span className="text-[var(--color-muted)]">서버에 저장 중…</span>
            ) : (
              <span className="text-[var(--color-danger)]">{error}</span>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
