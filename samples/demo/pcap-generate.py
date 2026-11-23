#!/usr/bin/env python3
"""SYNTHETIC capture generator for CyberDome demos and tests.

Builds a classic PCAP of TCP SYN packets from 198.51.100.77 (documentation range,
RFC 5737) to 192.0.2.10 (web01.cyberdome.example, fictional). No real traffic is
captured; every byte is constructed here.

Usage: python3 pcap-generate.py <out.pcap> [start_epoch]
"""
import struct, sys

def csum(b):
    if len(b) % 2: b += b'\0'
    s = sum(struct.unpack('!%dH' % (len(b) // 2), b))
    while s >> 16: s = (s & 0xffff) + (s >> 16)
    return ~s & 0xffff

def ip(a): return bytes(int(x) for x in a.split('.'))

def syn(src, dst, sport, dport, seq):
    tcp = struct.pack('!HHIIBBHHH', sport, dport, seq, 0, 5 << 4, 0x02, 64240, 0, 0)
    pseudo = ip(src) + ip(dst) + struct.pack('!BBH', 0, 6, len(tcp))
    tcp = tcp[:16] + struct.pack('!H', csum(pseudo + tcp)) + tcp[18:]
    iph = struct.pack('!BBHHHBBH4s4s', 0x45, 0, 20 + len(tcp), seq & 0xffff, 0, 64, 6, 0, ip(src), ip(dst))
    iph = iph[:10] + struct.pack('!H', csum(iph)) + iph[12:]
    eth = bytes.fromhex('02000000000a') + bytes.fromhex('020000000077') + b'\x08\x00'
    return eth + iph + tcp

def main():
    out = sys.argv[1]
    t0 = int(sys.argv[2]) if len(sys.argv) > 2 else 1791468180  # 2026-10-08T14:03:00Z (10:03 EDT)
    src, dst = '198.51.100.77', '192.0.2.10'
    plan = [(21, 0.0), (22, 0.2), (23, 0.4), (80, 0.6), (443, 0.8), (3306, 1.0), (22, 30.0), (22, 31.5), (22, 33.0), (22, 34.5)]
    with open(out, 'wb') as f:
        f.write(struct.pack('<IHHiIII', 0xa1b2c3d4, 2, 4, 0, 0, 65535, 1))
        for i, (port, dt) in enumerate(plan):
            pkt = syn(src, dst, 40000 + i, port, 1000 + i)
            ts = t0 + dt
            f.write(struct.pack('<IIII', int(ts), int(round((ts % 1) * 1e6)), len(pkt), len(pkt)))
            f.write(pkt)

if __name__ == '__main__':
    main()
