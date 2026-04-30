"use client";

import Link from "next/link";

/**
 * Step 1 placeholder. The actual labeling workspace lands in Step 4. The
 * existing annotation/frame/media features stay in place under
 * `src/features/{annotations,frames,media}/` and will be re-wired against the
 * LabelSet context (instead of the old video-scoped store) at that point.
 */
export function LabelingWorkspace({
  projectId,
  labelSetId,
}: {
  projectId: string;
  labelSetId: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <Link
          href={`/projects/${projectId}/labelsets`}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← LabelSets
        </Link>
        <div className="text-sm font-semibold tracking-tight">Labeling</div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-muted)]">
          <p>Step 4 에서 구현됩니다. (labelSetId: {labelSetId})</p>
        </div>
      </main>
    </div>
  );
}
