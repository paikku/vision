"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  deleteLabelSet,
  listLabelSets,
} from "@/features/labelsets/service/api";
import type { LabelSetSummary } from "@/features/labelsets/types";

export function LabelSetsPage({ projectId }: { projectId: string }) {
  const [labelsets, setLabelsets] = useState<LabelSetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    listLabelSets(projectId)
      .then(setLabelsets)
      .catch((e) => setError(e instanceof Error ? e.message : "로드 실패"));
  };

  useEffect(reload, [projectId]);

  const onDelete = async (ls: LabelSetSummary) => {
    if (
      !confirm(
        `LabelSet "${ls.name}" 을(를) 삭제하시겠습니까?\n어노테이션 ${ls.annotationCount}개가 함께 삭제됩니다.`,
      )
    ) {
      return;
    }
    await deleteLabelSet(projectId, ls.id);
    reload();
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <Link
          href={`/projects/${projectId}`}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← Media Library
        </Link>
        <div className="text-sm font-semibold tracking-tight">LabelSets</div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-sm font-semibold">LabelSet 목록</h1>
          <Link
            href={`/projects/${projectId}`}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            + 이미지 선택해서 새 LabelSet 만들기
          </Link>
        </div>

        {error && <p className="mb-3 text-xs text-[var(--color-danger)]">{error}</p>}

        {labelsets === null ? (
          <p className="text-sm text-[var(--color-muted)]">불러오는 중…</p>
        ) : labelsets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-xs text-[var(--color-muted)]">
            아직 LabelSet 이 없습니다. Media Library 에서 이미지를 선택한 뒤
            <span className="mx-1 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5">
              Start Labeling
            </span>
            을 누르세요.
          </div>
        ) : (
          <ul className="space-y-2">
            {labelsets.map((ls) => (
              <li
                key={ls.id}
                className="group flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 transition hover:border-[var(--color-accent)]/50"
              >
                <span
                  className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]"
                  title="LabelSet type"
                >
                  {ls.type}
                </span>
                <Link
                  href={`/projects/${projectId}/labelsets/${ls.id}`}
                  className="min-w-0 flex-1"
                >
                  <div className="truncate text-sm font-medium hover:text-[var(--color-accent)]">
                    {ls.name}
                  </div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {ls.imageCount} images · {ls.annotationCount} annotations ·{" "}
                    {new Date(ls.createdAt).toLocaleString()}
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => void onDelete(ls)}
                  className="invisible rounded-md border border-[var(--color-line)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] group-hover:visible"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
