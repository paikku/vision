import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const upstream = process.env.VIDEO_NORMALIZE_UPSTREAM_URL;
  if (!upstream) {
    return NextResponse.json(
      {
        error:
          "VIDEO_NORMALIZE_UPSTREAM_URL is not configured. Set it to a transcoding endpoint that returns video/mp4.",
      },
      { status: 501 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }

  const body = new FormData();
  body.append("file", file);

  const upstreamRes = await fetch(upstream, { method: "POST", body });
  if (!upstreamRes.ok) {
    return NextResponse.json(
      { error: `normalize upstream failed (${upstreamRes.status})` },
      { status: 502 },
    );
  }

  const blob = await upstreamRes.blob();
  return new Response(blob, {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
    },
  });
}
