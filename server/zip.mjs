/* A minimal .zip writer (deflate, no dependencies): enough to hand Admin one file of reports and their documents. */
import zlib from "node:zlib";

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

/** files: [{ name, data: Buffer|string }] → one zip Buffer. Names are UTF-8 (flag bit 11). */
export function makeZip(files, when = new Date()) {
  const [time, date] = dosTime(when);
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), "utf8");
    const crc = zlib.crc32(raw);
    const packed = zlib.deflateRawSync(raw);
    const store = packed.length >= raw.length; // already-compressed files (JPEG, PDF) are stored as they are
    const body = store ? raw : packed, method = store ? 0 : 8;
    const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(time), u16(date), u32(crc), u32(body.length), u32(raw.length), u16(name.length), u16(0), name]);
    local.push(head, body);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(time), u16(date), u32(crc), u32(body.length), u32(raw.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += head.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
  return Buffer.concat([...local, cd, end]);
}

/** Read a .zip (stored or deflated entries, as makeZip writes and as common tools write) → Map(name → Buffer).
 * Reads the central directory, so sizes are right even when a tool streamed the file. */
export function readZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(end + 10), cdOff = buf.readUInt32LE(end + 16);
  const out = new Map();
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("damaged zip file");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lstart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(lstart, lstart + csize);
    if (!name.endsWith("/")) out.set(name, method === 0 ? Buffer.from(data) : method === 8 ? zlib.inflateRawSync(data) : (() => { throw new Error(`unsupported zip method ${method}`); })());
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
