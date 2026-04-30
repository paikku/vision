import { NextResponse } from "next/server";
import {
  createImage,
  extFromName,
  getResource,
} from "@/lib/server/storage";
import type { ImageSource, VideoFrameMeta } from "@/features/images/types";

/**
 * Add Images to a Resource. Supports both image_batch (uploaded) and video
 * (video_frame) parents. The `meta` field is a JSON array of one entry per
 * file in `files`, in the same order:
 *
 *   {
 *     fileName: string;
 *     width: number;
 *     height: number;
 *     // video_frame only
 *     timestamp?: number;
 *     frameIndex?: number;
 *     // optional preassigned id (client-allocated UUID for retries)
 *     id?: string;
 *   }
 */
type ImageMetaEntry = {
  fileName: string;
  width: number;
  height: number;
  timestamp?: number;
  frameIndex?: number;
  id?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const resource = await getResource(id, rid);
  if (!resource) {
    return NextResponse.json({ error: "resource not found" }, { status: 404 });
  }

  const form = await req.formData();
  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") {
    return NextResponse.json({ error: "meta is required" }, { status: 400 });
  }
  let meta: ImageMetaEntry[];
  try {
    const parsed = JSON.parse(metaRaw);
    if (!Array.isArray(parsed)) throw new Error("meta must be an array");
    meta = parsed as ImageMetaEntry[];
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid meta" },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length !== meta.length) {
    return NextResponse.json(
      { error: `meta count (${meta.length}) != file count (${files.length})` },
      { status: 400 },
    );
  }

  const source: ImageSource =
    resource.type === "video" ? "video_frame" : "uploaded";
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const m = meta[i];
    const ext = extFromName(m.fileName || f.name, "jpg");
    const buf = Buffer.from(await f.arrayBuffer());
    const videoFrameMeta: VideoFrameMeta | undefined =
      source === "video_frame" && typeof m.timestamp === "number"
        ? { timestamp: m.timestamp, frameIndex: m.frameIndex }
        : undefined;
    const image = await createImage(id, {
      id: m.id,
      resourceId: rid,
      source,
      fileName: m.fileName || f.name,
      ext,
      width: m.width,
      height: m.height,
      bytes: buf,
      videoFrameMeta,
    });
    out.push(image);
  }
  return NextResponse.json({ images: out }, { status: 201 });
}
