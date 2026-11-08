import { deflateSync } from "node:zlib";
export function pngFixture(width = 2, height = 2, encoded?: Buffer) {
  function chunk(type: string, bytes: Buffer) {
    const body = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff;
    for (const value of body) { crc ^= value; for (let n = 0; n < 8; n++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
    const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(bytes.length); body.copy(out,4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR",header), chunk("IDAT",encoded ?? deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk("IEND",Buffer.alloc(0))]);
}
