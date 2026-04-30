import { readImageThumb } from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; iid: string }> },
) {
  const { id, iid } = await params;
  const data = await readImageThumb(id, iid);
  if (!data) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
