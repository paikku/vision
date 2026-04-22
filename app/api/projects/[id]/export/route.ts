import { NextResponse } from "next/server";
import {
  getProject,
  getVideoData,
  getVideoMeta,
  listVideos,
} from "@/lib/server/storage";

export const runtime = "nodejs";

/**
 * Download labels + frame metadata for one or more videos within a project,
 * as a single JSON blob. Intentionally minimal ("단순한 json") — schema can
 * grow in a follow-up feature.
 *
 * ?videos=id1,id2  (optional — defaults to all videos in the project)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const videosParam = url.searchParams.get("videos");
  const allVideos = await listVideos(id);
  const pick = videosParam
    ? new Set(videosParam.split(",").filter(Boolean))
    : null;
  const chosen = pick
    ? allVideos.filter((v) => pick.has(v.id))
    : allVideos;

  const videos = [] as Array<{
    meta: Awaited<ReturnType<typeof getVideoMeta>>;
    data: Awaited<ReturnType<typeof getVideoData>>;
  }>;
  for (const v of chosen) {
    const [meta, data] = await Promise.all([
      getVideoMeta(id, v.id),
      getVideoData(id, v.id),
    ]);
    videos.push({ meta, data });
  }

  const payload = {
    version: 1,
    exportedAt: Date.now(),
    project: { id: project.id, name: project.name },
    videos: videos.map(({ meta, data }) => ({
      video: meta,
      classes: data.classes,
      frames: data.frames.map((f) => ({
        id: f.id,
        width: f.width,
        height: f.height,
        timestamp: f.timestamp,
        label: f.label,
      })),
      annotations: data.annotations,
    })),
  };
  const body = JSON.stringify(payload, null, 2);
  const filename = `${project.name.replace(/[^\w.-]+/g, "_") || "project"}.json`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
