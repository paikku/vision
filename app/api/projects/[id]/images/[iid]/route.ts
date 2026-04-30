import { NextResponse } from "next/server";
import {
  deleteImage,
  getImage,
  updateImage,
} from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; iid: string }> },
) {
  const { id, iid } = await params;
  const image = await getImage(id, iid);
  if (!image) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ image });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; iid: string }> },
) {
  const { id, iid } = await params;
  const patch = (await req.json().catch(() => ({}))) as { tags?: string[] };
  const image = await updateImage(id, iid, patch);
  if (!image) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ image });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; iid: string }> },
) {
  const { id, iid } = await params;
  await deleteImage(id, iid);
  return NextResponse.json({ ok: true });
}
