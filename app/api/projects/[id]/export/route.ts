import { NextResponse } from "next/server";
import {
  getProject,
  getVideoData,
  getVideoMeta,
  listVideos,
} from "@/lib/server/storage";

export const runtime = "nodejs";

/**
 * Download labels + frame metadata as a single JSON blob. Intentionally
 * minimal ("단순한 json") — schema can grow in a follow-up feature.
 *
 * Query params (optional):
 *   ?frames=fid1,fid2  pick specific frame ids (videos/annotations are
 *                      filtered to match)
 *   ?videos=vid1,vid2  include all frames of these videos
 *
 * If neither is set, exports everything in the project.
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
  const framesParam = url.searchParams.get("frames");
  const videosParam = url.searchParams.get("videos");
  const frameSet = framesParam
    ? new Set(framesParam.split(",").filter(Boolean))
    : null;
  const videoSet = videosParam
    ? new Set(videosParam.split(",").filter(Boolean))
    : null;

  const allVideos = await listVideos(id);

  const videos: Array<{
    video: Awaited<ReturnType<typeof getVideoMeta>>;
    classes: Awaited<ReturnType<typeof getVideoData>>["classes"];
    frames: Array<{
      id: string;
      width: number;
      height: number;
      timestamp?: number;
      label: string;
    }>;
    annotations: Awaited<ReturnType<typeof getVideoData>>["annotations"];
  }> = [];

  for (const v of allVideos) {
    const [meta, data] = await Promise.all([
      getVideoMeta(id, v.id),
      getVideoData(id, v.id),
    ]);
    // Frame inclusion: explicit frame set wins, otherwise fall back to video
    // selection, otherwise include everything.
    const includedFrames = data.frames.filter((f) => {
      if (frameSet) return frameSet.has(f.id);
      if (videoSet) return videoSet.has(v.id);
      return true;
    });
    if (includedFrames.length === 0 && (frameSet || videoSet)) continue;
    const frameIds = new Set(includedFrames.map((f) => f.id));
    videos.push({
      video: meta,
      classes: data.classes,
      frames: includedFrames.map((f) => ({
        id: f.id,
        width: f.width,
        height: f.height,
        timestamp: f.timestamp,
        label: f.label,
      })),
      annotations: data.annotations.filter((a) => frameIds.has(a.frameId)),
    });
  }

  const payload = {
    version: 1,
    exportedAt: Date.now(),
    project: { id: project.id, name: project.name },
    videos,
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
