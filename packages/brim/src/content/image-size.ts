/** How large an image is drawn: its pixels, turned the way the browser turns it (a photo's EXIF orientation). */
export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Reads an image's size from its bytes, without decoding it: JPEG, PNG, GIF, WebP and AVIF. A photo taken sideways
 * is stored sideways with a note to turn it (EXIF orientation 5–8, or AVIF's `irot`); browsers turn it, so the size
 * returned is the turned one, the size the `<img>` is drawn at. `undefined` when the bytes are none of these, or
 * too damaged to say.
 */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = png(bytes, view) ?? gif(bytes, view) ?? jpeg(bytes, view) ?? webp(bytes, view) ?? avif(bytes, view);
    return size && size.width > 0 && size.height > 0 ? size : undefined;
  } catch {
    // A read past the end: the file stops before its size.
    return undefined;
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function turned(size: ImageSize, sideways: boolean): ImageSize {
  return sideways ? { width: size.height, height: size.width } : size;
}

function png(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes[0] !== 0x89 || ascii(bytes, 1, 3) !== "PNG" || ascii(bytes, 12, 4) !== "IHDR") return undefined;
  const size = { width: view.getUint32(16), height: view.getUint32(20) };
  // A PNG may carry an EXIF chunk too, which browsers honour; it comes before the image data.
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === "IDAT" || type === "IEND") break;
    if (type === "eXIf") return turned(size, exifSideways(bytes, offset + 8, length));
    offset += 12 + length;
  }
  return size;
}

function gif(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (ascii(bytes, 0, 4) !== "GIF8") return undefined;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

/** The markers that start a frame, and say its size: SOF0–SOF15 but DHT (C4), JPG (C8) and DAC (CC). */
const START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let sideways = false;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    // Fill bytes, and markers without a length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && ascii(bytes, offset + 4, 6) === "Exif\0\0") {
      sideways = exifSideways(bytes, offset + 10, length - 8);
    }
    if (START_OF_FRAME.has(marker)) {
      return turned({ width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }, sideways);
    }
    offset += 2 + length;
  }
  return undefined;
}

function webp(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk !== "VP8X") return undefined;
  const size = {
    width: 1 + (view.getUint16(24, true) | ((bytes[26] ?? 0) << 16)),
    height: 1 + (view.getUint16(27, true) | ((bytes[29] ?? 0) << 16)),
  };
  // Bit 3 of the flags: an EXIF chunk follows, after the image data.
  if (((bytes[20] ?? 0) & 0x08) === 0) return size;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset + 4, true);
    if (ascii(bytes, offset, 4) === "EXIF") {
      const start = ascii(bytes, offset + 8, 6) === "Exif\0\0" ? offset + 14 : offset + 8;
      return turned(size, exifSideways(bytes, start, length));
    }
    offset += 8 + length + (length % 2);
  }
  return size;
}

/**
 * AVIF (and HEIF): the primary item (`pitm`) is the image; its `ispe` property gives the size and an `irot` of 90° or
 * 270° turns it. Properties are listed once (`ipco`) and given to items by number (`ipma`): a large image is often a
 * grid of tiles, each tile an item with an `ispe` of its own, so the first `ispe` is not necessarily the image's.
 */
function avif(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  const brand = ascii(bytes, 8, 4);
  if (ascii(bytes, 4, 4) !== "ftyp" || !["avif", "avis", "heic", "heix", "mif1"].includes(brand)) return undefined;
  let primary: number | undefined;
  const properties: { type: string; body: number }[] = [];
  const associations = new Map<number, number[]>();
  const walk = (start: number, end: number): void => {
    let offset = start;
    while (offset + 8 <= end) {
      let length = view.getUint32(offset);
      const type = ascii(bytes, offset + 4, 4);
      let header = 8;
      if (length === 1) {
        length = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (length === 0) {
        length = end - offset;
      }
      if (length < header) return;
      const body = offset + header;
      // Boxes that hold others: `meta` has 4 bytes of version and flags first.
      if (type === "meta") walk(body + 4, offset + length);
      else if (type === "iprp") walk(body, offset + length);
      else if (type === "ipco") collectProperties(body, offset + length);
      else if (type === "pitm") primary = bytes[body] === 0 ? view.getUint16(body + 4) : view.getUint32(body + 4);
      else if (type === "ipma") collectAssociations(body);
      offset += length;
    }
  };
  const collectProperties = (start: number, end: number): void => {
    let offset = start;
    while (offset + 8 <= end) {
      const length = view.getUint32(offset);
      if (length < 8) return;
      properties.push({ type: ascii(bytes, offset + 4, 4), body: offset + 8 });
      offset += length;
    }
  };
  const collectAssociations = (body: number): void => {
    const version = bytes[body] ?? 0;
    const wide = ((bytes[body + 3] ?? 0) & 1) === 1;
    let offset = body + 4;
    const count = view.getUint32(offset);
    offset += 4;
    for (let entry = 0; entry < count; entry++) {
      const item = version < 1 ? view.getUint16(offset) : view.getUint32(offset);
      offset += version < 1 ? 2 : 4;
      const many = bytes[offset] ?? 0;
      offset += 1;
      const indexes: number[] = [];
      for (let index = 0; index < many; index++) {
        // The top bit marks a property as essential; the rest is its number in `ipco`, from 1.
        indexes.push(wide ? view.getUint16(offset) & 0x7fff : (bytes[offset] ?? 0) & 0x7f);
        offset += wide ? 2 : 1;
      }
      associations.set(item, indexes);
    }
  };
  walk(0, bytes.length);

  const own = primary === undefined ? undefined : associations.get(primary);
  const of = (type: string) =>
    own
      ? own.map((index) => properties[index - 1]).find((property) => property?.type === type)
      : properties.find((property) => property.type === type);
  const extent = of("ispe");
  if (!extent) return undefined;
  const rotation = of("irot");
  const sideways = rotation ? ((bytes[rotation.body] ?? 0) & 0x03) % 2 === 1 : false;
  return turned({ width: view.getUint32(extent.body + 4), height: view.getUint32(extent.body + 8) }, sideways);
}

/**
 * Whether an EXIF block (a TIFF header at `start`) turns the image a quarter: orientations 5 to 8. Only the first
 * directory is read, where the orientation is.
 */
function exifSideways(bytes: Uint8Array, start: number, length: number): boolean {
  const end = Math.min(bytes.length, start + length);
  if (start + 8 > end) return false;
  const order = ascii(bytes, start, 2);
  if (order !== "II" && order !== "MM") return false;
  const little = order === "II";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directory = start + view.getUint32(start + 4, little);
  if (directory + 2 > end) return false;
  const entries = view.getUint16(directory, little);
  for (let index = 0; index < entries; index++) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > end) return false;
    if (view.getUint16(entry, little) === 0x0112) {
      const orientation = view.getUint16(entry + 8, little);
      return orientation >= 5 && orientation <= 8;
    }
  }
  return false;
}
