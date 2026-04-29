import { NextResponse } from "next/server";
import {
  getLabelSetData,
  getLabelSetMeta,
  getProject,
  listImages,
  listLabelSets,
} from "@/lib/server/storage";

export const runtime = "nodejs";

/**
 * Download labels as a single JSON blob, scoped by label set. If `labelsets`
 * is omitted, every label set in the project is exported.
 *
 * Query params:
 *   ?labelsets=lsid1,lsid2  pick specific label sets
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const lsParam = url.searchParams.get("labelsets");
  const requested = lsParam
    ? new Set(lsParam.split(",").filter(Boolean))
    : null;

  const allSets = await listLabelSets(id);
  const targets = requested
    ? allSets.filter((ls) => requested.has(ls.id))
    : allSets;

  const allImages = await listImages(id);
  const imageMap = new Map(allImages.map((im) => [im.id, im] as const));

  const labelsets = await Promise.all(
    targets.map(async (summary) => {
      const meta = await getLabelSetMeta(id, summary.id);
      const data = await getLabelSetData(id, summary.id);
      const images = (meta?.imageIds ?? []).map((iid) => {
        const im = imageMap.get(iid);
        return im
          ? {
              id: im.id,
              name: im.name,
              width: im.width,
              height: im.height,
              source: im.source,
              resourceId: im.resourceId,
              timestamp: im.timestamp,
            }
          : { id: iid, missing: true };
      });
      return {
        id: summary.id,
        name: summary.name,
        taskType: summary.taskType,
        createdAt: summary.createdAt,
        classes: data.classes,
        images,
        annotations: data.annotations,
        classifications: data.classifications,
      };
    }),
  );

  const payload = {
    version: 2,
    exportedAt: Date.now(),
    project: { id: project.id, name: project.name },
    labelsets,
  };
  const body = JSON.stringify(payload, null, 2);
  const filename = `${project.name.replace(/[^\w.-]+/g, "_") || "project"}.json`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
