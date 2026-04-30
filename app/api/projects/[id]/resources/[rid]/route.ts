import { NextResponse } from "next/server";
import {
  deleteResource,
  getResource,
  updateResource,
} from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const resource = await getResource(id, rid);
  if (!resource) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ resource });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const patch = (await req.json().catch(() => ({}))) as {
    name?: string;
    tags?: string[];
  };
  const resource = await updateResource(id, rid, patch);
  if (!resource) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ resource });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  await deleteResource(id, rid);
  return NextResponse.json({ ok: true });
}
