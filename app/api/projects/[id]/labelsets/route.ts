import { NextResponse } from "next/server";
import {
  createLabelSet,
  getProject,
  listImages,
  listLabelSets,
} from "@/lib/server/storage";
import type { TaskType } from "@/features/annotations/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TASK_TYPES: TaskType[] = ["bbox", "polygon", "classify"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const labelsets = await listLabelSets(id);
  return NextResponse.json({ labelsets });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    taskType?: string;
    imageIds?: string[];
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!VALID_TASK_TYPES.includes(body.taskType as TaskType)) {
    return NextResponse.json({ error: "invalid taskType" }, { status: 400 });
  }
  const requestedIds = Array.isArray(body.imageIds) ? body.imageIds : [];
  // Validate that referenced images exist in this project's pool.
  const allImages = await listImages(id);
  const validSet = new Set(allImages.map((im) => im.id));
  const imageIds = requestedIds.filter((iid) => validSet.has(iid));
  const labelset = await createLabelSet(id, {
    name,
    taskType: body.taskType as TaskType,
    imageIds,
  });
  return NextResponse.json({ labelset }, { status: 201 });
}
