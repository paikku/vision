import { mimeForExt, readImageBytes } from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; iid: string }> },
) {
  const { id, iid } = await params;
  const result = await readImageBytes(id, iid);
  if (!result) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(result.data), {
    headers: {
      "content-type": mimeForExt(result.ext),
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
