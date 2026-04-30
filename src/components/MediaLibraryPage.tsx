"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listImages } from "@/features/images/service/api";
import type { Image } from "@/features/images/types";
import { getProject } from "@/features/projects/service/api";
import type { Project } from "@/features/projects/types";
import { listResources } from "@/features/resources/service/api";
import type { ResourceSummary } from "@/features/resources/types";
import { BulkTagBar } from "./BulkTagBar";
import {
  ImagePool,
  type ImagePoolContext,
  type ImageSelection,
} from "./ImagePool";
import { ResourcePool, type ResourceSelection } from "./ResourcePool";
import { StartLabelingModal } from "./StartLabelingModal";
import { UploadResourceModal } from "./UploadResourceModal";

const EMPTY_POOL_CONTEXT: ImagePoolContext = {
  filteredIds: [],
  visibleIds: [],
};

export function MediaLibraryPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [resourceSelection, setResourceSelection] = useState<ResourceSelection>({
    resourceIds: new Set(),
  });
  const [imageSelection, setImageSelection] = useState<ImageSelection>({
    ids: new Set(),
  });

  const [uploadMode, setUploadMode] = useState<"video" | "image_batch" | null>(
    null,
  );
  const [labelingOpen, setLabelingOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [poolContext, setPoolContext] = useState<ImagePoolContext>(
    EMPTY_POOL_CONTEXT,
  );

  const reload = useCallback(async () => {
    try {
      const [p, rs, imgs] = await Promise.all([
        getProject(projectId),
        listResources(projectId),
        listImages(projectId),
      ]);
      setProject(p);
      setResources(rs);
      setImages(imgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const reloadResources = useCallback(async () => {
    const [rs, imgs] = await Promise.all([
      listResources(projectId),
      listImages(projectId),
    ]);
    setResources(rs);
    setImages(imgs);
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Auto-collapse the bulk-tag bar when selection drops to zero (otherwise
  // users see an empty editor pinned over an inactive footer).
  useEffect(() => {
    if (imageSelection.ids.size === 0) setBulkTagOpen(false);
  }, [imageSelection.ids]);

  const selectedCount = imageSelection.ids.size;
  const hasSelection = selectedCount > 0;
  const visibleCount = poolContext.visibleIds.length;
  const filteredCount = poolContext.filteredIds.length;

  const selectMany = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setImageSelection((prev) => {
        const next = new Set(prev.ids);
        for (const id of ids) next.add(id);
        return { ids: next };
      });
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setImageSelection({ ids: new Set() });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <Link
          href="/projects"
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
        >
          ← 프로젝트 목록
        </Link>
        <div className="text-sm font-semibold tracking-tight">
          {project?.name ?? (loading ? "Loading…" : projectId)}
        </div>
        <nav className="ml-4 flex items-center gap-1 text-xs">
          <span className="rounded-md bg-[var(--color-accent-soft)] px-2.5 py-1 font-medium text-[var(--color-accent)]">
            Media
          </span>
          <Link
            href={`/projects/${projectId}/labelsets`}
            className="rounded-md px-2.5 py-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            LabelSets →
          </Link>
        </nav>
        <div className="ml-auto" />
      </header>

      {/*
        Two-column layout: thin left sidebar holds ResourcePool (the
        "where does this come from" filter source + Frame Extraction
        entry point), the right column is dominated by ImagePool where
        the actual selection / labeling decisions happen. The aside is
        sticky so it stays visible while the user scrolls a long pool.
      */}
      <main className="flex w-full flex-1 flex-col gap-4 px-4 pt-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold">Media Library</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUploadMode("video")}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black"
              title="비디오 또는 이미지 파일을 드롭하면 자동으로 분류됩니다"
            >
              + 업로드
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

        <div className="flex flex-1 flex-col gap-4 lg:flex-row">
          <aside className="flex flex-col lg:sticky lg:top-14 lg:w-72 lg:shrink-0 lg:self-start lg:max-h-[calc(100vh-7rem)]">
            <ResourcePool
              projectId={projectId}
              resources={resources}
              reload={reloadResources}
              selection={resourceSelection}
              onSelect={setResourceSelection}
            />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <ImagePool
              projectId={projectId}
              images={images}
              resources={resources}
              selectedResourceIds={resourceSelection.resourceIds}
              onResourceSelectionChange={(next) =>
                setResourceSelection({ resourceIds: next })
              }
              selection={imageSelection}
              onSelectionChange={setImageSelection}
              onContextChange={setPoolContext}
            />
          </div>
        </div>
      </main>

      {/*
        Sticky CTA group. Always present so users learn the
        "select images → make a label set" workflow even before any selection.
        When nothing is selected the destructive/follow-up actions disable;
        the entry-point selectors ("현재 페이지 / 결과 전체") stay live so
        users have a way to bulk-pick from the keyboard-free path.
      */}
      <div className="sticky bottom-0 z-20 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur">
        {bulkTagOpen && hasSelection && (
          <BulkTagBar
            projectId={projectId}
            imageIds={Array.from(imageSelection.ids)}
            onClose={() => setBulkTagOpen(false)}
            onMutated={() => void reloadResources()}
          />
        )}
        <div className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-[11px]">
          <span
            className={
              hasSelection
                ? "font-medium text-[var(--color-accent)]"
                : "text-[var(--color-muted)]"
            }
          >
            {hasSelection
              ? `${selectedCount}장 선택됨`
              : "선택된 이미지 없음"}
          </span>
          <span className="text-[var(--color-muted)]">
            {hasSelection
              ? `· ${filteredCount}장 중`
              : "· 이미지를 골라 라벨셋을 만들 수 있어요"}
          </span>

          <FooterButton
            onClick={() => selectMany(poolContext.visibleIds)}
            disabled={visibleCount === 0}
          >
            현재 페이지 전체 선택
          </FooterButton>
          <FooterButton
            onClick={() => selectMany(poolContext.filteredIds)}
            disabled={filteredCount === 0}
          >
            현재 결과 전체 선택{filteredCount > 0 ? ` (${filteredCount})` : ""}
          </FooterButton>
          <FooterButton onClick={clearSelection} disabled={!hasSelection}>
            선택 해제
          </FooterButton>
          <FooterButton
            onClick={() => setBulkTagOpen((v) => !v)}
            disabled={!hasSelection}
            active={bulkTagOpen}
          >
            태그 일괄…
          </FooterButton>

          <button
            type="button"
            onClick={() => setLabelingOpen(true)}
            disabled={!hasSelection}
            className={[
              "ml-auto rounded-md px-3 py-1 font-medium transition",
              hasSelection
                ? "bg-[var(--color-accent)] text-black hover:brightness-110"
                : "bg-[var(--color-surface-2)] text-[var(--color-muted)] cursor-not-allowed",
            ].join(" ")}
            title={
              hasSelection
                ? "선택한 이미지로 LabelSet 생성/추가"
                : "먼저 이미지를 선택하세요"
            }
          >
            라벨셋 →
          </button>
        </div>
      </div>

      {uploadMode && (
        <UploadResourceModal
          projectId={projectId}
          initialMode={uploadMode}
          onClose={() => setUploadMode(null)}
          onUploaded={() => void reloadResources()}
        />
      )}

      {labelingOpen && (
        <StartLabelingModal
          projectId={projectId}
          imageIds={Array.from(imageSelection.ids)}
          onClose={() => setLabelingOpen(false)}
        />
      )}
    </div>
  );
}

function FooterButton({
  onClick,
  disabled,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-md border px-2 py-0.5 transition",
        disabled
          ? "border-[var(--color-line)] bg-transparent text-[var(--color-muted)] opacity-50 cursor-not-allowed"
          : active
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
            : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-accent)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
