import { NextResponse } from "next/server";
import {
  deleteLabelSet,
  getLabelSet,
  updateLabelSet,
} from "@/lib/server/storage";
import type { LabelClass } from "@/features/labelsets/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  const labelset = await getLabelSet(id, lsid);
  if (!labelset) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ labelset });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  const patch = (await req.json().catch(() => ({}))) as {
    name?: string;
    classes?: LabelClass[];
    imageIds?: string[];
  };
  const labelset = await updateLabelSet(id, lsid, patch);
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
