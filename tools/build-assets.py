"""生成缩略图、卡片底色和以图搜索用的特征。

在仓库根目录运行：python tools/build-assets.py
"""

import json
import os
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "glyphs.json"
IMAGES = ROOT / "images"
THUMBS = ROOT / "thumbs"
INDEX = ROOT / "data" / "similar.bin"

THUMB = 256
SIZE = 16  # 特征图的边长，与 similar.js 一致
ALPHA_CUT = 32  # 透明度高于这个值才算图案


def thumb(src: Path, out: Path) -> None:
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        return
    im = Image.open(src)
    im = im.convert("RGBA") if "A" in im.getbands() or im.mode == "P" else im.convert("RGB")
    im.thumbnail((THUMB, THUMB), Image.LANCZOS)
    im.save(out, "WEBP", quality=82, method=4)


def opaque(im: Image.Image) -> bool:
    return "A" not in im.getbands() or im.getchannel("A").getextrema()[0] >= 250


def plate(im: Image.Image) -> str | None:
    """透明图案的明暗决定卡片底色：浅色图案配深底，深色图案配浅底。"""
    if opaque(im):
        return "full"
    rgba = im.convert("RGBA")
    mask = rgba.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    gray = rgba.convert("L")
    hist = gray.histogram(mask)
    total = sum(hist)
    if not total:
        return None
    mean = sum(i * n for i, n in enumerate(hist)) / total
    if mean > 170:
        return "dark"
    if mean < 85:
        return "light"
    return None


def tint(im: Image.Image) -> str:
    """图案的主色：按透明度和饱和度加权取平均，越鲜艳的像素占比越大。"""
    small = im.convert("RGBA").resize((48, 48), Image.BOX)
    rgba = small.tobytes()
    sats = small.convert("RGB").convert("HSV").getchannel("S").tobytes()
    total = [0.0, 0.0, 0.0]
    weight = 0.0
    for i, sat in enumerate(sats):
        r, g, b, a = rgba[i * 4 : i * 4 + 4]
        w = (a / 255) * (0.15 + sat / 255)
        total[0] += r * w
        total[1] += g * w
        total[2] += b * w
        weight += w
    if not weight:
        return "#808080"
    return "#" + "".join(f"{round(c / weight):02x}" for c in total)


def feature(im: Image.Image) -> bytes:
    """图案裁到外框、补成正方形后缩成 SIZE×SIZE，存预乘透明度的 RGBA。"""
    if opaque(im):
        return im.convert("RGB").resize((SIZE, SIZE), Image.BOX).convert("RGBA").tobytes()
    rgba = im.convert("RGBA")
    box = rgba.getchannel("A").point(lambda v: 255 if v > ALPHA_CUT else 0).getbbox() or (0, 0, *rgba.size)
    art = rgba.crop(box)
    side = max(art.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
    return square.convert("RGBa").resize((SIZE, SIZE), Image.BOX).tobytes()


def main() -> None:
    data = json.loads(DATA.read_text(encoding="utf8"))
    THUMBS.mkdir(exist_ok=True)
    chunks = []
    for g in data["glyphs"]:
        src = IMAGES / f"{g['id']}.webp"
        thumb(src, THUMBS / src.name)
        im = Image.open(src)
        im.load()
        tone = plate(im)
        if tone:
            g["plate"] = tone
        else:
            g.pop("plate", None)
        g["tint"] = tint(im)
        chunks.append(feature(im))
    INDEX.write_bytes(struct.pack("<4sHH", b"GLYF", SIZE, len(chunks)) + b"".join(chunks))
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf8", newline="\n")
    print(f"{len(chunks)} glyphs, index {os.path.getsize(INDEX) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
