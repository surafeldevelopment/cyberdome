/** Content sniffing from actual bytes. File extensions and client MIME types are never trusted. */
export type DetectedType =
  | 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'pcap' | 'pcapng' | 'zip' | 'gzip'
  | 'nmap_xml' | 'nessus_xml' | 'greenbone_xml' | 'xml' | 'json' | 'html' | 'svg' | 'csv' | 'text'
  | 'executable' | 'binary';

export function detectType(buf: Buffer, filename = ''): DetectedType {
  const b = buf;
  const hex = b.subarray(0, 8).toString('hex');
  if (hex.startsWith('89504e47')) return 'png';
  if (hex.startsWith('ffd8ff')) return 'jpeg';
  if (hex.startsWith('47494638')) return 'gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (hex.startsWith('25504446')) return 'pdf';
  if (['a1b2c3d4', 'd4c3b2a1', 'a1b23c4d', '4d3cb2a1'].includes(hex.slice(0, 8))) return 'pcap';
  if (hex.startsWith('0a0d0d0a')) return 'pcapng';
  if (hex.startsWith('504b0304')) return 'zip';
  if (hex.startsWith('1f8b')) return 'gzip';
  if (hex.startsWith('4d5a') || hex.startsWith('7f454c46') || ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(hex.slice(0, 8)))
    return 'executable';

  if (!looksLikeText(b)) return 'binary';
  const head = b.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  const lower = head.toLowerCase();
  if (lower.startsWith('<?xml') || lower.startsWith('<')) {
    if (/<nmaprun[\s>]/.test(lower)) return 'nmap_xml';
    if (/<nessusclientdata_v2[\s>]/.test(lower)) return 'nessus_xml';
    if (/<report[\s>][^]*?(openvas|greenbone|gvm)|<get_reports_response|<report\s+id=|<report\s+format_id=/.test(lower)) return 'greenbone_xml';
    if (/<svg[\s>]/.test(lower)) return 'svg';
    if (/<!doctype html|<html[\s>]/.test(lower)) return 'html';
    return 'xml';
  }
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (/<script|<iframe|<html/i.test(head)) return 'html';
  return 'text';
}

function looksLikeText(b: Buffer): boolean {
  const sample = b.subarray(0, 8192);
  if (sample.length === 0) return true;
  let bad = 0;
  for (const c of sample) {
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) bad++;
  }
  return bad / sample.length < 0.02;
}

export const MIME_FOR: Partial<Record<DetectedType, string>> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  pcap: 'application/vnd.tcpdump.pcap', pcapng: 'application/x-pcapng', zip: 'application/zip', gzip: 'application/gzip',
  nmap_xml: 'application/xml', nessus_xml: 'application/xml', greenbone_xml: 'application/xml', xml: 'application/xml',
  json: 'application/json', html: 'text/html', svg: 'image/svg+xml', csv: 'text/csv', text: 'text/plain', binary: 'application/octet-stream',
};

export const IMAGE_TYPES: DetectedType[] = ['png', 'jpeg', 'gif', 'webp'];
export const TEXT_TYPES: DetectedType[] = ['nmap_xml', 'nessus_xml', 'greenbone_xml', 'xml', 'json', 'html', 'svg', 'csv', 'text'];
