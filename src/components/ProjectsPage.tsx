"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProjectSummary } from "@/features/projects";
import {
  createProject,
  deleteProject,
  listProjects,
} from "@/features/projects/service/api";

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
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <div className="text-sm font-semibold tracking-tight">Vision Labeler · Projects</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <h1 className="mb-4 text-lg font-semibold">프로젝트</h1>

        <form
          onSubmit={onCreate}
          className="mb-6 flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="새 프로젝트 이름"
            disabled={busy}
            className="flex-1 rounded-md bg-[var(--color-surface-2)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--color-muted)] focus:ring-1 focus:ring-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
          >
            {busy ? "만드는 중…" : "프로젝트 생성"}
          </button>
        </form>

        {error && <p className="mb-3 text-sm text-[var(--color-danger)]">{error}</p>}

        {projects === null ? (
          <p className="text-sm text-[var(--color-muted)]">불러오는 중…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center text-sm text-[var(--color-muted)]">
            아직 프로젝트가 없습니다. 위에서 새 프로젝트를 만드세요.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="group relative flex flex-col gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-accent)]/50"
              >
                <div className="flex items-start justify-between">
                  <Link
                    href={`/projects/${p.id}`}
                    className="text-sm font-medium hover:text-[var(--color-accent)]"
                  >
                    {p.name}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void onDelete(p.id, p.name)}
                    aria-label="프로젝트 삭제"
                    className="invisible rounded-md border border-[var(--color-line)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] group-hover:visible"
                  >
                    삭제
                  </button>
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {p.resourceCount} resources · {p.imageCount} images · {p.labelSetCount} label sets
                </div>
                <div className="text-[10px] text-[var(--color-muted)]">
                  {new Date(p.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-8 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)]/50 p-4 text-xs text-[var(--color-muted)]">
          <div className="mb-1 font-medium text-[var(--color-text)]">멤버 관리</div>
          <div>멤버 추가/삭제 기능은 후속 업데이트에서 제공됩니다.</div>
        </section>
      </main>
    </div>
  );
}
