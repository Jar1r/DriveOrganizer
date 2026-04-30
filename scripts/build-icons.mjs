// One-shot script to render the SVG logo into PNGs at the sizes Chrome/Edge
// require for PWA installability. Run with `node scripts/build-icons.mjs`.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "public", "logo.svg");
const OUT_DIR = join(ROOT, "public");

const BG = "#0b1220"; // matches manifest background_color

const svg = await readFile(SRC);

async function renderStandard(size) {
  // Standard "any" icon: rendered onto the dark brand background, full bleed.
  const padding = Math.round(size * 0.12);
  const inner = size - padding * 2;
  const innerPng = await sharp(svg, { density: 384 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  const composed = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: innerPng, top: padding, left: padding }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return composed;
}

async function renderMaskable(size) {
  // Maskable: needs ~10% safe-zone padding so OS-circular masks don't crop.
  const padding = Math.round(size * 0.18);
  const inner = size - padding * 2;
  const innerPng = await sharp(svg, { density: 384 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: innerPng, top: padding, left: padding }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const tasks = [
  ["icon-192.png", await renderStandard(192)],
  ["icon-512.png", await renderStandard(512)],
  ["icon-maskable-192.png", await renderMaskable(192)],
  ["icon-maskable-512.png", await renderMaskable(512)],
  ["apple-touch-icon.png", await renderStandard(180)],
  ["icon-512-transparent.png", await sharp(svg, { density: 384 }).resize(512, 512).png().toBuffer()],
];

for (const [name, buf] of tasks) {
  await writeFile(join(OUT_DIR, name), buf);
  console.log(`wrote public/${name} (${buf.length} bytes)`);
}
