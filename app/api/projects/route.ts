import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/server/storage";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const project = await createProject(name);
  return NextResponse.json({ project }, { status: 201 });
}
