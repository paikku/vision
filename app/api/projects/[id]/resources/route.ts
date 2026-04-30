import { NextResponse } from "next/server";
import { listResources } from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const resources = await listResources(id);
  return NextResponse.json({ resources });
}
