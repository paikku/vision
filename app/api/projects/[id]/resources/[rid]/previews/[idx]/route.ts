import { readPreview } from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string; idx: string }> },
) {
  const { id, rid, idx } = await params;
  const n = Number.parseInt(idx, 10);
  if (!Number.isFinite(n)) return new Response("invalid index", { status: 400 });
  const data = await readPreview(id, rid, n);
  if (!data) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
