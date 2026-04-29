import { NextResponse } from "next/server";
import { readPreview } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string; idx: string }> },
) {
  const { id, rid, idx } = await params;
  const n = Number(idx);
  if (!Number.isFinite(n)) {
    return NextResponse.json({ error: "bad index" }, { status: 400 });
  }
  const data = await readPreview(id, rid, n);
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
}
