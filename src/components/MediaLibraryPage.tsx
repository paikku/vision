"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listImages } from "@/features/images/service/api";
import type { Image } from "@/features/images/types";
import { getProject } from "@/features/projects/service/api";
import type { Project } from "@/features/projects/types";
import { listResources } from "@/features/resources/service/api";
import type { ResourceSummary } from "@/features/resources/types";
import { ImagePool, type ImageSelection } from "./ImagePool";
import { ResourcePool, type ResourceSelection } from "./ResourcePool";
import { StartLabelingModal } from "./StartLabelingModal";
import { UploadResourceModal } from "./UploadResourceModal";

export function MediaLibraryPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [resources, setResources] = useState<ResourceSummary[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [resourceSelection, setResourceSelection] = useState<ResourceSelection>({
    resourceId: null,
    resourceTags: [],
  });
  const [imageSelection, setImageSelection] = useState<ImageSelection>({
    ids: new Set(),
  });

  const [uploadMode, setUploadMode] = useState<"video" | "image_batch" | null>(
    null,
  );
  const [labelingOpen, setLabelingOpen] = useState(false);

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
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Link
            href={`/projects/${projectId}/labelsets`}
            className="rounded-md border border-[var(--color-line)] px-2.5 py-1 hover:border-[var(--color-accent)]"
          >
            LabelSets
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold">Media Library</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUploadMode("video")}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black"
            >
              Upload Video
            </button>
            <button
              type="button"
              onClick={() => setUploadMode("image_batch")}
              className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs hover:border-[var(--color-accent)]"
            >
              Upload Images
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

        <ResourcePool
          projectId={projectId}
          resources={resources}
          reload={reloadResources}
          selection={resourceSelection}
          onSelect={setResourceSelection}
        />

        <ImagePool
          projectId={projectId}
          images={images}
          resources={resources}
          selectedResourceId={resourceSelection.resourceId}
          selection={imageSelection}
          onSelectionChange={setImageSelection}
          onStartLabeling={() => setLabelingOpen(true)}
          onImagesMutated={() => void reloadResources()}
        />
      </main>

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
