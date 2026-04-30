"use client";

import { useEffect, useRef, useState } from "react";
import {
  evenlySpacedTimes,
  extractFrames,
  inferMediaKind,
  readMedia,
} from "@/features/media/service/capture";
import type { NormalizeProgress } from "@/features/media/service/normalize";
import {
  addImagesToResource,
  createResource,
  uploadResourcePreviews,
} from "@/features/resources/service/api";
import type { ResourceType } from "@/features/resources/types";
import { TagInput } from "./TagInput";

const PREVIEW_COUNT = 10;

type Mode = ResourceType;

export function UploadResourceModal({
  projectId,
  initialMode,
  onClose,
  onUploaded,
}: {
  projectId: string;
  initialMode: Mode;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [dragHover, setDragHover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Default the resource name from the first file picked.
  useEffect(() => {
    if (!name && files[0]) {
      setName(files[0].name.replace(/\.[^.]+$/, ""));
    }
  }, [files, name]);

  const onPick = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list);
    if (mode === "video") {
      const f = arr.find((x) => inferMediaKind(x) === "video");
      setFiles(f ? [f] : []);
      if (!f && arr.length > 0) setError("비디오 파일을 선택하세요.");
      else if (f) setError(null);
    } else {
      const imgs = arr.filter((x) => inferMediaKind(x) === "image");
      setFiles(imgs);
      if (imgs.length === 0) setError("이미지 파일을 선택하세요.");
      else setError(null);
    }
  };

  // Drag & drop: classify the dropped files and auto-switch mode if the
  // dropped batch clearly belongs to the other mode (e.g. user opened the
  // modal for "video" but dropped images, or vice versa).
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragHover(false);
    if (busy) return;
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length === 0) return;
    const videoFile = dropped.find((f) => inferMediaKind(f) === "video");
    const imageFiles = dropped.filter((f) => inferMediaKind(f) === "image");
    if (videoFile && imageFiles.length === 0) {
      if (mode !== "video") setMode("video");
      setFiles([videoFile]);
      if (!name) setName(videoFile.name.replace(/\.[^.]+$/, ""));
      setError(null);
      return;
    }
    if (imageFiles.length > 0 && !videoFile) {
      if (mode !== "image_batch") setMode("image_batch");
      setFiles(imageFiles);
      if (!name) setName(imageFiles[0].name.replace(/\.[^.]+$/, ""));
      setError(null);
      return;
    }
    // Mixed or unrecognized — fall back to current mode's filter.
    onPick(e.dataTransfer.files);
  };

  const switchMode = (next: Mode) => {
    if (busy) return;
    setMode(next);
    setFiles([]);
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    if (files.length === 0) {
      setError(mode === "video" ? "비디오 파일이 필요합니다." : "이미지 파일이 필요합니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "video") {
        await uploadVideo(
          projectId,
          name.trim(),
          tags,
          files[0],
          setProgress,
          setProgressPct,
        );
      } else {
        await uploadImageBatch(
          projectId,
          name.trim(),
          tags,
          files,
          setProgress,
          setProgressPct,
        );
      }
      onUploaded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setBusy(false);
      setProgress(null);
      setProgressPct(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={busy ? undefined : onClose}
    >
      <div
        data-keep-focus
        className={[
          "w-full max-w-md rounded-xl border bg-[var(--color-surface)] p-5 shadow-xl transition",
          dragHover
            ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/40"
            : "border-[var(--color-line)]",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          if (busy) return;
          e.preventDefault();
          setDragHover(true);
        }}
        onDragLeave={(e) => {
          // Only clear when leaving the modal box itself, not bubbling from
          // children — relatedTarget = null when leaving the window.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragHover(false);
          }
        }}
        onDrop={onDrop}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Resource 업로드</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
          >
            닫기
          </button>
        </div>

        <div className="mb-3 flex gap-2 text-xs">
          {(["video", "image_batch"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              disabled={busy}
              className={[
                "flex-1 rounded-md border px-2 py-1.5",
                mode === m
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-line)] hover:border-[var(--color-accent)]/50",
              ].join(" ")}
            >
              {m === "video" ? "Video" : "Image Batch"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Resource name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              placeholder={mode === "video" ? "line_a_video_001" : "scratch_crop_batch_001"}
              className="w-full rounded-md bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Initial tags</label>
            <TagInput value={tags} onChange={setTags} disabled={busy} />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-[var(--color-muted)]">
              {mode === "video" ? "Video file" : "Image files"}
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className={[
                "w-full rounded-md border border-dashed px-3 py-4 text-xs disabled:opacity-40",
                dragHover
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/60",
              ].join(" ")}
            >
              {files.length === 0
                ? mode === "video"
                  ? "비디오 파일을 끌어다 놓거나 클릭하여 선택…"
                  : "이미지 파일 여러 개를 끌어다 놓거나 클릭하여 선택…"
                : files.length === 1
                  ? files[0].name
                  : `${files.length} files selected`}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={mode === "video" ? "video/*" : "image/*"}
              multiple={mode === "image_batch"}
              className="sr-only"
              onChange={(e) => onPick(e.target.files)}
            />
            <p className="mt-1 text-[10px] text-[var(--color-muted)]">
              파일을 모달 어디든 드롭하면 자동으로 모드를 맞춰서 등록합니다.
            </p>
          </div>

          {progress && <ProgressDisplay label={progress} pct={progressPct} />}
          {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
          >
            {busy ? "업로드 중…" : "업로드"}
          </button>
        </div>
      </div>
    </div>
  );
}

async function uploadVideo(
  projectId: string,
  name: string,
  tags: string[],
  file: File,
  setProgress: (s: string | null) => void,
  setProgressPct: (n: number | null) => void,
): Promise<void> {
  setProgress("비디오 메타 분석 중…");
  setProgressPct(null);
  // Decoding has no determinate %unless the backend reports it. Tick a slow
  // pseudo-progress so the user sees motion instead of "stuck" UI.
  let pseudoTimer: ReturnType<typeof setInterval> | null = null;
  let pseudo = 0;
  const stopPseudo = () => {
    if (pseudoTimer) {
      clearInterval(pseudoTimer);
      pseudoTimer = null;
    }
  };
  const startPseudo = () => {
    stopPseudo();
    pseudo = 0;
    setProgressPct(0);
    pseudoTimer = setInterval(() => {
      // Asymptotic ramp toward 95% so we never claim done while waiting.
      pseudo += (95 - pseudo) * 0.04;
      setProgressPct(pseudo);
    }, 400);
  };

  const media = await readMedia(file, {
    onProgress: (p: NormalizeProgress) => {
      setProgress(phaseLabel(p));
      if (typeof p.progress === "number") {
        stopPseudo();
        setProgressPct(p.progress * 100);
      } else {
        // Indeterminate phase (decoding without backend % support, ffmpeg.wasm).
        startPseudo();
      }
    },
  });
  stopPseudo();
  try {
    setProgress("비디오 업로드 중…");
    setProgressPct(null);
    const resource = await createResource(projectId, {
      type: "video",
      name,
      tags,
      file: media.file ?? file,
      width: media.width,
      height: media.height,
      duration: media.duration,
      ingestVia: media.ingestVia,
    });

    if (media.duration && media.duration > 0) {
      setProgress("미리보기 추출 중…");
      const times = evenlySpacedTimes(media.duration, PREVIEW_COUNT);
      const frames = await extractFrames(media, {
        times,
        quality: 0.7,
        onProgress: (done, total) =>
          setProgressPct(total > 0 ? (done / total) * 100 : null),
      });
      try {
        const blobs = await Promise.all(
          frames.map(async (f) => (await fetch(f.url)).blob()),
        );
        setProgress("미리보기 업로드 중…");
        setProgressPct(null);
        await uploadResourcePreviews(projectId, resource.id, blobs).catch(() => {
          // Best-effort: previews are non-essential.
        });
      } finally {
        frames.forEach((f) => URL.revokeObjectURL(f.url));
      }
    }
  } finally {
    stopPseudo();
    URL.revokeObjectURL(media.url);
  }
}

async function uploadImageBatch(
  projectId: string,
  name: string,
  tags: string[],
  files: File[],
  setProgress: (s: string | null) => void,
  setProgressPct: (n: number | null) => void,
): Promise<void> {
  setProgress("이미지 메타 추출 중…");
  setProgressPct(null);
  const metas = await Promise.all(
    files.map(async (f) => {
      const dims = await readImageDimensions(f);
      return { file: f, fileName: f.name, ...dims };
    }),
  );
  setProgress("Resource 생성 중…");
  const resource = await createResource(projectId, {
    type: "image_batch",
    name,
    tags,
  });
  setProgress(`이미지 업로드 중… (0/${files.length})`);
  setProgressPct(0);
  const BATCH = 10;
  let done = 0;
  for (let i = 0; i < metas.length; i += BATCH) {
    const slice = metas.slice(i, i + BATCH);
    await addImagesToResource(
      projectId,
      resource.id,
      slice.map((m) => ({
        blob: m.file,
        fileName: m.fileName,
        width: m.width,
        height: m.height,
      })),
    );
    done += slice.length;
    setProgress(`이미지 업로드 중… (${done}/${files.length})`);
    setProgressPct((done / files.length) * 100);
  }
}

function ProgressDisplay({
  label,
  pct,
}: {
  label: string;
  pct: number | null;
}) {
  const display =
    pct === null
      ? null
      : `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
  return (
    <div className="rounded-md bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--color-muted)]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{display ?? "…"}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface)]">
        <div
          className={[
            "h-full rounded-full bg-[var(--color-accent)] transition-[width]",
            pct === null ? "w-1/3 animate-pulse" : "",
          ].join(" ")}
          style={pct === null ? undefined : { width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to read image: ${file.name}`));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function phaseLabel(p: NormalizeProgress): string {
  switch (p.phase) {
    case "uploading":
      return "서버로 업로드 중";
    case "decoding":
      return "서버 디코딩 중";
    case "downloading":
      return "결과 수신 중";
    case "local":
      return "브라우저 변환 중";
  }
}
