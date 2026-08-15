import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(size, rgb) {
  const [r, g, b] = rgb;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 3;
      // simple mark: dark teal bg + gold diagonal
      const on = Math.abs(x - y) < size * 0.08 || (x > size * 0.65 && y < size * 0.35);
      if (on) {
        raw[i] = 232;
        raw[i + 1] = 196;
        raw[i + 2] = 122;
      } else {
        raw[i] = r;
        raw[i + 1] = g;
        raw[i + 2] = b;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const root = path.resolve(__dirname, "..");
const webPublic = path.join(root, "web", "public");
const tauriIcons = path.join(root, "src-tauri", "icons");
fs.mkdirSync(webPublic, { recursive: true });
fs.mkdirSync(tauriIcons, { recursive: true });

const color = [15, 47, 44];
fs.writeFileSync(path.join(webPublic, "pwa-192.png"), png(192, color));
fs.writeFileSync(path.join(webPublic, "pwa-512.png"), png(512, color));
fs.writeFileSync(path.join(tauriIcons, "32x32.png"), png(32, color));
fs.writeFileSync(path.join(tauriIcons, "128x128.png"), png(128, color));
fs.writeFileSync(path.join(tauriIcons, "128x128@2x.png"), png(256, color));
fs.writeFileSync(path.join(tauriIcons, "icon.ico"), png(256, color)); // placeholder; real ico optional for first run
console.log("icons written");
