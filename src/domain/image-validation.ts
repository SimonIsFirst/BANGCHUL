/** Bounded container validation shared by the browser and the upload API. */
export interface ImageInfo { width: number; height: number }
const fail = () => { throw new Error("손상되었거나 지원하지 않는 이미지예요. JPG·PNG로 다시 내보내주세요."); };
const need = (value: unknown) => { if (!value) fail(); };
const ascii = (b: Uint8Array, at: number, size: number) => String.fromCharCode(...b.subarray(at, at + size));
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc(b: Uint8Array, from: number, to: number) { let n = 0xffffffff; for (let i = from; i < to; i++) n = crcTable[(n ^ b[i]) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; }
function dimensions(width: number, height: number): ImageInfo { need(width > 0 && height > 0 && width * height <= 40_000_000); return { width, height }; }

function png(b: Uint8Array): ImageInfo {
  need(b.length >= 57 && [137,80,78,71,13,10,26,10].every((v, i) => b[i] === v));
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = 8; let info: ImageInfo | undefined; let data = false; let endedData = false; let palette = false; let color = 0; let chunks = 0;
  while (at + 12 <= b.length) {
    const size = v.getUint32(at); const end = at + 12 + size; need(end <= b.length && ++chunks <= 100_000);
    const type = ascii(b, at + 4, 4); need(/^[A-Za-z]{4}$/.test(type) && crc(b, at + 4, end - 4) === v.getUint32(end - 4));
    if (!info) {
      need(type === "IHDR" && size === 13); info = dimensions(v.getUint32(at + 8), v.getUint32(at + 12));
      const depth = b[at + 16]; color = b[at + 17];
      const depths: Record<number, number[]> = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
      need(depths[color]?.includes(depth) && b[at + 18] === 0 && b[at + 19] === 0 && b[at + 20] <= 1);
    } else if (type === "IHDR") fail();
    else if (type === "PLTE") { need(!data && !palette && size > 0 && size <= 768 && size % 3 === 0); palette = true; }
    else if (type === "IDAT") { need(!endedData && size > 0 && (color !== 3 || palette)); data = true; }
    else if (type === "IEND") { need(size === 0 && data && end === b.length); return info; }
    else { if (data) endedData = true; need(type[0] === type[0].toLowerCase()); }
    at = end;
  }
  return fail();
}
function jpeg(b: Uint8Array): ImageInfo {
  need(b.length >= 32 && b[0] === 255 && b[1] === 216);
  let at = 2; let info: ImageInfo | undefined; let scan = false; let entropy = 0;
  while (at < b.length) {
    need(b[at++] === 255); while (b[at] === 255) at++;
    const marker = b[at++];
    if (marker === 217) { need(info && scan && entropy > 0 && at === b.length); return info!; }
    need(marker !== undefined && marker !== 216 && marker !== 0 && !(marker >= 208 && marker <= 215));
    need(at + 2 <= b.length); const size = b[at] * 256 + b[at + 1]; need(size >= 2 && at + size <= b.length);
    if ([192,193,194].includes(marker)) {
      need(!info && size >= 11 && b[at + 2] === 8); const components = b[at + 7]; need([1,3,4].includes(components) && size === 8 + 3 * components);
      info = dimensions(b[at + 5] * 256 + b[at + 6], b[at + 3] * 256 + b[at + 4]);
    } else if (marker >= 192 && marker <= 207 && ![196,200,204].includes(marker)) fail();
    if (marker === 218) {
      need(info && size >= 8 && size === 6 + 2 * b[at + 2]); scan = true; at += size;
      while (at < b.length) {
        if (b[at] !== 255) { entropy++; at++; continue; }
        if (b[at + 1] === 0 || b[at + 1] >= 208 && b[at + 1] <= 215) { entropy++; at += 2; continue; }
        if (b[at + 1] === 255) { at++; continue; }
        break;
      }
    } else at += size;
  }
  return fail();
}
function webp(b: Uint8Array): ImageInfo {
  need(b.length >= 30 && ascii(b,0,4) === "RIFF" && ascii(b,8,4) === "WEBP");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength); need(v.getUint32(4,true) + 8 === b.length);
  let at = 12; let info: ImageInfo | undefined; let canvas: ImageInfo | undefined;
  while (at + 8 <= b.length) {
    const type = ascii(b,at,4); const size = v.getUint32(at + 4,true); const data = at + 8; const end = data + size; need(end + (size & 1) <= b.length);
    if (size & 1) need(b[end] === 0);
    if (type === "VP8X") {
      need(at === 12 && size === 10 && !(b[data] & 0xc3) && b[data+1] === 0 && b[data+2] === 0 && b[data+3] === 0);
      canvas = dimensions(1 + b[data+4] + (b[data+5]<<8) + (b[data+6]<<16), 1 + b[data+7] + (b[data+8]<<8) + (b[data+9]<<16));
    } else if (type === "VP8 ") {
      need(!info && size > 10 && !(b[data] & 1) && ascii(b,data+3,3) === "\x9d\x01\x2a");
      need(((b[data] | b[data+1]<<8 | b[data+2]<<16) >>> 5) <= size - 10);
      info = dimensions(v.getUint16(data+6,true)&0x3fff, v.getUint16(data+8,true)&0x3fff);
    } else if (type === "VP8L") {
      need(!info && size >= 10 && b[data] === 47 && !(b[data+4]&0xe0));
      const bits = v.getUint32(data+1,true); info = dimensions(1+(bits&0x3fff), 1+(bits>>>14&0x3fff));
    } else need(!["ANIM","ANMF"].includes(type));
    at = end + (size & 1);
  }
  need(at === b.length && info && (!canvas || canvas.width === info.width && canvas.height === info.height));
  return info!;
}
export function imageInfo(bytes: Uint8Array, mime: string): ImageInfo {
  try { return mime === "image/png" ? png(bytes) : mime === "image/jpeg" ? jpeg(bytes) : mime === "image/webp" ? webp(bytes) : fail(); }
  catch { return fail(); }
}

