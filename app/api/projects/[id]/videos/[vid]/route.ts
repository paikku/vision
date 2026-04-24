import { NextResponse } from "next/server";
import { deleteVideo, getVideoMeta } from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const meta = await getVideoMeta(id, vid);
  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ video: meta });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  await deleteVideo(id, vid);
  return NextResponse.json({ ok: true });
}
