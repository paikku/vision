import { NextResponse } from "next/server";
import { readPreview } from "@/lib/server/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; vid: string; idx: string }>;
  },
) {
  const { id, vid, idx } = await params;
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0) {
    return NextResponse.json({ error: "bad idx" }, { status: 400 });
  }
  const buf = await readPreview(id, vid, n);
  if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
