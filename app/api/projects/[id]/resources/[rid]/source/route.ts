import { mimeForExt, readResourceSource } from "@/lib/server/storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const result = await readResourceSource(id, rid);
  if (!result) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(result.data), {
    headers: {
      "content-type": mimeForExt(result.ext),
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}
