import { NextResponse } from "next/server";
import {
  getLabelSetData,
  getLabelSetMeta,
  mutateLabelSetData,
} from "@/lib/server/storage";
import type { LabelSetData } from "@/features/projects/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  const data = await getLabelSetData(id, lsid);
  return NextResponse.json({ data });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  if (!(await getLabelSetMeta(id, lsid))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json()) as Partial<LabelSetData>;
  await mutateLabelSetData(id, lsid, (data) => {
    if (Array.isArray(body.classes)) data.classes = body.classes;
    if (Array.isArray(body.annotations)) data.annotations = body.annotations;
    if (Array.isArray(body.classifications)) {
      data.classifications = body.classifications;
    }
  });
  return NextResponse.json({ ok: true });
}
