import { NextResponse } from "next/server";
import { mimeForExt, readResourceSource } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const found = await readResourceSource(id, rid);
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
