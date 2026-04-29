import { NextResponse } from "next/server";
import {
  createImages,
  createResource,
  extFromName,
  getProject,
  listResources,
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const resources = await listResources(id);
  return NextResponse.json({ resources });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const form = await req.formData();
  const kind = String(form.get("kind") ?? "");
  const name = String(form.get("name") ?? "").trim() || "Untitled";

  if (kind === "video") {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    const width = Number(form.get("width") ?? 0);
    const height = Number(form.get("height") ?? 0);
    const durationRaw = form.get("duration");
    const duration =
      durationRaw != null && Number.isFinite(Number(durationRaw))
        ? Number(durationRaw)
        : undefined;
    const ingestVia = (form.get("ingestVia") as string | null) ?? undefined;
    const sourceExt = extFromName(file.name, "mp4");
    const buf = Buffer.from(await file.arrayBuffer());
    const resource = await createResource(
      id,
      {
        kind: "video",
        name,
        width,
        height,
        duration,
        ingestVia: ingestVia as
          | "original"
          | "ffmpeg-wasm"
          | "server"
          | undefined,
        sourceExt,
      },
      buf,
    );
    return NextResponse.json({ resource }, { status: 201 });
  }

  if (kind === "image_batch") {
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "files required" }, { status: 400 });
    }
    const metaStr = form.get("meta");
    type ImgMeta = { name: string; width: number; height: number };
    let metas: ImgMeta[] = [];
    try {
      metas = typeof metaStr === "string" ? (JSON.parse(metaStr) as ImgMeta[]) : [];
    } catch {
      return NextResponse.json({ error: "invalid meta" }, { status: 400 });
    }
    if (metas.length !== files.length) {
      return NextResponse.json(
        { error: "meta count mismatch" },
        { status: 400 },
      );
    }
    const resource = await createResource(id, {
      kind: "image_batch",
      name,
    });
    const inputs = await Promise.all(
      files.map(async (file, i) => ({
        resourceId: resource.id,
        source: "uploaded" as const,
        name: metas[i].name || file.name,
        ext: extFromName(file.name, "jpg"),
        width: metas[i].width,
        height: metas[i].height,
        bytes: Buffer.from(await file.arrayBuffer()),
      })),
    );
    const images = await createImages(id, inputs);
    return NextResponse.json({ resource, images }, { status: 201 });
  }

  return NextResponse.json({ error: "invalid kind" }, { status: 400 });
}
