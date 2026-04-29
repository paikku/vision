import { NextResponse } from "next/server";
import {
  deleteResource,
  getResourceMeta,
  listImages,
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const resource = await getResourceMeta(id, rid);
  if (!resource) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const allImages = await listImages(id);
  const images = allImages.filter((im) => im.resourceId === rid);
  return NextResponse.json({ resource, images });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  await deleteResource(id, rid);
  return NextResponse.json({ ok: true });
}
