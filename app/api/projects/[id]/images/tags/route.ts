import { NextResponse } from "next/server";
import { bulkTagImages } from "@/lib/server/storage";

type Body = {
  imageIds?: string[];
  tags?: string[];
  mode?: "replace" | "add" | "remove";
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  const imageIds = Array.isArray(body.imageIds) ? body.imageIds : [];
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const mode = body.mode === "replace" || body.mode === "remove" ? body.mode : "add";
  if (imageIds.length === 0) {
    return NextResponse.json({ updated: 0 });
  }
  const result = await bulkTagImages(id, imageIds, tags, mode);
  return NextResponse.json(result);
}
