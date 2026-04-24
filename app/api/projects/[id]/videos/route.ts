import { NextResponse } from "next/server";
import {
  createVideo,
  extFromName,
  getProject,
  listVideos,
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
  const videos = await listVideos(id);
  return NextResponse.json({ videos });
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
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const name = String(form.get("name") ?? file.name);
  const kindStr = String(form.get("kind") ?? "video");
  const kind: "video" | "image" = kindStr === "image" ? "image" : "video";
  const width = Number(form.get("width") ?? 0);
  const height = Number(form.get("height") ?? 0);
  const durationRaw = form.get("duration");
  const duration = durationRaw != null ? Number(durationRaw) : undefined;
  const ingestVia = (form.get("ingestVia") as string | null) ?? undefined;

  const sourceExt = extFromName(file.name, kind === "image" ? "jpg" : "mp4");
  const buf = Buffer.from(await file.arrayBuffer());

  const meta = await createVideo(
    id,
    {
      name,
      kind,
      width,
      height,
      duration: Number.isFinite(duration) ? duration : undefined,
      ingestVia: ingestVia as "original" | "ffmpeg-wasm" | "server" | undefined,
      sourceExt,
    },
    buf,
  );
  return NextResponse.json({ video: meta }, { status: 201 });
}
