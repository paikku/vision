import { NextResponse } from "next/server";
import {
  createImages,
  extFromName,
  getResourceMeta,
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Register frames extracted from a video resource into the project Image Pool.
 * Multipart body: `meta` (JSON: {id?, width, height, timestamp?, name}[]) +
 * `files` (one per meta entry, in matching order).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const resource = await getResourceMeta(id, rid);
  if (!resource) {
    return NextResponse.json({ error: "resource not found" }, { status: 404 });
  }
  if (resource.kind !== "video") {
    return NextResponse.json(
      { error: "frame extraction is video-only" },
      { status: 400 },
    );
  }
  const form = await req.formData();
  const metaStr = form.get("meta");
  type FrameMeta = {
    id?: string;
    width: number;
    height: number;
    timestamp?: number;
    name: string;
  };
  let metas: FrameMeta[] = [];
  try {
    metas = typeof metaStr === "string" ? (JSON.parse(metaStr) as FrameMeta[]) : [];
  } catch {
    return NextResponse.json({ error: "invalid meta" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (metas.length !== files.length) {
    return NextResponse.json(
      { error: "meta count mismatch" },
      { status: 400 },
    );
  }
  const inputs = await Promise.all(
    metas.map(async (m, i) => ({
      id: m.id,
      resourceId: rid,
      source: "video_frame" as const,
      name: m.name,
      ext: extFromName(files[i].name, "jpg"),
      width: m.width,
      height: m.height,
      timestamp: m.timestamp,
      bytes: Buffer.from(await files[i].arrayBuffer()),
    })),
  );
  const images = await createImages(id, inputs);
  return NextResponse.json({ images });
}
