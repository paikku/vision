"use client";

import { useRef, useState } from "react";
import { bulkTagImages } from "@/features/images/service/api";
import { TagInput } from "./TagInput";

type BulkTagMode = "add" | "remove" | "replace";

export function BulkTagBar({
  projectId,
  imageIds,
  onClose,
  onMutated,
}: {
  projectId: string;
  imageIds: string[];
  onClose: () => void;
  onMutated: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [mode, setMode] = useState<BulkTagMode>("add");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const lastFeedbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tagsLabel =
    tags.length === 0 ? "(태그 없음)" : tags.map((t) => `\`${t}\``).join(", ");
  const preview = (() => {
    const n = imageIds.length;
    if (mode === "add") {
      return tags.length === 0
        ? `${n}장 — 적용할 태그를 입력하세요.`
        : `선택된 ${n}장에 ${tagsLabel} 를 추가합니다.`;
    }
    if (mode === "remove") {
      return tags.length === 0
        ? `${n}장 — 제거할 태그를 입력하세요.`
        : `선택된 ${n}장에서 ${tagsLabel} 를 제거합니다.`;
    }
    return tags.length === 0
      ? `선택된 ${n}장의 모든 태그를 비웁니다.`
      : `선택된 ${n}장의 기존 태그를 모두 지우고 ${tagsLabel} 로 교체합니다.`;
  })();

  const apply = async () => {
    if (busy) return;
    if (mode !== "replace" && tags.length === 0) {
      setFeedback("적용할 태그를 입력하세요.");
      return;
    }
    if (mode === "replace") {
      const msg =
        tags.length === 0
          ? `${imageIds.length}장의 기존 태그를 모두 지웁니다.\n계속하시겠습니까?`
          : `${imageIds.length}장의 기존 태그를 모두 지우고 새 태그로 교체합니다.\n계속하시겠습니까?`;
      if (!confirm(msg)) return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const { updated } = await bulkTagImages(projectId, imageIds, tags, mode);
      setFeedback(`${updated}장 갱신 완료`);
      onMutated();
      if (lastFeedbackRef.current) clearTimeout(lastFeedbackRef.current);
      lastFeedbackRef.current = setTimeout(() => setFeedback(null), 2000);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  };

  const applyDisabled = busy || (mode !== "replace" && tags.length === 0);
  const applyLabel = busy
    ? "적용 중…"
    : `${modeLabel(mode)} 적용 (${imageIds.length}장)`;

  return (
    <div className="space-y-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="태그 적용 모드"
          className="flex overflow-hidden rounded-md border border-[var(--color-line)]"
        >
          {(["add", "remove", "replace"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              disabled={busy}
              className={[
                "px-2.5 py-1 text-[11px] transition disabled:opacity-40",
                mode === m
                  ? m === "replace"
                    ? "bg-[var(--color-danger)] font-medium text-white"
                    : "bg-[var(--color-accent)] font-medium text-black"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
              ].join(" ")}
            >
              {modeLabel(m)}
            </button>
          ))}
        </div>
        <div className="min-w-[200px] flex-1">
          <TagInput value={tags} onChange={setTags} disabled={busy} />
        </div>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={applyDisabled}
          className={[
            "rounded-md px-2.5 py-1 font-medium disabled:opacity-40",
            mode === "replace"
              ? "bg-[var(--color-danger)] text-white"
              : "bg-[var(--color-accent)] text-black",
          ].join(" ")}
        >
          {applyLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          닫기
        </button>
      </div>
      <p className="text-[10.5px] text-[var(--color-muted)]">
        {preview}
        {feedback && (
          <span className="ml-2 text-[var(--color-accent)]">· {feedback}</span>
        )}
      </p>
    </div>
  );
}

function modeLabel(mode: BulkTagMode): string {
  if (mode === "add") return "추가";
  if (mode === "remove") return "제거";
  return "교체";
}
