import type { Project, ProjectSummary } from "../types";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const r = await fetch("/api/projects", { cache: "no-store" });
  const { projects } = await asJson<{ projects: ProjectSummary[] }>(r);
  return projects;
}

export async function createProject(name: string): Promise<Project> {
  const r = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const { project } = await asJson<{ project: Project }>(r);
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: "DELETE" });
}

export async function getProject(id: string): Promise<Project> {
  const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
  const { project } = await asJson<{ project: Project }>(r);
  return project;
}
