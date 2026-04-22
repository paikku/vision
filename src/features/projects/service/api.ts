import type {
  Project,
  ProjectSummary,
  StoredFrame,
  VideoData,
  VideoMeta,
  VideoSummary,
} from "../types";

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

export async function getProjectDetail(
  id: string,
): Promise<{ project: Project; videos: VideoSummary[] }> {
  const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
  return asJson<{ project: Project; videos: VideoSummary[] }>(r);
}

export async function listVideos(projectId: string): Promise<VideoSummary[]> {
  const r = await fetch(`/api/projects/${projectId}/videos`, {
    cache: "no-store",
  });
  const { videos } = await asJson<{ videos: VideoSummary[] }>(r);
  return videos;
}

export type UploadVideoInput = {
  file: File;
  name: string;
  kind: "video" | "image";
  width: number;
  height: number;
  duration?: number;
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
};

export async function uploadVideo(
  projectId: string,
  input: UploadVideoInput,
): Promise<VideoMeta> {
  const form = new FormData();
  form.append("file", input.file, input.file.name);
  form.append("name", input.name);
  form.append("kind", input.kind);
  form.append("width", String(input.width));
  form.append("height", String(input.height));
  if (input.duration != null) form.append("duration", String(input.duration));
  if (input.ingestVia) form.append("ingestVia", input.ingestVia);
  const r = await fetch(`/api/projects/${projectId}/videos`, {
    method: "POST",
    body: form,
  });
  const { video } = await asJson<{ video: VideoMeta }>(r);
  return video;
}

export async function deleteVideo(
  projectId: string,
  videoId: string,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/videos/${videoId}`, {
    method: "DELETE",
  });
}

export async function getVideoData(
  projectId: string,
  videoId: string,
): Promise<{ meta: VideoMeta; data: VideoData }> {
  const r = await fetch(
    `/api/projects/${projectId}/videos/${videoId}/data`,
    { cache: "no-store" },
  );
  return asJson<{ meta: VideoMeta; data: VideoData }>(r);
}

export async function saveVideoData(
  projectId: string,
  videoId: string,
  data: VideoData,
): Promise<void> {
  await fetch(`/api/projects/${projectId}/videos/${videoId}/data`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function videoSourceUrl(projectId: string, videoId: string): string {
  return `/api/projects/${projectId}/videos/${videoId}/source`;
}

export function frameImageUrl(
  projectId: string,
  videoId: string,
  frameId: string,
): string {
  return `/api/projects/${projectId}/videos/${videoId}/frames/${frameId}`;
}

export type UploadFrameInput = {
  id?: string;
  blob: Blob;
  width: number;
  height: number;
  timestamp?: number;
  label: string;
};

export async function uploadFrames(
  projectId: string,
  videoId: string,
  frames: UploadFrameInput[],
): Promise<StoredFrame[]> {
  const form = new FormData();
  const meta = frames.map((f) => ({
    id: f.id,
    width: f.width,
    height: f.height,
    timestamp: f.timestamp,
    label: f.label,
  }));
  form.append("meta", JSON.stringify(meta));
  frames.forEach((f, i) =>
    form.append("files", f.blob, `frame-${i}.jpg`),
  );
  const r = await fetch(`/api/projects/${projectId}/videos/${videoId}/frames`, {
    method: "POST",
    body: form,
  });
  const { frames: out } = await asJson<{ frames: StoredFrame[] }>(r);
  return out;
}

export async function deleteFrame(
  projectId: string,
  videoId: string,
  frameId: string,
): Promise<void> {
  await fetch(
    `/api/projects/${projectId}/videos/${videoId}/frames/${frameId}`,
    { method: "DELETE" },
  );
}

export function exportUrl(projectId: string, videoIds?: string[]): string {
  const base = `/api/projects/${projectId}/export`;
  if (!videoIds || videoIds.length === 0) return base;
  return `${base}?videos=${encodeURIComponent(videoIds.join(","))}`;
}
