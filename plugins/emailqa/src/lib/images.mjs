// Pure-JS image helpers (no sharp, no sips): size, transparency and dark pixels, PNG → JPG.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function sniff(buf) {
  if (buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") {
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) return { format: "jpg", ...(jpegSize(buf) || {}) };
  if (buf.toString("ascii", 0, 3) === "GIF") return { format: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { format: "webp" };
  if (buf.toString("utf8", 0, 200).includes("<svg")) return { format: "svg" };
  return { format: "unknown" };
}

const luminance = (r, g, b) => {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

// Transparent PNGs with dark opaque pixels vanish on dark backgrounds (dark mode).
function pngAnalysis(buf) {
  const png = PNG.sync.read(buf);
  const { width, height, data } = png;
  let transparent = 0;
  let opaque = 0;
  let darkOpaque = 0;
  const step = Math.max(1, Math.floor((width * height) / 250000)); // sample big images
  for (let p = 0; p < width * height; p += step) {
    const i = p * 4;
    const a = data[i + 3];
    if (a < 16) {
      transparent++;
      continue;
    }
    if (a > 200) {
      opaque++;
      if (luminance(data[i], data[i + 1], data[i + 2]) < 0.08) darkOpaque++;
    }
  }
  const total = transparent + opaque || 1;
  return {
    has_transparency: transparent > 0,
    transparent_share: +(transparent / total).toFixed(3),
    dark_opaque_share_of_opaque: opaque ? +(darkOpaque / opaque).toFixed(3) : 0,
  };
}

// Near-black pixels in photos. Outlook 2021 on Windows showed white specks on the near-black areas of JPEG
// photos in two builds (lessons.md). The cause is not confirmed. The lead: the photo with specks had 15% of
// its pixels at luma 6 or lower, and the photo without specks had a darkest luma of 17. Luma is Rec. 601 Y'
// on 0-255, the value JPEG stores.
export const NEAR_BLACK_LUMA = 6;
export const NEAR_BLACK_WARN_SHARE = 0.02;
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

export function lumaStats(img) {
  const { width, height, data } = img;
  const step = Math.max(1, Math.floor((width * height) / 250000));
  let n = 0;
  let near = 0;
  let min = 255;
  for (let p = 0; p < width * height; p += step) {
    const i = p * 4;
    if (data[i + 3] < 200) continue; // transparent pixels sit on the email background, not in the photo
    const y = luma(data[i], data[i + 1], data[i + 2]);
    n++;
    if (y <= NEAR_BLACK_LUMA) near++;
    if (y < min) min = y;
  }
  return { min_luma: n ? Math.round(min) : null, near_black_share: n ? +(near / n).toFixed(3) : 0 };
}

const nearBlackWarning = (s) =>
  `Near-black photo areas (dark pixels): ${(s.near_black_share * 100).toFixed(1)}% of the pixels are at luma ${NEAR_BLACK_LUMA} or lower. ` +
  "Outlook 2021 showed white specks on such areas in two builds. The cause is not confirmed. " +
  "If Outlook 2021 matters, test a copy made with lift_blacks (floor 18) as a variant next to this photo.";

export async function imageInfo(file) {
  const buf = await readFile(file);
  const info = { file: path.basename(file), bytes: buf.length, kb: +(buf.length / 1024).toFixed(1), ...sniff(buf) };
  const warnings = [];
  if (["webp", "svg"].includes(info.format)) warnings.push(`${info.format.toUpperCase()} isn't supported by many email clients; use PNG or JPG.`);
  if (info.format === "jpg") {
    try {
      Object.assign(info, lumaStats(decode(buf)));
      if (info.near_black_share >= NEAR_BLACK_WARN_SHARE) warnings.push(nearBlackWarning(info));
    } catch (e) {
      warnings.push(`Couldn't decode the JPG: ${e.message}`);
    }
  }
  if (info.format === "png") {
    try {
      Object.assign(info, pngAnalysis(buf));
      if (info.has_transparency && info.dark_opaque_share_of_opaque > 0.15) {
        warnings.push(
          "Transparent PNG with dark pixels: on a dark background (dark mode) the dark parts may disappear. Consider a light outline or a solid background."
        );
      }
      if (!info.has_transparency && buf.length > 150 * 1024) {
        warnings.push("Large PNG without transparency: a JPG would be much smaller (convert_image).");
      }
      if (!info.has_transparency) {
        // An opaque PNG is a photo or a flat graphic. Only a photo-like share of near-black pixels counts.
        Object.assign(info, lumaStats(decode(buf)));
        if (info.near_black_share >= NEAR_BLACK_WARN_SHARE && buf.length > 60 * 1024) warnings.push(nearBlackWarning(info));
      }
    } catch (e) {
      warnings.push(`Couldn't decode the PNG: ${e.message}`);
    }
  }
  if (buf.length > 1024 * 1024) warnings.push("Over 1 MB: slow to load. convert_image with max_width (2x the display width, e.g. 1200) and quality 75 to 82 makes it smaller.");
  return { ...info, warnings };
}

const hexToRgb = (hex) => {
  const m = String(hex).match(/^#?([0-9a-f]{6})$/i);
  if (!m) throw new Error(`Background must be a 6-digit hex color, e.g. #ffffff (got ${hex}).`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function decode(buf) {
  const { format } = sniff(buf);
  if (format === "png") {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (format === "jpg") {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: Buffer.from(img.data) };
  }
  throw new Error("Only PNG and JPG files can be cropped.");
}

function encode(img, dest, quality = 85) {
  if (/\.jpe?g$/i.test(dest)) return jpeg.encode(img, Math.min(95, Math.max(40, quality))).data;
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  return PNG.sync.write(png);
}

// Cut a region out of a larger capture (e.g. a layer out of its parent frame, so blend modes and
// whatever sits underneath are kept). x/y/w/h are design pixels relative to the capture's top-left;
// designWidth is the capture's width in design pixels, so the 2x (or capped) scale is worked out here.
// Area-average downscale to `width` px (keeps the aspect ratio). Never upscales.
function downscale(img, width) {
  if (!width || img.width <= width) return img;
  const height = Math.max(1, Math.round((img.height * width) / img.width));
  const out = Buffer.alloc(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      const sum = [0, 0, 0, 0];
      let total = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
          const wgt = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx));
          const i = (yy * img.width + xx) * 4;
          for (let c = 0; c < 4; c++) sum[c] += img.data[i + c] * wgt;
          total += wgt;
        }
      }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(sum[c] / total);
    }
  }
  return { width, height, data: out };
}

