import { NextResponse } from "next/server";
import { listImages } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const images = await listImages(id);
  return NextResponse.json({ images });
}
