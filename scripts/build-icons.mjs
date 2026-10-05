// Builds extension icons (16/32/48/128 PNG) from shared/sprite.js — happy mood, mint. Pure Node, no deps.
// Usage: node scripts/build-icons.mjs
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Sprite = require(join(here, '..', 'shared', 'sprite.js'));

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function render(size, mood = 'happy', color = 'mint') {
  const pal = Sprite.palette(color);
  const g = Sprite.grid(mood);
  // Nearest-neighbour: integer scale where possible, centred; transparent margin.
  // 128px store icon: 96px art with 16px padding (Chrome Web Store guideline).
  const scale = size === 128 ? 6 : Math.max(1, Math.floor(size / 16));
  const off = Math.floor((size - 16 * scale) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const k = g[y][x];
    if (k === '.') continue;
    const [r, gg, b] = hex(pal[k]);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const px = off + x * scale + dx, py = off + y * scale + dy;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const i = (py * size + px) * 4;
      out[i] = r; out[i + 1] = gg; out[i + 2] = b; out[i + 3] = 255;
    }
  }
  return png(size, out);
}

// Store art: pet centred on the brand paper colour (Edge logo 300x300, Chrome small promo tile 440x280).
function tile(w, h, scale, bg = '#F6F3EE') {
  const pal = Sprite.palette('mint');
  const g = Sprite.grid('happy');
  const out = Buffer.alloc(w * h * 4);
  const [br, bgc, bb] = hex(bg);
  for (let i = 0; i < w * h; i++) { out[i * 4] = br; out[i * 4 + 1] = bgc; out[i * 4 + 2] = bb; out[i * 4 + 3] = 255; }
  const ox = Math.floor((w - 16 * scale) / 2), oy = Math.floor((h - 16 * scale) / 2);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const k = g[y][x];
    if (k === '.') continue;
    const [r, gg, b] = hex(pal[k]);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = ((oy + y * scale + dy) * w + ox + x * scale + dx) * 4;
      out[i] = r; out[i + 1] = gg; out[i + 2] = b;
    }
  }
  return pngWH(w, h, out);
}
function pngWH(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const storeDir = join(here, '..', 'store');
mkdirSync(storeDir, { recursive: true });
writeFileSync(join(storeDir, 'logo-300.png'), tile(300, 300, 14));
writeFileSync(join(storeDir, 'promo-440x280.png'), tile(440, 280, 12));
console.log('wrote store/logo-300.png, store/promo-440x280.png');

const dir = join(here, '..', 'extension', 'icons');
mkdirSync(dir, { recursive: true });
for (const s of [16, 32, 48, 128]) {
  const file = join(dir, `icon-${s}.png`);
  writeFileSync(file, render(s));
  console.log('wrote', file);
}
