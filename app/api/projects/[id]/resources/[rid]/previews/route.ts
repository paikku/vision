import { NextResponse } from "next/server";
import { writePreviews } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "files required" }, { status: 400 });
  }
  const buffers = await Promise.all(
    files.map(async (f) => Buffer.from(await f.arrayBuffer())),
  );
  const previewCount = await writePreviews(id, rid, buffers);
  return NextResponse.json({ previewCount });
}
