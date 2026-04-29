import { NextResponse } from "next/server";
import {
  deleteLabelSet,
  getLabelSetData,
  getLabelSetMeta,
  listImages,
  mutateLabelSetMeta,
} from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  const meta = await getLabelSetMeta(id, lsid);
  if (!meta) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const [data, allImages] = await Promise.all([
    getLabelSetData(id, lsid),
    listImages(id),
  ]);
  // Hydrate just the images this labelset references, in the order recorded.
  const map = new Map(allImages.map((im) => [im.id, im] as const));
  const images = meta.imageIds
    .map((iid) => map.get(iid))
    .filter((x): x is NonNullable<typeof x> => x !== undefined);
  return NextResponse.json({ meta, data, images });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    imageIds?: string[];
  };
  const labelset = await mutateLabelSetMeta(id, lsid, (m) => {
    if (typeof body.name === "string" && body.name.trim()) {
      m.name = body.name.trim();
    }
    if (Array.isArray(body.imageIds)) {
      m.imageIds = body.imageIds;
    }
  });
  if (!labelset) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ labelset });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  await deleteLabelSet(id, lsid);
  return NextResponse.json({ ok: true });
}
