export type StoredZipEntry = {
  readonly name: string;
  readonly data: Blob | Uint8Array | string;
};

type PreparedEntry = {
  readonly name: Uint8Array;
  readonly data: Uint8Array;
  readonly crc: number;
  readonly offset: number;
};

const encoder = new TextEncoder();
const DOS_DATE_1980_01_01 = 33;

/** Creates a standards-compliant uncompressed ZIP without adding a runtime dependency. */
export async function createStoredZip(entries: ReadonlyArray<StoredZipEntry>): Promise<Blob> {
  if (entries.length === 0 || entries.length > 65_535)
    throw new Error("ZIP entry count is outside the supported range.");
  const prepared: PreparedEntry[] = [];
  const localParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(safeZipName(entry.name));
    const data = await entryBytes(entry.data);
    if (name.length > 65_535 || data.length > 0xffff_ffff) throw new Error("ZIP entry is too large.");
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, DOS_DATE_1980_01_01, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    header.set(name, 30);
    prepared.push({ name, data, crc, offset });
    localParts.push(header, data);
    offset += header.length + data.length;
  }

  const centralOffset = offset;
  const centralParts = prepared.map((entry) => {
    const header = new Uint8Array(46 + entry.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, DOS_DATE_1980_01_01, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    header.set(entry.name, 46);
    return header;
  });
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, prepared.length, true);
  endView.setUint16(10, prepared.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);
  return new Blob([...localParts.map(exactBuffer), ...centralParts.map(exactBuffer), exactBuffer(end)], {
    type: "application/zip",
  });
}

async function entryBytes(value: StoredZipEntry["data"]): Promise<Uint8Array> {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(await value.arrayBuffer());
}

function safeZipName(value: string): string {
  const name = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!name || name.split("/").some((part) => part === "..")) throw new Error("ZIP entry name is unsafe.");
  return name;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
