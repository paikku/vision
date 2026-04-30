import { NextResponse } from "next/server";
import { createResource, extFromName, listResources } from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const resources = await listResources(id);
  return NextResponse.json({ resources });
}

/**
 * Create a Resource.
 *
 *   type=video         multipart with `file` + width/height/duration/ingestVia
 *   type=image_batch   no file — creates an empty container; images are added
 *                      via POST /resources/[rid]/images
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const form = await req.formData();
  const type = String(form.get("type") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const tagsRaw = form.get("tags");
  let tags: string[] = [];
  if (typeof tagsRaw === "string" && tagsRaw.length > 0) {
    try {
      const parsed = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      return NextResponse.json({ error: "tags must be a JSON array" }, { status: 400 });
    }
  }

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (type === "image_batch") {
    const resource = await createResource(id, { type: "image_batch", name, tags });
    return NextResponse.json({ resource }, { status: 201 });
  }

  if (type === "video") {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    const width = Number(form.get("width"));
    const height = Number(form.get("height"));
    const duration = form.get("duration") ? Number(form.get("duration")) : undefined;
    const ingestVia = (form.get("ingestVia") as string | null) ?? undefined;
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return NextResponse.json({ error: "width/height required" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const sourceExt = extFromName(file.name, "mp4");
    const resource = await createResource(id, {
      type: "video",
      name,
      tags,
      sourceExt,
      sourceBuffer: buf,
      width,
      height,
      duration,
      ingestVia: ingestVia as "original" | "ffmpeg-wasm" | "server" | undefined,
    });
    return NextResponse.json({ resource }, { status: 201 });
  }

  return NextResponse.json(
    { error: "type must be video | image_batch" },
    { status: 400 },
  );
}
