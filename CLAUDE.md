# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start dev server (localhost:3000)
npm run build      # production build + type check
npm run typecheck  # tsc --noEmit only
npm run lint       # eslint via next lint
```

No test runner is configured yet.

## Architecture

**Stack:** Next.js 15 (App Router) · React 19 · Zustand 5 · Tailwind v4 · TypeScript strict

The app is a single-page labeling workspace. `app/page.tsx` renders `<Workspace />`, which is the root client component and switches between the upload screen and the annotation workspace based on whether `media` exists in the store.

### Data flow

All state lives in one Zustand store (`src/lib/store.ts`):

```
MediaSource → Frame[] → Annotation[]
                ↕             ↕
          activeFrameId  selectedAnnotationId
```

- **MediaSource** — the raw upload (one at a time). Holds an object URL.
- **Frame** — a captured still from the media, also held as an object URL. Images become one frame via canvas copy; videos produce frames by seeking + canvas draw. The store owns revocation of both URL types.
- **Annotation** — belongs to a frame, references a `LabelClass` by id, and holds a `Shape`.
- **Shape** — normalized coordinates (0..1 on both axes) so annotations are resolution-independent.

### Tool harness (`src/lib/tools/`)

`AnnotationTool` in `tools/types.ts` is the interface every drawing mode implements:

```ts
begin(start: Point): ShapeDraft
// ShapeDraft.update(current) → Shape preview
// ShapeDraft.commit(end)     → Shape | null (null = discard)
```

`registry.ts` maps every `ToolId` to its tool. To add a new tool (polygon, mask, etc.):
1. Implement `AnnotationTool` in a new file under `tools/`.
2. Extend `Shape = RectShape | …` in `types.ts`.
3. Register in `registry.ts`.
4. Add a render case to `ShapeView` in `AnnotationStage.tsx`.

### Canvas rendering (`AnnotationStage.tsx`)

The stage uses a **contain-fit** layout computed by `ResizeObserver`. The image sits in a positioned `<div>`; an SVG with `viewBox="0 0 1 1" preserveAspectRatio="none"` overlays it. Shapes are drawn in normalized space with `vectorEffect="non-scaling-stroke"` so stroke widths stay pixel-consistent at any zoom.

Pointer capture ensures drag events aren't lost when the cursor leaves the stage.

### Styling

Tailwind v4 — design tokens are declared as CSS variables in `app/globals.css` under `@theme`. All components consume them as `var(--color-*)`. No `tailwind.config` file is needed.

## Video timeline and capture pipeline (M1/M2/M3)

The video picker (`src/components/VideoFramePicker.tsx`) now supports three milestone capabilities:

- **M1 (infra):** worker-backed keyframe discovery + sprite generation.
  - `src/lib/media.ts::buildVideoSprite` builds a sprite atlas from decoded video frames.
  - `public/workers/sprite-worker.js` parses uploaded MP4 bytes with MP4Box (CDN import inside worker) and returns candidate keyframe timestamps.
  - If worker parsing fails, `buildVideoSprite` falls back to `evenlySpacedTimes(...)`.
- **M2 (timeline UI):** strip timeline with immediate hover preview and click-to-seek.
  - Timeline tiles are rendered from the sprite atlas and mapped by timestamp.
- **M3 (capture UX):** `requestVideoFrameCallback`-aware capture and keyboard shortcuts.
  - `captureFrameFromVideoElement(...)` waits for a rendered frame before drawImage.
  - Picker shortcuts: `Space` (play/pause), `C` (capture), `ArrowLeft/ArrowRight` (seek ±1s, `Shift` => ±5s).

### Notes for maintainers

- `MediaSource` includes `file?: File` so worker preprocessing can read raw uploaded bytes.
- Sprite/object URLs are revoked in component cleanup paths to avoid leaks.
- Keep timeline preview interactions non-blocking; expensive work should remain in helper functions and worker paths.

## Recent architecture updates

- Video ingest now supports a pluggable normalization pipeline (`src/lib/video-normalize.ts`):
  - server adapter first (`NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT`)
  - ffmpeg.wasm adapter fallback (client-side transcode to browser-safe mp4)
- Workspace center area is mode-driven (`centerViewMode` in Zustand):
  - `video` mode: main playback and timeline extraction UI
  - `frame` mode: annotation stage with in-main mini preview and return-to-video affordance
- Frame extraction controls are now componentized in `src/components/frame-extract/ExtractionPanel.tsx` with tab slots (`Quick`, `Range`, `Smart`) for future strategy additions.
