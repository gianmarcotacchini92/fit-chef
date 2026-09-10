import { randomUUID } from "node:crypto";
import { mkdir, readdir, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "./security";
import { MAX_IMAGE_BYTES } from "./ai";

const IMAGE_DIRECTORY = path.join(process.cwd(), ".data", "images");
const MAX_FILES = 128;
const MAX_DISK_BYTES = 256 * 1024 * 1024;
const imageId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function imageFileName(id: string): string {
  if (!imageId.test(id)) throw new ApiError(404, "Immagine non trovata.");
  return `${id}.webp`;
}

export async function ensureImageCapacity(): Promise<void> {
  await mkdir(IMAGE_DIRECTORY, { recursive: true });
  const entries = await readdir(IMAGE_DIRECTORY, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".webp"));
  if (files.length >= MAX_FILES) throw new ApiError(507, "Archivio immagini pieno. Libera spazio in .data/images prima di continuare.");
  let total = 0;
  for (const file of files) total += (await lstat(path.join(IMAGE_DIRECTORY, file.name))).size;
  if (total + MAX_IMAGE_BYTES > MAX_DISK_BYTES) {
    throw new ApiError(507, "Limite di spazio per le immagini raggiunto. Libera spazio prima di continuare.");
  }
}

type StorageLock = { pending: Promise<void> };
const storageGlobal = globalThis as typeof globalThis & { __fitImageStorage?: StorageLock };
const storage = storageGlobal.__fitImageStorage ??= { pending: Promise.resolve() };

export async function saveImage(image: Buffer): Promise<string> {
  let release!: () => void;
  const previous = storage.pending;
  storage.pending = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    await ensureImageCapacity();
    if (image.length > MAX_IMAGE_BYTES) throw new ApiError(502, "Immagine troppo grande.");
    const id = randomUUID();
    await writeFile(path.join(IMAGE_DIRECTORY, imageFileName(id)), image, { flag: "wx", mode: 0o600 });
    return `/api/images/${id}`;
  } finally { release(); }
}

export async function loadImage(id: string): Promise<Buffer> {
  const location = path.join(IMAGE_DIRECTORY, imageFileName(id));
  try {
    const info = await lstat(location);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_IMAGE_BYTES) throw new ApiError(404, "Immagine non trovata.");
    return await readFile(location);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, "Immagine non trovata.");
    }
    throw error;
  }
}
