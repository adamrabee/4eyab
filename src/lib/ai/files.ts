import "server-only";
import sharp from "sharp";

export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Detect the real file type from magic bytes; never trust the client's Content-Type. */
export function sniffMime(buf: Uint8Array): AllowedMime | null {
  const b = buf;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return "image/webp";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return null;
}

export const EXT: Record<AllowedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/**
 * Prepare an image for the vision model: honour EXIF rotation (phone photos),
 * cap the long edge, and re-encode as JPEG so it stays well under the API's
 * per-image size limit. PDFs are passed through unchanged.
 */
export async function prepareForModel(buf: Buffer, mime: AllowedMime): Promise<{ data: Buffer; mime: AllowedMime }> {
  if (mime === "application/pdf") return { data: buf, mime };
  const out = await sharp(buf, { failOn: "error", limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { data: out, mime: "image/jpeg" };
}
