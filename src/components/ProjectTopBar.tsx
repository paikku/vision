"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";

export function ProjectTopBar({ projectId }: { projectId: string }) {
  const media = useStore((s) => s.media);
  const frames = useStore((s) => s.frames);
  const annotations = useStore((s) => s.annotations);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${projectId}`}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          ← 프로젝트로
        </Link>
        {media && (
          <>
            <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              {media.kind}
            </span>
            <span className="max-w-[40ch] truncate text-sm font-medium">
              {media.name}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        {media && (
          <span className="text-[var(--color-muted)]">
            {frames.length} frames · {annotations.length} labels · 자동 저장됨
          </span>
        )}
      </div>
    </header>
  );
}
