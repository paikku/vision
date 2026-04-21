import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const srcDir = resolve(repoRoot, "node_modules/@ffmpeg/core/dist/esm");
const outDir = resolve(repoRoot, "public/vendor/ffmpeg");

if (!existsSync(srcDir)) {
  console.warn(
    "[sync:ffmpeg-core] @ffmpeg/core not found. Run `npm install @ffmpeg/core @ffmpeg/ffmpeg @ffmpeg/util` first.",
  );
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
cpSync(resolve(srcDir, "ffmpeg-core.js"), resolve(outDir, "ffmpeg-core.js"));
cpSync(resolve(srcDir, "ffmpeg-core.wasm"), resolve(outDir, "ffmpeg-core.wasm"));
cpSync(resolve(srcDir, "ffmpeg-core.worker.js"), resolve(outDir, "ffmpeg-core.worker.js"));

console.log("[sync:ffmpeg-core] copied ffmpeg-core assets to public/vendor/ffmpeg");
