import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { mimeForExt, statResourceSource } from "@/lib/server/storage";

/**
 * Stream the source video. Browsers REQUIRE byte-range responses to seek
 * inside <video>; without them clicking the scrubber, scripted
 * `currentTime` writes, and arrow-key seek all fail silently. We parse the
 * Range header, return 206 Partial Content for the requested byte window,
 * and 200 (with `Accept-Ranges: bytes`) for unranged requests.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  const { id, rid } = await params;
  const stat = await statResourceSource(id, rid);
  if (!stat) return new Response("not found", { status: 404 });
  const mime = mimeForExt(stat.ext);
  const total = stat.size;

  const rangeHeader = req.headers.get("range");
  if (!rangeHeader) {
    // Whole-file response. Still advertise Accept-Ranges so the browser
    // knows it can issue subsequent ranged requests.
    const stream = createReadStream(stat.path);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "content-type": mime,
        "content-length": String(total),
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=0, must-revalidate",
      },
    });
  }

  // Parse `bytes=START-END` (END is optional and inclusive).
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) {
    return new Response("invalid range", {
      status: 416,
      headers: { "content-range": `bytes */${total}` },
    });
  }
  const startStr = m[1];
  const endStr = m[2];
  let start: number;
  let end: number;
  if (startStr === "" && endStr !== "") {
    // Suffix range: last N bytes.
    const n = Number(endStr);
    if (!Number.isFinite(n) || n <= 0) {
      return new Response("invalid range", {
        status: 416,
        headers: { "content-range": `bytes */${total}` },
      });
    }
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = startStr === "" ? 0 : Number(startStr);
    end = endStr === "" ? total - 1 : Number(endStr);
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end >= total ||
    start > end
  ) {
    return new Response("invalid range", {
      status: 416,
      headers: { "content-range": `bytes */${total}` },
    });
  }

  const chunkSize = end - start + 1;
  const stream = createReadStream(stat.path, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      "content-type": mime,
      "content-length": String(chunkSize),
      "content-range": `bytes ${start}-${end}/${total}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}
