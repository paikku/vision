"use client";

import { useCallback, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import {
  frameFromImage,
  inferMediaKind,
  readMedia,
} from "../service/capture";

export function MediaDropzone() {
  const setMedia = useStore((s) => s.setMedia);
  const addFrames = useStore((s) => s.addFrames);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [normalizeStatus, setNormalizeStatus] = useState<string | null>(null);
  const [normalizeProgress, setNormalizeProgress] = useState<number | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!inferMediaKind(file)) {
        setError("Drop an image or a video file.");
        return;
      }
      setError(null);
      setBusy(true);
      setNormalizeStatus("Analyzing video compatibility…");
      setNormalizeProgress(null);
      try {
        const media = await readMedia(file, {
          onNormalizeStatus: (status) => {
            if (status === "analyzing") setNormalizeStatus("Analyzing video compatibility…");
            if (status === "ready-original") setNormalizeStatus("Ready without transcoding.");
            if (status === "transcoding-server") setNormalizeStatus("Transcoding via server…");
            if (status === "transcoding-ffmpeg")
              setNormalizeStatus("Transcoding in browser (ffmpeg)…");
          },
          onNormalizeProgress: (ratio) => {
            setNormalizeProgress(Math.round(ratio * 100));
          },
        });
        setMedia(media);
        if (media.kind === "image") {
          addFrames([await frameFromImage(media)]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to read file");
      } finally {
        setBusy(false);
      }
    },
    [addFrames, setMedia],
  );

  return (
    <div className="flex h-full w-full items-center justify-center p-10">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHover(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={[
          "group flex w-full max-w-xl cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-10 py-16 text-center transition",
          hover
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
            : "border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/60",
        ].join(" ")}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-accent)]">
          <UploadIcon />
        </div>
        <div>
          <p className="text-base font-medium">
            {busy ? "Reading file…" : "Drop an image or video"}
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            or click to browse · jpg, png, webp, mp4, webm, mov, avi, mkv
          </p>
          {busy && normalizeStatus && (
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              {normalizeStatus}
              {normalizeProgress !== null ? ` (${normalizeProgress}%)` : ""}
            </p>
          )}
        </div>
        {error && (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          className="sr-only"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </label>
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
