"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProjectSummary } from "@/features/projects";
import {
  createProject,
  deleteProject,
  listProjects,
} from "@/features/projects/service/api";
import { Badge, Button, Card, Input } from "@/shared/ui";

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createProject(n);
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string, projName: string) => {
    if (!confirm(`프로젝트 "${projName}" 을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }
    await deleteProject(id);
    await refresh();
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <div className="text-[var(--text-md)] font-semibold tracking-tight text-[var(--color-text-strong)]">
            Vision Labeler · Projects
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <h1 className="mb-4 text-[var(--text-xl)] font-semibold text-[var(--color-text-strong)]">프로젝트</h1>

        <Card padding="sm" className="mb-6 flex-row items-center gap-2">
          <form onSubmit={onCreate} className="flex w-full items-center gap-2">
            <Input
              size="md"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="새 프로젝트 이름"
              disabled={busy}
              className="flex-1"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={busy || !name.trim()}
            >
              {busy ? "만드는 중…" : "프로젝트 생성"}
            </Button>
          </form>
        </Card>

        {error && <p className="mb-3 text-[var(--text-sm)] text-[var(--color-danger)]">{error}</p>}

        {projects === null ? (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">불러오는 중…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
            아직 프로젝트가 없습니다. 위에서 새 프로젝트를 만드세요.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Card
                  padding="md"
                  className="group relative gap-1 transition-colors hover:border-[var(--color-accent)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/projects/${p.id}`}
                      className="min-w-0 flex-1 truncate text-[var(--text-md)] font-medium text-[var(--color-text-strong)] hover:text-[var(--color-accent)]"
                    >
                      {p.name}
                    </Link>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => void onDelete(p.id, p.name)}
                      aria-label="프로젝트 삭제"
                      className="invisible text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] group-hover:visible"
                    >
                      삭제
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[var(--text-xs)] text-[var(--color-muted)]">
                    <Badge tone="outline" size="xs">{p.videoCount} videos</Badge>
                    <Badge tone="outline" size="xs">{p.frameCount} frames</Badge>
                    <Badge tone="outline" size="xs">{p.annotationCount} labels</Badge>
                  </div>
                  <div className="text-[var(--text-2xs)] text-[var(--color-subtle)]">
                    {new Date(p.createdAt).toLocaleString()}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-8 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)]/50 p-4 text-[var(--text-sm)] text-[var(--color-muted)]">
          <div className="mb-1 font-medium text-[var(--color-text)]">멤버 관리</div>
          <div>멤버 추가/삭제 기능은 후속 업데이트에서 제공됩니다.</div>
        </section>
      </main>
    </div>
  );
}
