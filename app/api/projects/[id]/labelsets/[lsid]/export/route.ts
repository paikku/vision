import { NextResponse } from "next/server";
import { buildLabelSetExport } from "@/features/export/service/exportJson";
import {
  getLabelSet,
  getLabelSetAnnotations,
  getResource,
  listImages,
} from "@/lib/server/storage";

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "labelset";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  const labelSet = await getLabelSet(id, lsid);
  if (!labelSet) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const [annData, allImages] = await Promise.all([
    getLabelSetAnnotations(id, lsid),
    listImages(id),
  ]);
  const idSet = new Set(labelSet.imageIds);
  const images = allImages.filter((img) => idSet.has(img.id));

  const resourceIds = Array.from(new Set(images.map((i) => i.resourceId)));
  const resources = (
    await Promise.all(resourceIds.map((rid) => getResource(id, rid)))
  ).filter((r): r is NonNullable<typeof r> => r != null);

  const payload = buildLabelSetExport({
    labelSet,
    images,
    resources,
    annotations: annData.annotations,
  });

  const fileName = `${safeFileName(labelSet.name)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}
