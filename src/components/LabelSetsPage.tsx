"use client";

import Link from "next/link";

/**
 * Step 1 placeholder. LabelSet listing/creation UI lands in Step 4 alongside
 * the new labeling workspace. The API ({@link ./lib/server/storage.ts}) is
 * already wired up — this page just doesn't surface it yet.
 */
export function LabelSetsPage({ projectId }: { projectId: string }) {
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-muted)]">
          Step 4 에서 구현됩니다.
        </div>
      </main>
    </div>
  );
}
