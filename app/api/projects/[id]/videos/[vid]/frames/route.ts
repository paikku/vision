import { NextResponse } from "next/server";
import {
  extFromName,
  getVideoMeta,
  mutateVideoData,
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

  // Stage frame ids and image bytes outside the lock so the critical section
  // is short. The lock is then taken just long enough to dedupe against the
  // current data.json contents and append the new entries.
  type Staged = { frame: StoredFrame; buf: Buffer };
  const staged: Staged[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!(f instanceof File)) continue;
    const fid = metas[i].id ?? crypto.randomUUID();
    const ext = extFromName(f.name || "frame.jpg", "jpg");
    const buf = Buffer.from(await f.arrayBuffer());
    staged.push({
      frame: {
        id: fid,
        videoId: vid,
        width: metas[i].width,
        height: metas[i].height,
        timestamp: metas[i].timestamp,
        label: metas[i].label,
        ext,
        createdAt: Date.now(),
      },
      buf,
    });
  }

  const added = await mutateVideoData(id, vid, async (data) => {
    const existing = new Set(data.frames.map((f) => f.id));
    const result: StoredFrame[] = [];
    for (const s of staged) {
      if (existing.has(s.frame.id)) continue; // dedupe (idempotent retry)
      await writeFrame(id, vid, s.frame.id, s.buf, s.frame.ext);
      data.frames.push(s.frame);
      result.push(s.frame);
    }
    return result;
  });

  return NextResponse.json({ frames: added }, { status: 201 });
}
