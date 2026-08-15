#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Generates the PWA icon set (public/icons/*.png) with zero dependencies:
 * pixel-renders a chat-bubble glyph on a dark rounded-square background and
 * encodes PNGs by hand (zlib + CRC32). Supersamples 4x for anti-aliasing.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons",
);

// --- Sizes ---------------------------------------------------------------

const SIZES = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "maskable-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

// --- Palette -------------------------------------------------------------

const BG = [23, 23, 23, 255]; // #171717 — neutral dark, close to --foreground
const BUBBLE = [255, 255, 255, 235]; // white chat bubble
const DOT = [23, 23, 23, 255]; // dots in bubble

// --- Signed-distance helpers (unit space: 1.0 = canvas side) -------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** SDF of a rounded rectangle centered at (cx, cy) with half extents. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

/** SDF of a filled circle. */
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/**
 * Signed distance of the icon artwork in unit space:
 * rounded-square background + chat bubble + three dots.
 */
function iconSdf(x, y) {
  const bg = sdRoundRect(x, y, 0.5, 0.5, 0.48, 0.48, 0.21); // full-bleed rounded square
  // Chat bubble: rounded rect + a tail hanging under its bottom-left corner
  // (union of two rounded rects, so the tail reads as one shape).
  const bubble = Math.min(
    sdRoundRect(x, y, 0.5, 0.46, 0.235, 0.15, 0.085),
    sdRoundRect(x, y, 0.42, 0.645, 0.05, 0.045, 0.03),
  );
  const dots = Math.min(
    sdCircle(x, y, 0.5 - 0.105, 0.46, 0.05),
    sdCircle(x, y, 0.5, 0.46, 0.05),
    sdCircle(x, y, 0.5 + 0.105, 0.46, 0.05),
  );
  // Layer: bg < bubble < dots (all in unit space, bubble carved by tail).
  return { bg, bubble, dots };
}

// --- Rendering -----------------------------------------------------------

/** Coverage from a distance: 1 inside, 0 outside, AA ramp over ~1.5px. */
function coverage(d, px) {
  return clamp(0.5 - (d * px) / 1.5, 0, 1);
}

function render(size) {
  const SS = 4; // supersampling factor
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Premultiplied source-over of bg → bubble → dots, with each layer's
      // coverage as its alpha; averaged over the supersamples.
      let sumPr = 0,
        sumPg = 0,
        sumPb = 0,
        sumPa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const { bg, bubble, dots } = iconSdf(u, v);
          const layers = [
            [BG, coverage(bg, size)],
            [BUBBLE, coverage(bubble, size)],
            [DOT, coverage(dots, size)],
          ];
          // Per-sample paint buffer: new layer attenuates what's below.
          let pr = 0,
            pg = 0,
            pb = 0,
            pa = 0;
          for (const [col, cov] of layers) {
            const inv = 1 - cov;
            pr = pr * inv + col[0] * cov;
            pg = pg * inv + col[1] * cov;
            pb = pb * inv + col[2] * cov;
            pa = pa * inv + cov;
          }
          sumPr += pr * pa;
          sumPg += pg * pa;
          sumPb += pb * pa;
          sumPa += pa;
        }
      }
      const inv = 1 / (SS * SS);
      const alpha = sumPa * inv;
      const i = (y * size + x) * 4;
      if (alpha > 0) {
        const s = SS * SS * alpha;
        px[i] = Math.round(sumPr / s);
        px[i + 1] = Math.round(sumPg / s);
        px[i + 2] = Math.round(sumPb / s);
      }
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// --- PNG encoding --------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // Raw scanlines with filter byte 0.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Main ----------------------------------------------------------------

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { name, size } of SIZES) {
    const png = encodePng(size, render(size));
    writeFileSync(join(OUT_DIR, name), png);
    console.log(
      `✓ public/icons/${name} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KiB)`,
    );
  }
}

// Run when executed directly; export for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { encodePng, main, render };
