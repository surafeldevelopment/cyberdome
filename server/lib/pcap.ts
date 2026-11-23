/**
 * Reads PCAP / PCAPNG *file metadata only*: link type, packet count, first/last
 * packet timestamps. This is NOT protocol analysis — no payloads are decoded.
 */
export interface PcapMeta {
  format: 'pcap' | 'pcapng';
  linkType: number | null;
  linkTypeName: string;
  packetCount: number;
  firstPacketAt: string | null;
  lastPacketAt: string | null;
  truncated: boolean;
  note: string;
}

const LINK: Record<number, string> = { 0: 'NULL/Loopback', 1: 'Ethernet', 101: 'Raw IP', 105: 'IEEE 802.11', 113: 'Linux cooked (SLL)', 127: '802.11 radiotap', 276: 'Linux cooked v2 (SLL2)' };

export function readPcapMeta(buf: Buffer): PcapMeta | null {
  if (buf.length < 24) return null;
  const magic = buf.readUInt32LE(0);
  if (magic === 0x0a0d0d0a) return readPcapng(buf);
  let le: boolean, nano: boolean;
  if (magic === 0xa1b2c3d4) { le = true; nano = false; }
  else if (magic === 0xd4c3b2a1) { le = false; nano = false; }
  else if (magic === 0xa1b23c4d) { le = true; nano = true; }
  else if (magic === 0x4d3cb2a1) { le = false; nano = true; }
  else return null;
  const r32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const linkType = r32(20);
  let off = 24, count = 0, first: number | null = null, last: number | null = null, truncated = false;
  while (off + 16 <= buf.length) {
    const sec = r32(off), frac = r32(off + 4), incl = r32(off + 8);
    const t = sec * 1000 + (nano ? frac / 1e6 : frac / 1e3);
    if (first === null) first = t;
    last = t;
    count++;
    off += 16 + incl;
    if (off > buf.length) { truncated = true; break; }
  }
  return {
    format: 'pcap', linkType, linkTypeName: LINK[linkType] ?? `Link type ${linkType}`, packetCount: count,
    firstPacketAt: first !== null ? new Date(first).toISOString() : null,
    lastPacketAt: last !== null ? new Date(last).toISOString() : null,
    truncated, note: 'File headers only. Packet contents were not decoded.',
  };
}

function readPcapng(buf: Buffer): PcapMeta {
  let off = 0, count = 0, first: number | null = null, last: number | null = null, linkType: number | null = null, le = true, truncated = false;
  while (off + 12 <= buf.length) {
    let type = buf.readUInt32LE(off);
    if (type === 0x0a0d0d0a) {
      const bom = buf.readUInt32LE(off + 8);
      le = bom === 0x1a2b3c4d;
    }
    const r32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    type = r32(off);
    const len = r32(off + 4);
    if (len < 12 || off + len > buf.length) { truncated = off + len > buf.length; break; }
    if (type === 1 && linkType === null) linkType = le ? buf.readUInt16LE(off + 8) : buf.readUInt16BE(off + 8);
    if (type === 6) {
      // Enhanced Packet Block; assume default microsecond resolution (if_tsresol not parsed)
      const hi = r32(off + 12), lo = r32(off + 16);
      const us = hi * 4294967296 + lo;
      const t = us / 1000;
      if (first === null) first = t;
      last = t;
      count++;
    } else if (type === 3) count++;
    off += len;
  }
  return {
    format: 'pcapng', linkType, linkTypeName: linkType !== null ? (LINK[linkType] ?? `Link type ${linkType}`) : 'Unknown', packetCount: count,
    firstPacketAt: first !== null ? new Date(first).toISOString() : null,
    lastPacketAt: last !== null ? new Date(last).toISOString() : null,
    truncated,
    note: 'Block headers only (timestamps assume default microsecond resolution). Packet contents were not decoded.',
  };
}
