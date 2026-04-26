import type { PolygonShape, RectShape, Shape } from "../types";
import { shapeAabb } from "../shape-utils";

/**
 * Backend segmentation model id. The actual list of accepted ids is
 * advertised by the server at runtime via `GET /v1/segment/models`
 * (see `fetchSegmentModels`). Kept as a plain string alias so callers
 * are not coupled to a fixed enum.
 */
export type SegmentModelId = string;

export type SegmentModelInfo = {
  id: SegmentModelId;
  label: string;
  /** Internal backend id reported by the server (e.g. `fastsam-s`). */
  backend?: string | null;
  /** True if the server marks this model as its default. */
  default?: boolean;
};

/**
 * Friendly labels for ids the frontend knows about. Unknown ids
 * returned by the server fall back to the id itself.
 */
const KNOWN_MODEL_LABELS: Record<string, string> = {
  sam3: "SAM 3",
  sam2: "SAM 2",
  sam: "SAM (v1)",
  mask2former: "Mask2Former",
  "mask-rcnn": "Mask R-CNN",
};

/**
 * Built-in fallback list. Used only when the server is not reachable
 * (or `/v1/segment/models` fails) so the UI can still render a select.
 * Authoritative list comes from the server — see `fetchSegmentModels`.
 */
export const SEGMENT_MODELS: ReadonlyArray<SegmentModelInfo> = [
  { id: "sam3", label: "SAM 3", default: true },
  { id: "sam2", label: "SAM 2" },
  { id: "sam", label: "SAM (v1)" },
  { id: "mask2former", label: "Mask2Former" },
  { id: "mask-rcnn", label: "Mask R-CNN" },
];

export const DEFAULT_SEGMENT_MODEL: SegmentModelId = "sam3";

/** Friendly label for a model id, falling back to the raw id. */
export function segmentModelLabel(id: SegmentModelId): string {
  return KNOWN_MODEL_LABELS[id] ?? id;
}

/**
 * Validate a candidate id against a model list. Defaults to the
 * built-in `SEGMENT_MODELS` fallback when no list is provided.
 */
export function isSegmentModelId(
  v: string,
  models: ReadonlyArray<{ id: string }> = SEGMENT_MODELS,
): v is SegmentModelId {
  return models.some((m) => m.id === v);
}

/**
 * Segmentation service — refines an annotation region into a tighter
 * object boundary using a server-side model.
 *
 * The response carries both representations so the client can pick the
 * richer one it supports:
 *
 *   - `polygon` : array of rings (outer + optional holes), normalized [0..1]
 *   - `rect`    : tight axis-aligned bbox, normalized [0..1]
 *
 * Today both are rendered: `toShape()` returns a polygon when present
 * and otherwise falls back to a rect. Callers that specifically want
 * a rect (e.g. to feed rect-only downstream code) can call
 * `toRectShape()`.
 */

export type NormalizedPoint = { x: number; y: number };

/** One closed ring of normalized points. First ring is outer, rest are holes. */
export type NormalizedRing = NormalizedPoint[];

export type SegmentRegionHint = {
  /** Source annotation rect in normalized [0..1] — the region to focus on. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Optional hint classes (e.g. class name) for models that accept it. */
  classHint?: string;
  /** Which backend model to dispatch to. Defaults to DEFAULT_SEGMENT_MODEL. */
  model?: SegmentModelId;
};

export type SegmentResult = {
  /**
   * Preferred shape. `polygon` is richer than `rect` and should be used
   * as soon as the Shape union supports it. Today, callers ignore it
   * and fall back to `rect`.
   */
  polygon?: NormalizedRing[];
  /** Tight AABB of the segmented object in normalized coords. */
  rect: { x: number; y: number; w: number; h: number };
  /** Optional model confidence in [0..1]. */
  score?: number;
};

export type SegmentOptions = {
  signal?: AbortSignal;
};

