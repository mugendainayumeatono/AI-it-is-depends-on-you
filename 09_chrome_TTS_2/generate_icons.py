#!/usr/bin/env python3
"""
Generate PNG icons for the Voice Assistant Chrome extension.
Uses only Python stdlib (struct, zlib, math, os) — no Pillow required.
Creates blue-gradient circle icons at 16x16, 48x48, and 128x128.
"""

import struct
import zlib
import math
import os


def make_png(width: int, height: int, pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    """
    Encode a 2-D list of (R, G, B, A) pixel rows into a valid PNG bytestring.
    Uses RGBA (color type 6), bit depth 8, no interlacing.
    """

    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        length = struct.pack('>I', len(data))
        body = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)
        return length + body + crc

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR: width, height, bit_depth=8, color_type=6 (RGBA),
    #        compression=0, filter=0, interlace=0
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)

    # IDAT: build raw scanlines (filter byte 0x00 per row), then zlib-compress
    raw_rows = []
    for row in pixels:
        row_bytes = bytearray([0])  # filter byte = None (0)
        for (r, g, b, a) in row:
            row_bytes += bytes([r, g, b, a])
        raw_rows.append(bytes(row_bytes))
    raw_data = b''.join(raw_rows)
    compressed = zlib.compress(raw_data, level=9)
    idat = chunk(b'IDAT', compressed)

    # IEND
    iend = chunk(b'IEND', b'')

    return signature + ihdr + idat + iend


def generate_icon(size: int) -> bytes:
    """
    Generate a blue-gradient circle icon of the given square size.
    - Inside circle: radial gradient from center (bright blue) to edge (dark blue)
    - Outside circle: fully transparent
    - Microphone symbol drawn in white
    """
    cx = size / 2.0
    cy = size / 2.0
    radius = size / 2.0 - 0.5  # slight inset for anti-alias feel

    # Color anchors
    # center color: rgb(55, 120, 230) — bright blue
    # edge color:   rgb(30,  64, 175) — dark blue (Tailwind blue-700 ≈ #1d4ed8)
    center_rgb = (55, 120, 230)
    edge_rgb   = (30,  64, 175)

    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            dx = x - cx + 0.5  # +0.5 for pixel center
            dy = y - cy + 0.5
            dist = math.sqrt(dx * dx + dy * dy)

            if dist > radius:
                row.append((0, 0, 0, 0))  # transparent outside circle
            else:
                # t = 0 at center, 1 at edge
                t = dist / radius

                # Smooth the edge with a soft-alpha band (last 8% of radius)
                alpha_band = 0.92
                if t > alpha_band:
                    alpha = 1.0 - (t - alpha_band) / (1.0 - alpha_band)
                    alpha = int(alpha * 255)
                else:
                    alpha = 255

                # Gradient interpolation
                r = int(center_rgb[0] + t * (edge_rgb[0] - center_rgb[0]))
                g = int(center_rgb[1] + t * (edge_rgb[1] - center_rgb[1]))
                b = int(center_rgb[2] + t * (edge_rgb[2] - center_rgb[2]))

                row.append((r, g, b, alpha))
        pixels.append(row)

    # Overlay a simple microphone/speaker icon in white
    _draw_icon_symbol(pixels, size)

    return make_png(size, size, pixels)


