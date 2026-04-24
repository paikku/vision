"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { Badge } from "@/shared/ui";

export function ProjectTopBar({ projectId }: { projectId: string }) {
  const media = useStore((s) => s.media);
  const frames = useStore((s) => s.frames);
  const annotations = useStore((s) => s.annotations);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/projects/${projectId}`}
          className="text-[var(--text-sm)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          ← 프로젝트로
        </Link>
        {media && (
          <>
            <Badge tone="outline" size="xs" shape="pill" className="uppercase tracking-wide">
              {media.kind}
            </Badge>
            <span className="max-w-[40ch] truncate text-[var(--text-md)] font-medium text-[var(--color-text-strong)]">
              {media.name}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 text-[var(--text-sm)]">
        {media && (
          <span className="text-[var(--color-muted)]">
            {frames.length} frames · {annotations.length} labels · 자동 저장됨
          </span>
        )}
      </div>
    </header>
  );
}
