// Makes every printer photo look like it came from the same shoot, and keeps
// the repository small:
//   - honors EXIF rotation, then strips all metadata
//   - trims the plain backdrop around the product (white, grey or transparent)
//   - centers it on a square canvas with even padding
//   - flattens onto white (the UI shows photos on white tiles)
//   - caps the size at 800 px, never upscales, and encodes as WebP
import sharp from "sharp";

export const IMAGE_SIZE = 800; // px, square. The site shows photos at up to 320 px (@2x = 640)
export const PADDING = 0.06; // share of the canvas left empty on each side
export const QUALITY = 78;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * @param {Buffer} input any image sharp can read (JPEG, PNG, WebP, AVIF, GIF, TIFF, HEIC if supported)
 * @returns {Promise<{ buffer: Buffer, before: object, after: object }>}
 */
export async function normalizeImage(input) {
  const source = sharp(input, { failOn: "none", animated: false });
  const meta = await source.metadata();

  // Apply EXIF rotation and flatten transparency onto white, so the trim
  // below treats transparent and white backdrops the same way
  const upright = await source.rotate().flatten({ background: WHITE }).toBuffer();

  // Trim the backdrop (anything close to the top-left pixel's color)
  const { width: fullW, height: fullH } = await sharp(upright).metadata();
  let product = upright;
  let plainBackdrop = false;
  try {
    const trimmed = await sharp(upright).trim({ threshold: 18 }).toBuffer({ resolveWithObject: true });
    const t = trimmed.info;
    plainBackdrop = t.width > 16 && t.height > 16 && t.width * t.height < fullW * fullH * 0.97;
    if (plainBackdrop) product = trimmed.data;
  } catch {
    // a completely uniform image: nothing to trim
  }

  // No plain backdrop (a photo of the printer in a room): padding would look
  // like letterboxing, so crop to a square around the most interesting region
  if (!plainBackdrop) {
    const canvas = Math.min(IMAGE_SIZE, fullW, fullH);
    const buffer = await sharp(upright)
      .resize(canvas, canvas, { fit: "cover", position: sharp.strategy.attention })
      .webp({ quality: QUALITY, effort: 6, smartSubsample: true })
      .toBuffer();
    return {
      buffer,
      before: { format: meta.format, width: meta.width, height: meta.height, bytes: input.length },
      after: { format: "webp", width: canvas, height: canvas, bytes: buffer.length },
    };
  }

  // Pad with the backdrop color so non-white backdrops don't get white bars
  const [r, g, b] = await sharp(upright).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  const backdrop = { r, g, b, alpha: 1 };

  const { width: w, height: h } = await sharp(product).metadata();
  const canvas = Math.min(IMAGE_SIZE, Math.round(Math.max(w, h) / (1 - 2 * PADDING)));
  const inner = Math.round(canvas * (1 - 2 * PADDING));
  const resized = await sharp(product)
    .resize(inner, inner, { fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const left = Math.floor((canvas - resized.info.width) / 2);
  const top = Math.floor((canvas - resized.info.height) / 2);
  const buffer = await sharp(resized.data)
    .extend({ left, top, right: canvas - resized.info.width - left, bottom: canvas - resized.info.height - top, background: backdrop })
    .webp({ quality: QUALITY, effort: 6, smartSubsample: true })
    .toBuffer();

  return {
    buffer,
    before: { format: meta.format, width: meta.width, height: meta.height, bytes: input.length },
    after: { format: "webp", width: canvas, height: canvas, bytes: buffer.length },
  };
}

/** True when an image already went through normalizeImage (square WebP within the size cap). */
export async function isNormalized(input) {
  const m = await sharp(input).metadata();
  return m.format === "webp" && m.width === m.height && m.width <= IMAGE_SIZE && !m.exif && !m.icc;
}

export const describe = ({ format, width, height, bytes }) =>
  `${width}×${height} ${String(format).toUpperCase()}, ${bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`}`;
