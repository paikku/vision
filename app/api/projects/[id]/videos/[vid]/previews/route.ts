import { NextResponse } from "next/server";
import { getVideoMeta, writePreviews } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const meta = await getVideoMeta(id, vid);
  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData();
  const files = form.getAll("files");
  const buffers: Buffer[] = [];
  for (const f of files) {
    if (!(f instanceof File)) continue;
    buffers.push(Buffer.from(await f.arrayBuffer()));
  }
  if (buffers.length === 0) {
    return NextResponse.json({ error: "no files" }, { status: 400 });
  }
  const count = await writePreviews(id, vid, buffers);
  return NextResponse.json({ previewCount: count }, { status: 201 });
}
