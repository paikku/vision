import { NextResponse } from "next/server";
import {
  deleteProject,
  getProject,
  listImages,
  listLabelSets,
  listResources,
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const [resources, images, labelsets] = await Promise.all([
    listResources(id),
    listImages(id),
    listLabelSets(id),
  ]);
  return NextResponse.json({ project, resources, images, labelsets });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
