import { NextResponse } from "next/server";
import { listImages } from "@/lib/server/storage";
import type { ImageFilter, ImageSource } from "@/features/images/types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const resourceId = url.searchParams.get("resourceId") ?? undefined;
  const source = (url.searchParams.get("source") ?? undefined) as
    | ImageSource
    | undefined;
  const tag = url.searchParams.get("tag") ?? undefined;
  const filter: ImageFilter | undefined =
    resourceId || source || tag ? { resourceId, source, tag } : undefined;
  const images = await listImages(id, filter);
  return NextResponse.json({ images });
}
