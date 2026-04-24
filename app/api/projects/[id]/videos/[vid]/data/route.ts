import { NextResponse } from "next/server";
import {
  getVideoData,
  getVideoMeta,
  saveVideoData,
  type VideoData,
} from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const meta = await getVideoMeta(id, vid);
  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = await getVideoData(id, vid);
  return NextResponse.json({ meta, data });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const meta = await getVideoMeta(id, vid);
  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as Partial<VideoData>;

  // Frame lifecycle (image bytes + id + ext) is owned by the frames endpoint.
  // PUT data overlays only classes and annotations, so a save racing with a
  // concurrent frame upload can't drop frames. Annotations that reference
  // missing frames are filtered out defensively.
  const existing = await getVideoData(id, vid);
  const validFrameIds = new Set(existing.frames.map((f) => f.id));
  const next: VideoData = {
    classes: Array.isArray(body.classes) ? body.classes : existing.classes,
    frames: existing.frames,
    annotations: Array.isArray(body.annotations)
      ? body.annotations.filter((a) => validFrameIds.has(a.frameId))
      : existing.annotations,
  };
  await saveVideoData(id, vid, next);
  return NextResponse.json({ ok: true });
}
