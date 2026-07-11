"""OSM tile-mosaic static map composer.

v160.3.0-adjust-16e — Self-composes a static map image from raw
OpenStreetMap tiles (`https://{a|b|c}.tile.openstreetmap.org/{z}/{x}/{y}.png`).
Yandex was swapped out because its labels are in Cyrillic; and the
public `staticmap.openstreetmap.de` service DNS doesn't resolve in our
infra.

Public API:
    compose_static_map(lat, lng, width=500, height=300, zoom=16) -> PIL.Image | None

Policy notes:
  * Rotates through a/b/c subdomains to spread load politely.
  * Sends a proper User-Agent per OSM tile usage policy.
  * Sequential fetches (no parallel bursts) per composed image.
  * Retries a failed tile once with a different subdomain.
  * Returns None on any unrecoverable failure — caller must fall back to
    text-only rendering.
"""
from __future__ import annotations
import io
import logging
import math
import urllib.request
from typing import Optional

from PIL import Image, ImageDraw

log = logging.getLogger(__name__)

TILE_SIZE = 256
SUBDOMAINS = ("a", "b", "c")
USER_AGENT = "PaneltecCivil/160.3.0 (support@paneltec.com.au)"
FETCH_TIMEOUT = 6


def _latlng_to_pixel(lat: float, lng: float, zoom: int) -> tuple[float, float]:
    """Convert (lat, lng) to global pixel coordinates at the given zoom.
    Standard slippy-map Mercator projection."""
    lat_rad = math.radians(lat)
    n = 2 ** zoom
    x = (lng + 180.0) / 360.0 * n * TILE_SIZE
    y = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n * TILE_SIZE
    return x, y


def _fetch_tile(z: int, x: int, y: int) -> Optional[Image.Image]:
    """Fetch a single OSM tile, retrying once on a different subdomain."""
    n = 2 ** z
    if x < 0 or x >= n or y < 0 or y >= n:
        return None  # Off-globe tiles → transparent (skipped).
    last_err = None
    for sd in (SUBDOMAINS[(x + y) % 3], SUBDOMAINS[(x + y + 1) % 3]):
        url = f"https://{sd}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
                data = r.read()
            if len(data) < 100:
                last_err = f"tile too small ({len(data)}B)"
                continue
            return Image.open(io.BytesIO(data)).convert("RGBA")
        except Exception as e:
            last_err = str(e)
    log.warning("OSM tile fetch failed z=%s x=%s y=%s: %s", z, x, y, last_err)
    return None


def _draw_pushpin(img: Image.Image, cx: int, cy: int) -> None:
    """Draw a small red teardrop pushpin marker centered at (cx, cy).
    The point of the pin is anchored to the coordinate; the round head
    sits above it."""
    draw = ImageDraw.Draw(img, "RGBA")
    # Shadow / outline (dark red)
    outline = (140, 20, 20, 255)
    fill = (220, 40, 40, 255)
    dot = (255, 255, 255, 255)
    # Teardrop: filled circle up top + triangle down to the point.
    r = 8
    head_cy = cy - 22  # head sits 22px above the anchor
    draw.ellipse(
        (cx - r, head_cy - r, cx + r, head_cy + r),
        fill=fill, outline=outline, width=2,
    )
    # Triangle from head bottom → anchor point.
    draw.polygon(
        [(cx - 5, head_cy + 4), (cx + 5, head_cy + 4), (cx, cy)],
        fill=fill, outline=outline,
    )
    draw.line((cx - 5, head_cy + 4, cx, cy), fill=outline, width=2)
    draw.line((cx + 5, head_cy + 4, cx, cy), fill=outline, width=2)
    # White dot in the head so the pin reads clearly on any basemap.
    draw.ellipse((cx - 2, head_cy - 2, cx + 2, head_cy + 2), fill=dot)


def compose_static_map(lat: float, lng: float,
                        width: int = 500, height: int = 300,
                        zoom: int = 16) -> Optional[Image.Image]:
    """Compose a `width × height` PNG static map centered on (lat, lng)
    at the given zoom. Returns a PIL Image (mode="RGB") or None if the
    map couldn't be assembled (all tile fetches failed)."""
    try:
        cx_px, cy_px = _latlng_to_pixel(float(lat), float(lng), int(zoom))
    except (TypeError, ValueError):
        return None

    # Bounding box in global pixel space.
    left = cx_px - width / 2
    top = cy_px - height / 2
    right = left + width
    bottom = top + height

    tx0 = int(math.floor(left / TILE_SIZE))
    ty0 = int(math.floor(top / TILE_SIZE))
    tx1 = int(math.floor((right - 1) / TILE_SIZE))
    ty1 = int(math.floor((bottom - 1) / TILE_SIZE))

    mosaic_w = (tx1 - tx0 + 1) * TILE_SIZE
    mosaic_h = (ty1 - ty0 + 1) * TILE_SIZE
    mosaic = Image.new("RGBA", (mosaic_w, mosaic_h), (240, 240, 240, 255))

    fetched = 0
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            tile = _fetch_tile(zoom, tx, ty)
            if tile is None:
                continue
            fetched += 1
            mosaic.paste(tile, ((tx - tx0) * TILE_SIZE, (ty - ty0) * TILE_SIZE), tile)

    if fetched == 0:
        return None  # Total failure — caller falls back to text-only.

    # Crop the mosaic to the exact requested size, centered on (lat, lng).
    crop_left = int(round(left - tx0 * TILE_SIZE))
    crop_top = int(round(top - ty0 * TILE_SIZE))
    crop = mosaic.crop((crop_left, crop_top, crop_left + width, crop_top + height))

    # Draw the pushpin at the geometric center.
    _draw_pushpin(crop, width // 2, height // 2)

    # OSM attribution ribbon (required by tile usage policy).
    draw = ImageDraw.Draw(crop, "RGBA")
    txt = "© OpenStreetMap contributors"
    # White semitransparent bar bottom-right
    tw = draw.textlength(txt) if hasattr(draw, "textlength") else 190
    draw.rectangle((width - tw - 8, height - 16, width, height), fill=(255, 255, 255, 200))
    draw.text((width - tw - 4, height - 14), txt, fill=(60, 60, 60, 255))

    return crop.convert("RGB")
