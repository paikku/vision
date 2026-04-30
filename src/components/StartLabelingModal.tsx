"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  createLabelSet,
  listLabelSets,
  updateLabelSet,
  getLabelSet,
} from "@/features/labelsets/service/api";
import type {
  LabelSetSummary,
  LabelSetType,
} from "@/features/labelsets/types";

/**
 * Hand-off from the Image Pool selection to the labeling workspace. The user
 * picks between creating a new LabelSet (with a labeling type) or appending
 * the selected images to an existing LabelSet, then is navigated into the
 * labeling page for that set.
 *
 * For "append to existing" we union the new ids with the current `imageIds`
 * server-side via PATCH so duplicates are silently de-duped.
 */
export function StartLabelingModal({
  projectId,
  imageIds,
  onClose,
}: {
  projectId: string;
  imageIds: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [type, setType] = useState<LabelSetType>("polygon");
  const [labelsets, setLabelsets] = useState<LabelSetSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLabelSets(projectId)
      .then(setLabelsets)
      .catch((e) => setError(e instanceof Error ? e.message : "LabelSet 로드 실패"));
  }, [projectId]);

  const onCreateNew = async () => {
    if (!name.trim()) {
      setError("이름을 입력하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ls = await createLabelSet(projectId, {
        name: name.trim(),
        type,
        imageIds,
      });
      router.push(`/projects/${projectId}/labelsets/${ls.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  };

  const onAppendTo = async (lsid: string) => {
    setBusy(true);
    setError(null);
    try {
      const current = await getLabelSet(projectId, lsid);
      const merged = Array.from(new Set([...current.imageIds, ...imageIds]));
      await updateLabelSet(projectId, lsid, { imageIds: merged });
      router.push(`/projects/${projectId}/labelsets/${lsid}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setBusy(false);
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
          <h2 className="text-sm font-semibold">
            Start Labeling — {imageIds.length}장
          </h2>
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
          {(["new", "existing"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              disabled={busy}
              className={[
                "flex-1 rounded-md border px-2 py-1.5",
                tab === t
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-line)] hover:border-[var(--color-accent)]/50",
              ].join(" ")}
            >
              {t === "new" ? "새 LabelSet" : "기존 LabelSet 에 추가"}
            </button>
          ))}
        </div>

        {tab === "new" ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] text-[var(--color-muted)]">이름</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="scratch_v1"
                disabled={busy}
                className="w-full rounded-md bg-[var(--color-surface-2)] px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-[var(--color-muted)]">라벨 타입</label>
              <div className="flex gap-2 text-xs">
                {(["polygon", "bbox", "classify"] as LabelSetType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    disabled={busy}
                    className={[
                      "flex-1 rounded-md border px-2 py-1.5",
                      type === t
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : "border-[var(--color-line)] hover:border-[var(--color-accent)]/50",
                    ].join(" ")}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void onCreateNew()}
                disabled={busy}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
              >
                {busy ? "생성 중…" : "생성하고 이동"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {labelsets === null ? (
              <p className="text-xs text-[var(--color-muted)]">불러오는 중…</p>
            ) : labelsets.length === 0 ? (
              <p className="text-xs text-[var(--color-muted)]">기존 LabelSet 이 없습니다.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {labelsets.map((ls) => (
                  <li
                    key={ls.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs hover:border-[var(--color-accent)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{ls.name}</div>
                      <div className="text-[10px] text-[var(--color-muted)]">
                        {ls.type} · {ls.imageCount} images · {ls.annotationCount} labels
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onAppendTo(ls.id)}
                      disabled={busy}
                      className="rounded-md bg-[var(--color-accent)] px-2 py-1 text-[11px] font-medium text-black disabled:opacity-40"
                    >
                      추가하고 이동
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
