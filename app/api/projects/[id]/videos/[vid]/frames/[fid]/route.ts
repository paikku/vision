import { NextResponse } from "next/server";
import {
  deleteFrame,
  getVideoData,
  mimeForExt,
  readFrame,
  saveVideoData,
} from "@/lib/server/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string; fid: string }> },
) {
  const { id, vid, fid } = await params;
  const data = await getVideoData(id, vid);
  const frame = data.frames.find((f) => f.id === fid);
  if (!frame) return NextResponse.json({ error: "not found" }, { status: 404 });
  const buf = await readFrame(id, vid, fid, frame.ext);
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mimeForExt(frame.ext),
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string; fid: string }> },
) {
  const { id, vid, fid } = await params;
  const data = await getVideoData(id, vid);
  const frame = data.frames.find((f) => f.id === fid);
  if (!frame) return NextResponse.json({ ok: true });
  await deleteFrame(id, vid, fid, frame.ext);
  data.frames = data.frames.filter((f) => f.id !== fid);
  data.annotations = data.annotations.filter((a) => a.frameId !== fid);
  await saveVideoData(id, vid, data);
  return NextResponse.json({ ok: true });
}
