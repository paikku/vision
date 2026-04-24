#!/usr/bin/env node
/**
 * Copies the ffmpeg.wasm runtime assets out of node_modules into
 * `public/ffmpeg/` so Next.js can serve them same-origin. The browser
 * `new Worker(...)` constructor refuses cross-origin scripts, so hosting
 * `@ffmpeg/ffmpeg`'s worker at /ffmpeg/ffmpeg/worker.js is the only way the
 * in-browser fallback works in closed networks that cannot reach jsDelivr.
 *
 * Run manually with `node scripts/copy-ffmpeg-assets.mjs`; also wired to
 * postinstall/predev/prebuild in package.json so the assets stay in sync.
 */

import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const sources = [
  {
    from: "node_modules/@ffmpeg/ffmpeg/dist/esm",
    to: "public/ffmpeg/ffmpeg",
  },
  {
    from: "node_modules/@ffmpeg/util/dist/esm",
    to: "public/ffmpeg/util",
  },
  {
    from: "node_modules/@ffmpeg/core/dist/esm",
    to: "public/ffmpeg/core",
  },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Skip .d.ts / .d.mts files. They belong in node_modules, not in public/:
// `public/ffmpeg/ffmpeg/worker.d.ts` carries `/// <reference no-default-lib>`,
// and because tsconfig's `include` glob covers everything under the repo, TS
// picks it up and strips the DOM lib from the whole project.
function isRuntimeAsset(name) {
  return !/\.d\.m?ts$/.test(name);
}

async function copyDirShallow(srcDir, dstDir) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue; // ffmpeg dists are flat
    if (!isRuntimeAsset(entry.name)) continue;
    await copyFile(join(srcDir, entry.name), join(dstDir, entry.name));
  }
}

async function main() {
  for (const { from, to } of sources) {
    const src = join(root, from);
    const dst = join(root, to);
    if (!(await exists(src))) {
      console.warn(
        `[copy-ffmpeg] missing source ${from} — skipping. Run npm install first.`,
      );
      continue;
    }
    await rm(dst, { recursive: true, force: true });
    await mkdir(dst, { recursive: true });
    await copyDirShallow(src, dst);
    console.log(`[copy-ffmpeg] ${from} → ${to}`);
  }
}

main().catch((err) => {
  console.error("[copy-ffmpeg] failed:", err);
  process.exit(1);
});
