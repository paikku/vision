import { NextResponse } from "next/server";
import {
  getLabelSetAnnotations,
  saveLabelSetAnnotations,
} from "@/lib/server/storage";
import type { LabelSetAnnotations } from "@/features/labelsets/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  const data = await getLabelSetAnnotations(id, lsid);
  return NextResponse.json(data);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; lsid: string }> },
) {
  const { id, lsid } = await params;
  const data = (await req.json().catch(() => null)) as
    | LabelSetAnnotations
    | null;
  if (!data || !Array.isArray(data.annotations)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  await saveLabelSetAnnotations(id, lsid, data);
  return NextResponse.json({ ok: true });
}
