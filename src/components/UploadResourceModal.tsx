"use client";

import { useEffect, useRef, useState } from "react";
import {
  evenlySpacedTimes,
  extractFrames,
  inferMediaKind,
  readMedia,
} from "@/features/media/service/capture";
import type { MediaSource } from "@/features/media/types";
import {
  uploadImageBatchResource,
  uploadPreviews,
  uploadVideoResource,
  type UploadImageBatchEntry,
} from "@/features/projects/service/api";

const PREVIEW_COUNT = 10;

type Props = {
  projectId: string;
  initialMode?: "video" | "image_batch";
  onClose: () => void;
  onUploaded: () => void;
};

type Stage = "idle" | "preparing" | "uploading" | "thumbnails";

export function UploadResourceModal({
  projectId,
  initialMode = "video",
  onClose,
  onUploaded,
}: Props) {
  const [mode, setMode] = useState<"video" | "image_batch">(initialMode);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saving = stage !== "idle";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    if (mode === "video") {
      const f = list[0];
      if (!f) return;
      if (inferMediaKind(f) !== "video") {
        setError("동영상 파일만 선택 가능합니다.");
        return;
      }
      setVideoFile(f);
      if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
    } else {
      const arr = Array.from(list).filter(
        (f) => inferMediaKind(f) === "image",
      );
      if (arr.length === 0) {
        setError("이미지 파일만 선택 가능합니다.");
        return;
      }
      setImageFiles(arr);
      if (!name.trim()) setName(`batch · ${arr.length}장`);
    }
  };

  const handleSubmit = async () => {
    if (saving) return;
    setError(null);

    const trimmedName = name.trim() || (mode === "video" ? "video" : "images");

    if (mode === "video") {
      if (!videoFile) {
        setError("동영상 파일을 선택하세요.");
        return;
      }
      setStage("preparing");
      let media: MediaSource;
      try {
        media = await readMedia(videoFile);
      } catch (e) {
        setError(e instanceof Error ? e.message : "비디오 읽기 실패");
        setStage("idle");
        return;
      }
      try {
        if (!media.file) throw new Error("normalized file unavailable");
        setStage("uploading");
        const resource = await uploadVideoResource(projectId, {
          file: media.file,
          name: trimmedName,
          width: media.width,
          height: media.height,
          duration: media.duration,
          ingestVia: media.ingestVia,
        });

        // Best-effort preview reel for the resource pool hover.
        if (media.duration && media.duration > 0) {
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
            previewFrames.forEach((f) => URL.revokeObjectURL(f.url));
            if (blobs.length > 0) {
              await uploadPreviews(projectId, resource.id, blobs);
            }
          } catch {
            // ignored: previews are best-effort
          }
        }
        onUploaded();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "업로드 실패");
      } finally {
        URL.revokeObjectURL(media.url);
        setStage("idle");
      }
      return;
    }

    // image_batch
    if (imageFiles.length === 0) {
      setError("이미지 파일을 선택하세요.");
      return;
    }
    setStage("preparing");
    try {
      const entries: UploadImageBatchEntry[] = await Promise.all(
        imageFiles.map(
          (f) =>
            new Promise<UploadImageBatchEntry>((resolve, reject) => {
              const url = URL.createObjectURL(f);
              const img = new Image();
              img.onload = () => {
                resolve({
                  file: f,
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                });
                URL.revokeObjectURL(url);
              };
              img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`이미지 로드 실패: ${f.name}`));
              };
              img.src = url;
            }),
        ),
      );
      setStage("uploading");
      await uploadImageBatchResource(projectId, trimmedName, entries);
      onUploaded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setStage("idle");
    }
  };

  const stageLabel =
    stage === "preparing"
      ? "파일 분석 중…"
      : stage === "uploading"
        ? "서버에 저장 중…"
        : stage === "thumbnails"
          ? "미리보기 썸네일 생성 중…"
          : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <div className="text-sm font-semibold">미디어 추가</div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
          >
            닫기 (Esc)
          </button>
        </header>

        <div className="flex flex-col gap-4 p-4">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setMode("video");
                setVideoFile(null);
                setImageFiles([]);
              }}
              className={[
                "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition",
                mode === "video"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-line)] hover:border-[var(--color-accent)]",
              ].join(" ")}
            >
              동영상 1개
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setMode("image_batch");
                setVideoFile(null);
                setImageFiles([]);
              }}
              className={[
                "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition",
                mode === "image_batch"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-line)] hover:border-[var(--color-accent)]",
              ].join(" ")}
            >
              이미지 묶음
            </button>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-muted)]">Resource 이름</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder={mode === "video" ? "예: line_a_video_001" : "예: scratch_crop_batch_001"}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <div
            className="rounded-lg border-2 border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center"
            onDragOver={(e) => {
              if (saving) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              if (saving) return;
              e.preventDefault();
              handleFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={mode === "video" ? "video/*" : "image/*"}
              multiple={mode === "image_batch"}
              disabled={saving}
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
            {mode === "video" ? (
              videoFile ? (
                <div className="text-sm">
                  <div className="font-medium">{videoFile.name}</div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">
                    {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-muted)]">
                  동영상 파일 1개를 드롭하거나{" "}
                  <button
                    type="button"
                    className="text-[var(--color-accent)] underline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    찾아보기
                  </button>
                </p>
              )
            ) : imageFiles.length > 0 ? (
              <div className="text-sm">
                <div className="font-medium">{imageFiles.length}개의 이미지 선택됨</div>
                <ul className="mt-2 max-h-32 overflow-y-auto text-left text-xs text-[var(--color-muted)]">
                  {imageFiles.slice(0, 8).map((f, i) => (
                    <li key={i} className="truncate">{f.name}</li>
                  ))}
                  {imageFiles.length > 8 && (
                    <li className="truncate">…외 {imageFiles.length - 8}장</li>
                  )}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">
                이미지 파일들을 드롭하거나{" "}
                <button
                  type="button"
                  className="text-[var(--color-accent)] underline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  찾아보기
                </button>
              </p>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
          {stageLabel ? (
            <span className="text-xs text-[var(--color-muted)]">{stageLabel}</span>
          ) : error ? (
            <span className="text-xs text-[var(--color-danger)]">{error}</span>
          ) : (
            <span className="text-xs text-[var(--color-muted)]">
              {mode === "video"
                ? "동영상은 업로드 후 [Frame Extraction]에서 프레임을 뽑아냅니다."
                : "업로드한 이미지는 즉시 Image Pool에 등록됩니다."}
            </span>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSubmit()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
          >
            업로드
          </button>
        </footer>
      </div>
    </div>
  );
}
