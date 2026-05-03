import { App, normalizePath, TFile, Vault } from "obsidian";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif"]);

export function isImageFile(file: { name: string; type?: string }): boolean {
  if (file.type && file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTS.has(ext);
}

function sanitizeBase(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60) || "image";
}

function extOf(name: string): string {
  const m = name.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : "bin";
}

async function uniquePath(vault: Vault, folder: string, base: string, ext: string): Promise<string> {
  let candidate = normalizePath(`${folder}/${base}.${ext}`);
  let n = 2;
  while (vault.getAbstractFileByPath(candidate)) {
    candidate = normalizePath(`${folder}/${base}-${n}.${ext}`);
    n += 1;
  }
  return candidate;
}

export async function saveAttachmentFile(
  app: App,
  folder: string,
  file: File
): Promise<TFile> {
  const ext = extOf(file.name);
  const stamp = formatStamp(new Date());
  const base = `${stamp}-${sanitizeBase(file.name)}`;
  const path = await uniquePath(app.vault, folder, base, ext);
  const buffer = await file.arrayBuffer();
  return await app.vault.createBinary(path, buffer);
}

function formatStamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
