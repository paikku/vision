import { NextResponse } from "next/server";
import {
  deleteProject,
  getProject,
  listVideos,
} from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const videos = await listVideos(id);
  return NextResponse.json({ project, videos });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
