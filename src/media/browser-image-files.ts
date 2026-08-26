type ClipboardFileItem = {
  readonly kind: string;
  readonly type: string;
  readonly getAsFile: () => File | null;
};

export type ClipboardImageData = {
  readonly files: ArrayLike<File>;
  readonly items: ArrayLike<ClipboardFileItem>;
};

export function imageFilesFromList(files: ArrayLike<File>): File[] {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

export function reviewMediaFilesFromList(files: ArrayLike<File>): File[] {
  return Array.from(files).flatMap((file) => {
    if (file.type.startsWith("image/")) return [file];
    if (!isMp4File(file)) return [];
    if (file.type === "video/mp4") return [file];
    return [new File([file], file.name, { type: "video/mp4", lastModified: file.lastModified })];
  });
}

export function isMp4File(file: Pick<File, "name" | "type">): boolean {
  return file.type.toLowerCase() === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

export function imageFilesFromClipboard(data: ClipboardImageData, now = Date.now()): File[] {
  const directFiles = imageFilesFromList(data.files);
  const candidates =
    directFiles.length > 0
      ? directFiles.map((file) => ({ file, fallbackMime: file.type }))
      : Array.from(data.items).flatMap((item) => {
          if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
          const file = item.getAsFile();
          return file ? [{ file, fallbackMime: item.type }] : [];
        });

  return candidates.map(({ file, fallbackMime }, index) => ensureClipboardFile(file, fallbackMime, now, index));
}

function ensureClipboardFile(file: File, fallbackMime: string, now: number, index: number): File {
  const type = file.type.startsWith("image/") ? file.type : fallbackMime;
  const name = file.name.trim() || `pasted-plate-${now}-${index + 1}.${extensionForMime(type)}`;
  if (name === file.name && type === file.type) return file;
  return new File([file], name, {
    type,
    lastModified: file.lastModified || now,
  });
}

function extensionForMime(mime: string): string {
  const subtype = mime.split("/", 2)[1]?.split("+", 1)[0]?.toLowerCase();
  if (subtype === "jpeg") return "jpg";
  return subtype && /^[a-z0-9]+$/.test(subtype) ? subtype : "png";
}
