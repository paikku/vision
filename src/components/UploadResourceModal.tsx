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
    } else {
      const imgs = arr.filter((x) => inferMediaKind(x) === "image");
      setFiles(imgs);
      if (imgs.length === 0) setError("이미지 파일을 선택하세요.");
    }
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
        await uploadVideo(projectId, name.trim(), tags, files[0], setProgress);
      } else {
        await uploadImageBatch(projectId, name.trim(), tags, files, setProgress);
      }
      onUploaded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={busy ? undefined : onClose}
    >
      <div
        data-keep-focus
        className="w-full max-w-md rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
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
              className="w-full rounded-md border border-dashed border-[var(--color-line)] px-3 py-3 text-xs text-[var(--color-muted)] hover:border-[var(--color-accent)]/60 disabled:opacity-40"
            >
              {files.length === 0
                ? mode === "video"
                  ? "비디오 파일 선택…"
                  : "이미지 파일 여러 개 선택…"
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
          </div>

          {progress && (
            <div className="rounded-md bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--color-muted)]">
              {progress}
            </div>
          )}
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
): Promise<void> {
  setProgress("비디오 메타 분석 중…");
  const media = await readMedia(file, {
    onProgress: (p: NormalizeProgress) => setProgress(phaseLabel(p)),
  });
  try {
    setProgress("비디오 업로드 중…");
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
      const frames = await extractFrames(media, { times, quality: 0.7 });
      try {
        const blobs = await Promise.all(
          frames.map(async (f) => (await fetch(f.url)).blob()),
        );
        setProgress("미리보기 업로드 중…");
        await uploadResourcePreviews(projectId, resource.id, blobs).catch(() => {
          // Best-effort: previews are non-essential.
        });
      } finally {
        frames.forEach((f) => URL.revokeObjectURL(f.url));
      }
    }
  } finally {
    URL.revokeObjectURL(media.url);
  }
}

async function uploadImageBatch(
  projectId: string,
  name: string,
  tags: string[],
  files: File[],
  setProgress: (s: string | null) => void,
): Promise<void> {
  setProgress("이미지 메타 추출 중…");
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
  }
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
