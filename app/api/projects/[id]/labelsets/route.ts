import { NextResponse } from "next/server";
import { createLabelSet, listLabelSets } from "@/lib/server/storage";
import type { LabelSetType } from "@/features/labelsets/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const labelsets = await listLabelSets(id);
  return NextResponse.json({ labelsets });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    type?: LabelSetType;
    imageIds?: string[];
  };
  const name = (body.name ?? "").trim();
  const type = body.type;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (type !== "polygon" && type !== "bbox" && type !== "classify") {
    return NextResponse.json(
      { error: "type must be polygon | bbox | classify" },
      { status: 400 },
    );
  }
  const labelset = await createLabelSet(id, {
    name,
    type,
    imageIds: body.imageIds,
  });
  return NextResponse.json({ labelset }, { status: 201 });
}