/** Raw server response shape — kept permissive so the server can evolve. */
type ServerResponse = {
  polygon?: Array<Array<[number, number] | { x: number; y: number }>>;
  rect?: { x: number; y: number; w: number; h: number };
  bbox?: { x: number; y: number; w: number; h: number };
  score?: number;
};

/**
 * Returns the segmentation endpoint URL, or null when segmentation is
 * not configured. Resolution order:
 *   1. `NEXT_PUBLIC_IMAGE_SEGMENT_ENDPOINT` — explicit override
 *   2. Derived from `NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT` by replacing
 *      the last path segment with `segment` (same host/port/scheme).
 */
export function getSegmentEndpoint(): string | null {
  const explicit = process.env.NEXT_PUBLIC_IMAGE_SEGMENT_ENDPOINT;
  if (explicit) return explicit;

  const normalize = process.env.NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT;
  if (!normalize) return null;
  try {
    const url = new URL(normalize);
    const trimmed = url.pathname.replace(/\/+$/, "");
    const parts = trimmed.split("/");
    if (parts.length <= 1 || parts[parts.length - 1] === "") {
      url.pathname = "/segment";
    } else {
      parts[parts.length - 1] = "segment";
      url.pathname = parts.join("/");
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** URL of `GET /v1/segment/models`, derived from the segment endpoint. */
export function getSegmentModelsEndpoint(): string | null {
  const base = getSegmentEndpoint();
  if (!base) return null;
  try {
    const url = new URL(base);
    url.pathname = url.pathname.replace(/\/+$/, "") + "/models";
    // Drop query params (e.g. `async_job=true` inherited from the
    // normalize endpoint) — the introspection route doesn't take any.
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

export type SegmentModelsList = {
  models: SegmentModelInfo[];
  defaultId: SegmentModelId;
};

/**
 * Fetches the live model list from `GET /v1/segment/models`. Returns
 * `null` when the endpoint is not configured or the request fails —
 * callers fall back to `SEGMENT_MODELS`.
 */
export async function fetchSegmentModels(
  opts?: SegmentOptions,
): Promise<SegmentModelsList | null> {
  const endpoint = getSegmentModelsEndpoint();
  if (!endpoint) return null;

  let resp: Response;
  try {
    resp = await fetch(endpoint, { method: "GET", signal: opts?.signal });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;

  const rawModels = (data as { models?: unknown }).models;
  if (!Array.isArray(rawModels)) return null;

  const models: SegmentModelInfo[] = [];
  for (const m of rawModels) {
    if (!m || typeof m !== "object") continue;
    const id = (m as { id?: unknown }).id;
    if (typeof id !== "string" || !id) continue;
    const backend = (m as { backend?: unknown }).backend;
    const isDefault = (m as { default?: unknown }).default === true;
    models.push({
      id,
      label: KNOWN_MODEL_LABELS[id] ?? id,
      backend: typeof backend === "string" ? backend : null,
      default: isDefault,
    });
  }
  if (models.length === 0) return null;

  const advertisedDefault = (data as { default?: unknown }).default;
  const defaultId =
    typeof advertisedDefault === "string" &&
    models.some((m) => m.id === advertisedDefault)
      ? advertisedDefault
      : (models.find((m) => m.default)?.id ?? models[0].id);

  return { models, defaultId };
}

/**
 * Requests a segmentation refinement for a region inside `frameImageUrl`.
 * Returns `null` if segmentation is not configured or the request fails —
 * callers are expected to surface that as a no-op (the annotation stays
 * untouched) rather than a hard error.
 */
export async function segmentRegion(
  frameImageUrl: string,
  hint: SegmentRegionHint,
  opts?: SegmentOptions,
): Promise<SegmentResult | null> {
  const endpoint = getSegmentEndpoint();
  if (!endpoint) return null;

  let imageBlob: Blob;
  try {
    const imgResp = await fetch(frameImageUrl, { signal: opts?.signal });
    if (!imgResp.ok) return null;
    imageBlob = await imgResp.blob();
  } catch {
    return null;
  }

  const form = new FormData();
  form.append("file", imageBlob, "frame.jpg");
  form.append("region", JSON.stringify(hint.bbox));
  form.append("model", hint.model ?? DEFAULT_SEGMENT_MODEL);
  if (hint.classHint) form.append("classHint", hint.classHint);

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: opts?.signal,
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: ServerResponse;
  try {
    data = (await resp.json()) as ServerResponse;
  } catch {
    return null;
  }

  return parseServerResponse(data, hint.bbox);
}

function parseServerResponse(
  data: ServerResponse,
  fallbackBbox: { x: number; y: number; w: number; h: number },
): SegmentResult | null {
  const rings = parseRings(data.polygon);
  const rect =
    sanitizeRect(data.rect) ??
    sanitizeRect(data.bbox) ??
    ringsAabb(rings) ??
    null;

  if (!rect && !rings) return null;

  return {
    polygon: rings ?? undefined,
    rect: rect ?? fallbackBbox,
    score: typeof data.score === "number" ? data.score : undefined,
  };
}

function parseRings(
  raw: ServerResponse["polygon"],
): NormalizedRing[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rings: NormalizedRing[] = [];
  for (const ring of raw) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const points: NormalizedPoint[] = [];
    for (const p of ring) {
      const pt = toPoint(p);
      if (pt) points.push(pt);
    }
    if (points.length >= 3) rings.push(points);
  }
  return rings.length > 0 ? rings : null;
}

function toPoint(p: unknown): NormalizedPoint | null {
  if (Array.isArray(p) && p.length >= 2) {
    const [x, y] = p as [unknown, unknown];
    if (typeof x === "number" && typeof y === "number") {
      return clampPoint({ x, y });
    }
    return null;
  }
  if (p && typeof p === "object") {
    const { x, y } = p as { x?: unknown; y?: unknown };
    if (typeof x === "number" && typeof y === "number") {
      return clampPoint({ x, y });
    }
  }
  return null;
}

function clampPoint({ x, y }: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

function sanitizeRect(
  r: { x: number; y: number; w: number; h: number } | undefined,
): { x: number; y: number; w: number; h: number } | null {
  if (!r) return null;
  const { x, y, w, h } = r;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number"
  ) {
    return null;
  }
  if (w <= 0 || h <= 0) return null;
  const cx = Math.max(0, Math.min(1, x));
  const cy = Math.max(0, Math.min(1, y));
  const cw = Math.max(0, Math.min(1 - cx, w));
  const ch = Math.max(0, Math.min(1 - cy, h));
  if (cw <= 0 || ch <= 0) return null;
  return { x: cx, y: cy, w: cw, h: ch };
}

function ringsAabb(
  rings: NormalizedRing[] | null,
): { x: number; y: number; w: number; h: number } | null {
  if (!rings || rings.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  return { x: minX, y: minY, w, h };
}

/** Force the rect representation — useful for rect-only downstream code. */
export function toRectShape(result: SegmentResult): RectShape {
  return { kind: "rect", ...result.rect };
}

/**
 * Force the polygon representation. Returns `null` when the server did
 * not return rings (e.g. model only produced a bbox).
 */
export function toPolygonShape(result: SegmentResult): PolygonShape | null {
  if (!result.polygon || result.polygon.length === 0) return null;
  return {
    kind: "polygon",
    rings: result.polygon.map((ring) =>
      ring.map((p) => ({ x: p.x, y: p.y })),
    ),
  };
}

/**
 * Picks the richest representable shape: polygon when present, rect
 * otherwise. This is what callers typically want.
 */
export function toShape(result: SegmentResult): Shape {
  return toPolygonShape(result) ?? toRectShape(result);
}

/** AABB of a segment result, for servers/callers that want the bbox directly. */
export function segmentAabb(result: SegmentResult): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const poly = toPolygonShape(result);
  return poly ? shapeAabb(poly) : result.rect;
}
