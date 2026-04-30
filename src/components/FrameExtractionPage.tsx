"use client";

import Link from "next/link";

/**
 * Step 1 placeholder. Frame Extraction implementation lands in Step 3, where
 * the existing video timeline + capture pipeline will be moved into this
 * dedicated route and write extracted frames to the new Image store
 * (source = "video_frame").
 */
export function FrameExtractionPage({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <Link
          href={`/projects/${projectId}`}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← Media Library
        </Link>
        <div className="text-sm font-semibold tracking-tight">Frame Extraction</div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-muted)]">
          <p>Step 3 에서 구현됩니다. (resourceId: {resourceId})</p>
        </div>
      </main>
    </div>
  );
}
