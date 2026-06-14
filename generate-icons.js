// generate-icons.js — Skapar enkla platshållar-ikoner (PNG) utan beroenden.
// Kör: node generate-icons.js   → skriver icons/icon-192.png och icon-512.png
// Bara nödvändig om du vill regenerera ikonerna; appen behöver inte detta i drift.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePNG(size) {
  // Färger
  const bg = [37, 99, 235];      // blå
  const fg = [255, 255, 255];    // vit cirkel
  const accent = [147, 197, 253]; // ljusblå "F"

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32;

  // Rita en grov bokstav "F" i mitten via enkla rektanglar (i cirkeln).
  const fW = size * 0.26;
  const fH = size * 0.40;
  const fx = cx - fW / 2;
  const fy = cy - fH / 2;
  const stroke = size * 0.07;

  function inF(x, y) {
    // vertikal stapel
    if (x >= fx && x <= fx + stroke && y >= fy && y <= fy + fH) return true;
    // övre horisontell
    if (y >= fy && y <= fy + stroke && x >= fx && x <= fx + fW) return true;
    // mitten horisontell
    if (y >= cy - stroke / 2 && y <= cy + stroke / 2 && x >= fx && x <= fx + fW * 0.8) return true;
    return false;
  }

  const bytesPerPixel = 4;
  const rowLen = size * bytesPerPixel + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      let color;
      if (inF(x, y)) color = accent;
      else if (dist <= r) color = fg;
      else color = bg;
      const off = y * rowLen + 1 + x * bytesPerPixel;
      raw[off] = color[0];
      raw[off + 1] = color[1];
      raw[off + 2] = color[2];
      raw[off + 3] = 255;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makePNG(size));
  console.log(`Skrev icons/icon-${size}.png`);
}
