"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Project } from "@/features/projects/types";
import { getProject } from "@/features/projects/service/api";

/**
 * Step 1 placeholder.
 *
 * Real Media Library UI lands in Step 2 (Resource Pool + Image Pool with
 * search/filter/tags and 4 view modes). For now this just verifies the
 * project exists and offers nav to LabelSets and back to Projects.
 */
export function MediaLibraryPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProject(projectId)
      .then(setProject)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "프로젝트 로드 실패"),
      );
  }, [projectId]);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <Link href="/projects" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]">
          ← 프로젝트 목록
        </Link>
        <div className="text-sm font-semibold tracking-tight">
          {project?.name ?? "Loading…"}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <Link
            href={`/projects/${projectId}/labelsets`}
            className="rounded-md border border-[var(--color-line)] px-2.5 py-1 hover:border-[var(--color-accent)]"
          >
            LabelSets
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h1 className="mb-3 text-lg font-semibold">Media Library</h1>
        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}
        <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-muted)]">
          <p className="mb-2">
            Step 1 — 데이터 모델 골격이 준비된 상태입니다. Resource Pool / Image
            Pool / 업로드 / 태그 / Frame Extraction UI 는 이후 단계에서
            구현됩니다.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>Step 2: Resource Pool + Image Pool (All / By Resource), 업로드 모달</li>
            <li>Step 3: Frame Extraction 페이지</li>
            <li>Step 4: Labeling 워크스페이스 (polygon / bbox / classify)</li>
            <li>Step 5: By Tag / Resource × Tag matrix · 검색 · bulk 작업</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