def _draw_icon_symbol(pixels: list, size: int) -> None:
    """
    Draw a minimal white speaker/microphone symbol in the center of the icon.
    Scales to the icon size.  Uses simple pixel painting (no anti-aliasing needed
    at small sizes; at larger sizes it's fine too).
    """
    cx = size / 2.0
    cy = size / 2.0

    # Scale factor relative to 128px baseline
    s = size / 128.0
    white = (255, 255, 255, 255)

    def set_px(px: float, py: float, color=white, radius_px: float = 1.0):
        """Paint a small filled circle of pixels."""
        r = max(0.5, radius_px)
        for iy in range(int(py - r) - 1, int(py + r) + 2):
            for ix in range(int(px - r) - 1, int(px + r) + 2):
                if 0 <= ix < size and 0 <= iy < size:
                    dx = ix + 0.5 - px
                    dy = iy + 0.5 - py
                    if dx * dx + dy * dy <= r * r:
                        # Blend with existing pixel (respect existing alpha)
                        bg_r, bg_g, bg_b, bg_a = pixels[iy][ix]
                        if bg_a > 0:
                            pixels[iy][ix] = color

    def draw_filled_rect(x0: float, y0: float, x1: float, y1: float, color=white):
        for iy in range(max(0, int(y0)), min(size, int(y1) + 1)):
            for ix in range(max(0, int(x0)), min(size, int(x1) + 1)):
                bg_a = pixels[iy][ix][3]
                if bg_a > 0:
                    pixels[iy][ix] = color

    def draw_ring(ox: float, oy: float, r_inner: float, r_outer: float,
                  a_start: float = 0.0, a_end: float = 2 * math.pi, color=white):
        """Draw an arc ring (partial or full) using pixel painting."""
        for iy in range(max(0, int(oy - r_outer) - 1), min(size, int(oy + r_outer) + 2)):
            for ix in range(max(0, int(ox - r_outer) - 1), min(size, int(ox + r_outer) + 2)):
                px = ix + 0.5
                py = iy + 0.5
                dx = px - ox
                dy = py - oy
                dist2 = dx * dx + dy * dy
                if r_inner * r_inner <= dist2 <= r_outer * r_outer:
                    angle = math.atan2(dy, dx)
                    if angle < 0:
                        angle += 2 * math.pi
                    # normalise a_start / a_end
                    if a_start <= angle <= a_end or a_start > a_end:
                        bg_a = pixels[iy][ix][3]
                        if bg_a > 0:
                            pixels[iy][ix] = color

    if size <= 20:
        # Tiny icon: just a white dot in the center
        r_dot = max(1.5, 2.5 * s)
        set_px(cx, cy, white, r_dot)
        return

    # Draw a simplified microphone:
    #   - rounded rectangle body
    #   - arc below body (the stand)
    #   - vertical line (stand pole)
    #   - horizontal base line

    mic_w  = 18 * s   # microphone body width
    mic_h  = 28 * s   # microphone body height
    mic_r  = mic_w / 2  # corner radius (full round on top)

    body_cx = cx
    body_top = cy - 28 * s
    body_bot = cy + 4 * s

    # Microphone body: filled rounded rect
    # Top rounded cap (semicircle)
    for iy in range(max(0, int(body_top - mic_r)), min(size, int(body_bot) + 1)):
        for ix in range(max(0, int(body_cx - mic_w / 2)), min(size, int(body_cx + mic_w / 2) + 1)):
            px = ix + 0.5
            py = iy + 0.5
            # Within bounding box; check top and bottom rounded corners
            in_rect = True
            # top rounded
            if py < body_top + mic_r:
                dx = px - body_cx
                dy = py - (body_top + mic_r)
                if dx * dx + dy * dy > mic_r * mic_r:
                    in_rect = False
            # bottom rounded
            if py > body_bot - mic_r:
                dx = px - body_cx
                dy = py - (body_bot - mic_r)
                if dx * dx + dy * dy > mic_r * mic_r:
                    in_rect = False
            if in_rect and 0 <= ix < size and 0 <= iy < size:
                bg_a = pixels[iy][ix][3]
                if bg_a > 0:
                    pixels[iy][ix] = white

    # Arc: open downward semicircle below the mic body
    arc_r_outer = 20 * s
    arc_r_inner = arc_r_outer - max(2, 3 * s)
    arc_cy = body_bot  # center at bottom of mic body
    draw_ring(
        body_cx, arc_cy,
        arc_r_inner, arc_r_outer,
        a_start=math.pi,  # left
        a_end=2 * math.pi  # right (going down through bottom)
    )
    # Fix: draw_ring with a_start > a_end doesn't wrap nicely — use two passes
    for iy in range(max(0, int(arc_cy)), min(size, int(arc_cy + arc_r_outer) + 2)):
        for ix in range(max(0, int(body_cx - arc_r_outer) - 1), min(size, int(body_cx + arc_r_outer) + 2)):
            px = ix + 0.5
            py = iy + 0.5
            dx = px - body_cx
            dy = py - arc_cy
            dist2 = dx * dx + dy * dy
            if arc_r_inner * arc_r_inner <= dist2 <= arc_r_outer * arc_r_outer:
                if dy >= 0:  # bottom half
                    bg_a = pixels[iy][ix][3]
                    if bg_a > 0:
                        pixels[iy][ix] = white

    # Vertical pole from arc bottom to base
    pole_top = arc_cy + arc_r_outer
    pole_bot = arc_cy + arc_r_outer + 10 * s
    pole_w = max(2, 3 * s)
    draw_filled_rect(body_cx - pole_w / 2, pole_top, body_cx + pole_w / 2, pole_bot)

    # Horizontal base
    base_w = 24 * s
    base_h = max(2, 3 * s)
    draw_filled_rect(body_cx - base_w / 2, pole_bot, body_cx + base_w / 2, pole_bot + base_h)


def main():
    sizes = [16, 48, 128]
    icons_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in sizes:
        png_data = generate_icon(size)
        out_path = os.path.join(icons_dir, f'icon{size}.png')
        with open(out_path, 'wb') as f:
            f.write(png_data)
        print(f'Generated: {out_path} ({size}x{size}, {len(png_data)} bytes)')

    print('Done! All icons created in ./icons/')


if __name__ == '__main__':
    main()
