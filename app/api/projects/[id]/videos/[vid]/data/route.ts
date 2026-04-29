import { NextResponse } from "next/server";
import {
  getVideoData,
  getVideoMeta,
  mutateVideoData,
  reconcileVideoFrames,
  type VideoData,
} from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const meta = await getVideoMeta(id, vid);
  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Self-heal: any frame jpgs on disk that aren't yet in data.json get
  // re-registered before we hand state to the client. Idempotent and quick
  // when there's nothing to do.
  await reconcileVideoFrames(id, vid, meta);
  const data = await getVideoData(id, vid);
  return NextResponse.json({ meta, data });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const meta = await getVideoMeta(id, vid);
  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as Partial<VideoData>;

  // Frame lifecycle (image bytes + id + ext) is owned by the frames endpoint;
  // PUT data only overlays classes and annotations. The mutator runs under a
  // per-(project,video) lock, so a save can't observe a stale baseline and
  // clobber a concurrent frame POST/DELETE. Annotations that reference
  // missing frames are filtered out defensively.
  await mutateVideoData(id, vid, (existing) => {
    if (Array.isArray(body.classes)) existing.classes = body.classes;
    if (Array.isArray(body.annotations)) {
      const validFrameIds = new Set(existing.frames.map((f) => f.id));
      existing.annotations = body.annotations.filter((a) =>
        validFrameIds.has(a.frameId),
      );
    }
  });
  return NextResponse.json({ ok: true });
}
