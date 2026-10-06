"""Decode a PNG and report what is actually in it.

Used to verify the headless renders (world/preview*.png, world/viewer-shot.png)
without needing to open them. Pure stdlib: zlib + struct.

    python scripts/inspect_screenshot.py world/viewer-shot.png
"""

from __future__ import annotations

import struct
import sys
import zlib
from collections import Counter
from pathlib import Path


def decode(path: Path) -> tuple[int, int, list[bytes]]:
    data = path.read_bytes()
    pos, idat, width = 8, b"", 0
    height, depth, color_type = 0, 0, 0
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color_type = struct.unpack(">IIBB", chunk[:10])
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length

    if depth != 8:
        raise SystemExit(f"only 8-bit PNGs supported (got {depth})")
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[color_type]
    raw = zlib.decompress(idat)
    stride = width * bpp
    previous = bytearray(stride)
    rows: list[bytes] = []
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset : offset + stride])
        offset += stride
        if filter_type == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 0xFF
        elif filter_type == 2:
            for x in range(stride):
                line[x] = (line[x] + previous[x]) & 0xFF
        elif filter_type == 3:
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((left + previous[x]) // 2)) & 0xFF
        elif filter_type == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = previous[x]
                c = previous[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 0xFF
        rows.append(bytes(line))
        previous = line
    return width, height, rows


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = Path(sys.argv[1])
    width, height, rows = decode(path)
    bpp = 3
    counter: Counter = Counter()
    step = max(1, min(width, height) // 400)
    total = 0
    for y in range(0, height, step):
        row = rows[y]
        for x in range(0, width, step):
            offset = x * bpp
            counter[row[offset : offset + 3]] += 1
            total += 1

    print(f"{path.name}: {width}x{height}, {len(counter)} distinct colours, {total} sampled")
    print("  top 12 colours:")
    for colour, count in counter.most_common(12):
        share = 100 * count / total
        print(f"    #{colour[0]:02x}{colour[1]:02x}{colour[2]:02x}  {share:5.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
