"use client";

import { useCallback, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/shared/ui";
import type { MediaSource } from "../types";
import {
  frameFromImage,
  inferMediaKind,
  readMedia,
} from "../service/capture";
import type { NormalizeProgress } from "../service/normalize";

function phaseLabel(p: NormalizeProgress): string {
  switch (p.phase) {
    case "uploading":
      return "업로드 중";
    case "decoding":
      return "서버 디코딩 중";
    case "downloading":
      return "결과 수신 중";
    case "local":
      return "브라우저 변환 중";
  }
}

export type MediaDropzoneProps = {
  onComplete?: (media: MediaSource) => Promise<void> | void;
};

export function MediaDropzone({ onComplete }: MediaDropzoneProps = {}) {
  const setMedia = useStore((s) => s.setMedia);
  const addFrames = useStore((s) => s.addFrames);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<NormalizeProgress | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (busy) return;
      const file = files?.[0];
      if (!file) return;
      if (!inferMediaKind(file)) {
        setError("Drop an image or a video file.");
        return;
      }
      setError(null);
      setBusy(true);
      setProgress(null);
      try {
        const media = await readMedia(file, {
          onProgress: (p) => setProgress(p),
        });
        if (onComplete) {
          await onComplete(media);
          URL.revokeObjectURL(media.url);
        } else {
          setMedia(media);
          if (media.kind === "image") {
            addFrames([await frameFromImage(media)]);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to read file");
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [addFrames, busy, onComplete, setMedia],
  );

  const blocked = busy;

  return (
    <div className="flex h-full w-full items-center justify-center p-10">
      <label
        aria-busy={blocked}
        aria-disabled={blocked}
        onDragOver={(e) => {
          e.preventDefault();
          if (blocked) return;
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          if (blocked) return;
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "group relative flex w-full max-w-xl flex-col items-center justify-center gap-4 rounded-[var(--radius-2xl)] border-2 border-dashed px-10 py-16 text-center transition-colors",
          blocked
            ? "pointer-events-none cursor-not-allowed border-[var(--color-line)] bg-[var(--color-surface)] opacity-90"
            : hover
              ? "cursor-pointer border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
              : "cursor-pointer border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/60",
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-surface-2)] text-[var(--color-accent)]">
          <UploadIcon />
        </div>
        <div>
          <p className="text-[var(--text-lg)] font-medium text-[var(--color-text-strong)]">
            {blocked ? "영상 처리 중… 업로드가 잠시 비활성화됩니다" : "Drop an image or video"}
          </p>
          <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
            {blocked
              ? "처리 중에는 새 파일을 올릴 수 없습니다."
              : "or click to browse · jpg, png, webp, mp4, webm, mov"}
          </p>
        </div>
        {progress && <ProgressBar progress={progress} />}
        {error && <p className="text-[var(--text-sm)] text-[var(--color-danger)]">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          disabled={blocked}
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </label>
    </div>
  );
}

function ProgressBar({ progress }: { progress: NormalizeProgress }) {
  const pct =
    typeof progress.progress === "number"
      ? Math.round(progress.progress * 100)
      : null;
  const label = phaseLabel(progress);
  return (
    <div className="flex w-full max-w-sm flex-col gap-1">
      <div className="flex items-center justify-between text-[var(--text-xs)] text-[var(--color-muted)]">
        <span>{label}</span>
        <span className="tabular-nums">{pct === null ? "…" : `${pct}%`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-[var(--radius-full)] bg-[var(--color-surface-2)]">
        <div
          className={cn(
            "h-full rounded-[var(--radius-full)] bg-[var(--color-accent)] transition-[width]",
            pct === null && "w-1/3 animate-pulse",
          )}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V4" />
      <path d="M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}