/** Validate PNG's compressed scanlines without allocating the decoded pixel image. */
export async function validateImage(bytes: Uint8Array, mime: string): Promise<ImageInfo> {
  const info = imageInfo(bytes, mime);
  if (mime !== "image/png") return info;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8; let compressedSize = 0; const slices: Uint8Array[] = [];
  while (at + 12 <= bytes.length) { const size = view.getUint32(at); if (ascii(bytes, at+4, 4) === "IDAT") { slices.push(bytes.subarray(at+8,at+8+size)); compressedSize += size; } at += 12 + size; }
  const compressed = new Uint8Array(compressedSize); let offset = 0;
  for (const slice of slices) { compressed.set(slice,offset); offset += slice.length; }
  const depth = bytes[24]; const channels: Record<number,number> = {0:1,2:3,3:1,4:2,6:4};
  const passes = bytes[28] ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const rows = passes.map(([x,y,dx,dy]) => ({ count:Math.max(0,Math.ceil((info.height-y)/dy)), stride:1+Math.ceil(Math.max(0,Math.ceil((info.width-x)/dx))*channels[bytes[25]]*depth/8) })).filter((p)=>p.stride>1 && p.count>0);
  let pass = 0; let row = 0; let column = 0;
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break; let position = 0;
      while (position < next.value.length) {
        need(pass < rows.length); if (column === 0) need(next.value[position] <= 4);
        const take = Math.min(rows[pass].stride-column, next.value.length-position); position += take; column += take;
        if (column === rows[pass].stride) { column=0; if (++row === rows[pass].count) {pass++;row=0;} }
      }
    }
    need(pass === rows.length && column === 0); return info;
  } catch { await reader.cancel().catch(()=>{}); return fail(); }
  finally { reader.releaseLock(); }
}
