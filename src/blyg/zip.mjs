// Deterministic ZIP (stored entries, UTF-8 names), usable without a dependency
// or server in the standalone studio. ZIP64-sized publications fail explicitly.
const encoder = new TextEncoder();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let n=0;n<8;n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function createSiteZip(files) {
  if (files.length > 65535) throw new Error('ZIP64 required');
  const local = [], central = [];
  let offset = 0, centralSize = 0;
  for (const {path,body} of files) {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('unsafe ZIP path');
    const name = encoder.encode(path), data = typeof body === 'string' ? encoder.encode(body) : body;
    if (!(data instanceof Uint8Array) || name.length > 65535 || data.length > 0xffffffff) throw new Error('invalid ZIP entry or ZIP64 required');
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x800,true); h.setUint16(12,33,true);
    h.setUint32(14,crc,true); h.setUint32(18,data.length,true); h.setUint32(22,data.length,true); h.setUint16(26,name.length,true); header.set(name,30);
    const record = new Uint8Array(46 + name.length), c = new DataView(record.buffer);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x800,true); c.setUint16(14,33,true);
    c.setUint32(16,crc,true); c.setUint32(20,data.length,true); c.setUint32(24,data.length,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true); record.set(name,46);
    local.push(header,data); central.push(record); offset += header.length + data.length; centralSize += record.length;
    if (offset + centralSize > 0xffffffff) throw new Error('ZIP64 required');
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,centralSize,true); e.setUint32(16,offset,true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...local,...central,end]) { out.set(part,at); at += part.length; }
  return out;
}
