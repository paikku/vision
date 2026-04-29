import { NextResponse } from "next/server";
import {
  deleteImage,
  mimeForExt,
  readImageBytes,
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; iid: string }> },
) {
  const { id, iid } = await params;
  const found = await readImageBytes(id, iid);
  if (!found) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(found.data), {
    status: 200,
    headers: {
      "Content-Type": mimeForExt(found.ext),
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; iid: string }> },
) {
  const { id, iid } = await params;
  await deleteImage(id, iid);
  return NextResponse.json({ ok: true });
}
