import { NextResponse } from "next/server";
import { mimeForExt, readVideoSource } from "@/lib/server/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const src = await readVideoSource(id, vid);
  if (!src) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(src.data), {
    status: 200,
    headers: {
      "Content-Type": mimeForExt(src.ext),
      "Content-Length": String(src.data.length),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
