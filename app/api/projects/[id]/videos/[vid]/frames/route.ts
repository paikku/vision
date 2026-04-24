import { NextResponse } from "next/server";
import {
  extFromName,
  getVideoData,
  getVideoMeta,
  saveVideoData,
  writeFrame,
  type StoredFrame,
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accepts a multipart form with one or more frame files. Each file contributes
 * a new StoredFrame entry; per-frame metadata (timestamp, label) is sent via
 * `meta` JSON blob in the same form (parallel arrays).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const video = await getVideoMeta(id, vid);
  if (!video) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string") {
    return NextResponse.json({ error: "meta required" }, { status: 400 });
  }
  const metas = JSON.parse(metaRaw) as Array<{
    id?: string;
    width: number;
    height: number;
    timestamp?: number;
    label: string;
  }>;

  const files = form.getAll("files");
  if (files.length !== metas.length) {
    return NextResponse.json(
      { error: "files/meta length mismatch" },
      { status: 400 },
    );
  }

  const data = await getVideoData(id, vid);
  const added: StoredFrame[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!(f instanceof File)) continue;
    const fid = metas[i].id ?? crypto.randomUUID();
    if (data.frames.some((x) => x.id === fid)) continue; // dedupe
    const ext = extFromName(f.name || "frame.jpg", "jpg");
    const buf = Buffer.from(await f.arrayBuffer());
    await writeFrame(id, vid, fid, buf, ext);
    const frame: StoredFrame = {
      id: fid,
      videoId: vid,
      width: metas[i].width,
      height: metas[i].height,
      timestamp: metas[i].timestamp,
      label: metas[i].label,
      ext,
      createdAt: Date.now(),
    };
    data.frames.push(frame);
    added.push(frame);
  }
  await saveVideoData(id, vid, data);
  return NextResponse.json({ frames: added }, { status: 201 });
}