// A solid-colour PNG, for example the tile behind an Outlook VML fill.
export async function solidPng(dest, { color, width = 64, height = 64 }) {
  const [r, g, b] = hexToRgb(color);
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  const bytes = PNG.sync.write(png);
  await writeFile(dest, bytes);
  return { width, height, color, bytes: bytes.length };
}

// Re-save a JPG at `quality`, scaled down to `maxWidth` if it is wider.
export async function recompressJpg(src, dest, { quality = 82, maxWidth } = {}) {
  const buf = await readFile(src);
  if (sniff(buf).format !== "jpg") throw new Error("Only JPG files can be re-saved this way.");
  const img = downscale(decode(buf), maxWidth);
  const out = jpeg.encode(img, Math.min(95, Math.max(40, quality))).data;
  await writeFile(dest, out);
  return { from_bytes: buf.length, to_bytes: out.length, width: img.width, height: img.height };
}

export async function cropImage(src, dest, { x, y, w, h, designWidth, quality = 85 }) {
  const img = decode(await readFile(src));
  const scale = designWidth ? img.width / designWidth : 1;
  // Round inward: a pixel that the crop edge only partly covers is a blend of the layer and its
  // neighbour, and shows as a thin dark or light line at the image edge.
  const left = Math.max(0, Math.ceil(x * scale - 1e-6));
  const top = Math.max(0, Math.ceil(y * scale - 1e-6));
  const width = Math.min(img.width, Math.floor((x + w) * scale + 1e-6)) - left;
  const height = Math.min(img.height, Math.floor((y + h) * scale + 1e-6)) - top;
  if (width <= 0 || height <= 0) throw new Error(`The crop area is outside the image (${img.width}x${img.height} px at scale ${scale.toFixed(2)}).`);
  const out = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    img.data.copy(out, row * width * 4, ((top + row) * img.width + left) * 4, ((top + row) * img.width + left + width) * 4);
  }
  const bytes = encode({ width, height, data: out }, dest, quality);
  await writeFile(dest, bytes);
  return { width, height, scale: +scale.toFixed(3), bytes: bytes.length };
}

// Raise the darkest pixels of a photo so its darkest luma is about `floor`. Pixels darker than `knee` move up
// along a straight line from floor (at luma 0) to knee (at luma knee), so mid-tones and highlights stay as they
// are. The same shift goes to R, G and B, which keeps the colour of dark areas. Transparency is kept for PNG.
export async function liftBlacks(src, dest, { floor = 18, knee = 64, quality = 90 } = {}) {
  if (!(floor > 0 && floor < knee && knee <= 128)) throw new Error("floor must be above 0 and below knee, and knee at most 128.");
  const buf = await readFile(src);
  const img = decode(buf);
  const before = lumaStats(img);
  const out = Buffer.from(img.data);
  const slope = (knee - floor) / knee;
  for (let i = 0; i < out.length; i += 4) {
    const y = luma(out[i], out[i + 1], out[i + 2]);
    if (y >= knee) continue;
    const shift = floor + y * slope - y;
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(out[i + c] + shift)));
  }
  const bytes = encode({ width: img.width, height: img.height, data: out }, dest, quality);
  await writeFile(dest, bytes);
  return { width: img.width, height: img.height, bytes: bytes.length, before, after: lumaStats(decode(bytes)) };
}

// PNG → JPG, flattening transparency onto a background color.
export async function pngToJpg(src, dest, { quality = 82, background = "#ffffff", maxWidth } = {}) {
  const buf = await readFile(src);
  if (sniff(buf).format !== "png") throw new Error("Only PNG files can be converted.");
  const png = PNG.sync.read(buf);
  const [br, bg, bb] = hexToRgb(background);
  const out = Buffer.alloc(png.width * png.height * 4);
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    out[i] = Math.round(png.data[i] * a + br * (1 - a));
    out[i + 1] = Math.round(png.data[i + 1] * a + bg * (1 - a));
    out[i + 2] = Math.round(png.data[i + 2] * a + bb * (1 - a));
    out[i + 3] = 255;
  }
  const img = downscale({ data: out, width: png.width, height: png.height }, maxWidth);
  const jpg = jpeg.encode(img, Math.min(95, Math.max(40, quality)));
  await writeFile(dest, jpg.data);
  return { from_bytes: buf.length, to_bytes: jpg.data.length, width: img.width, height: img.height };
}
