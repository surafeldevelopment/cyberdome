# Log and packet-export import formats

Import instructor-provided logs or Wireshark/tshark exports into **Attack Evidence → Imports**.
The original file is stored in the Evidence Locker and every imported row keeps its raw record.

## Supported formats (auto-detected; can be forced)
| Format | How to produce it | Fields used |
|---|---|---|
| Generic CSV | `logs-template.csv` | `timestamp, source, destination, src_port, dst_port, protocol, event_type, message` (common aliases such as `src_ip`, `dst_ip`, `dport`, `msg`, `type` accepted) |
| JSON Lines / JSON array | one object per line, or `[ {...} ]` | same field names as CSV |
| Wireshark CSV | File → Export Packet Dissections → As CSV | No., Time, Source, Destination, Protocol, Length, Info |
| tshark fields | `tshark -r cap.pcap -T fields -E header=y -E separator=, -E quote=d -e frame.time_epoch -e ip.src -e ip.dst -e tcp.srcport -e tcp.dstport -e _ws.col.Protocol -e _ws.col.Info` | as listed |
| tshark JSON / EK | `tshark -r cap.pcap -T json` or `-T ek` | frame time, IP addresses, ports, protocol stack |

## Timestamp normalization
- The original timestamp text is always preserved.
- Timestamps with an explicit offset (`Z`, `-04:00`) or epoch seconds are converted to UTC (**explicit offset**).
- Timestamps without an offset are interpreted in the source timezone you choose at import and labeled **assumed timezone**.
- Missing timestamps, syslog times without a year, and Wireshark **relative** times (seconds since the first packet) are never placed on the clock. Re-export with absolute times (Wireshark: View → Time Display Format → Date and Time of Day; tshark: `-t ad` or `-e frame.time_epoch`).

## PCAP files
Upload `.pcap`/`.pcapng` to the Evidence Locker. CyberDome reads file headers (packet count, time range).
If `tshark` is installed, **Process with tshark** extracts packet summary fields locally (no shell, fixed
arguments, 60 s timeout, 50,000-packet and 100 MB limits) into a separately hashed derived CSV. Payloads are
never analyzed by the application.
