"use client";

import { useState } from "react";
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
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/shared/ui";

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
          previewFrames.forEach((f) => URL.revokeObjectURL(f.url));
          if (blobs.length > 0) {
            await uploadPreviews(projectId, video.id, blobs);
          }
        } catch {
          // best-effort: preview generation failure is non-blocking
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
    <Modal
      open
      size="lg"
      onClose={saving ? () => undefined : onClose}
      dismissOnBackdrop={!saving}
      dismissOnEscape={!saving}
      aria-label="동영상 추가"
    >
      <ModalHeader title="동영상 추가" onClose={saving ? undefined : onClose} />
      <ModalBody className="min-h-[360px] p-0">
        <MediaDropzone onComplete={handleComplete} />
      </ModalBody>
      {(saving || error) && (
        <ModalFooter className="justify-start text-[var(--text-sm)]">
          {stage === "uploading" ? (
            <span className="text-[var(--color-muted)]">서버에 저장 중…</span>
          ) : stage === "thumbnails" ? (
            <span className="text-[var(--color-muted)]">미리보기 썸네일 생성 중…</span>
          ) : (
            <span className="text-[var(--color-danger)]">{error}</span>
          )}
        </ModalFooter>
      )}
    </Modal>
  );
}
