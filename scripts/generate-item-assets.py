from __future__ import annotations

import math
import random
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 1024
FINAL = 512
ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = [ROOT / "web/public/items", ROOT / "server/static/items"]
BASE = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = hex_color.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


def mix(a: str, b: str, t: float, alpha: int = 255) -> tuple[int, int, int, int]:
    ca, cb = rgba(a), rgba(b)
    return tuple(round(ca[i] * (1 - t) + cb[i] * t) for i in range(3)) + (alpha,)


def gradient(size: tuple[int, int], top: str, bottom: str, left: str | None = None, right: str | None = None) -> Image.Image:
    """Create a softly diagonal color field used inside silhouettes."""
    w, h = size
    px = Image.new("RGBA", size)
    draw = ImageDraw.Draw(px)
    for y in range(h):
        t = y / max(1, h - 1)
        for x in range(0, w, 8):
            u = x / max(1, w - 1)
            base = mix(top, bottom, t)
            if left and right:
                edge = mix(left, right, u)
                base = tuple(round(base[i] * 0.72 + edge[i] * 0.28) for i in range(3)) + (255,)
            draw.rectangle((x, y, min(w - 1, x + 7), y), fill=base)
    return px


def shape_mask(points: list[tuple[int, int]]) -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


def clipped_gradient(points: list[tuple[int, int]], top: str, bottom: str, left: str, right: str) -> Image.Image:
    mask = shape_mask(points)
    fill = gradient((SIZE, SIZE), top, bottom, left, right)
    fill.putalpha(mask)
    return fill


def add_drop_shadow(canvas: Image.Image, mask: Image.Image, color: str = "#18333a", offset=(18, 28), blur=26, opacity=96) -> Image.Image:
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow.paste(rgba(color, opacity), (offset[0], offset[1]), mask.filter(ImageFilter.GaussianBlur(8)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    return Image.alpha_composite(shadow, canvas)


def add_watercolor_texture(canvas: Image.Image, mask: Image.Image, tone: str, seed: int, density=240) -> Image.Image:
    rng = random.Random(seed)
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for _ in range(density):
        x, y = rng.randrange(SIZE), rng.randrange(SIZE)
        radius = rng.randint(2, 13)
        alpha = rng.randint(5, 22)
        color = rgba(tone, alpha) if rng.random() < 0.45 else (255, 255, 255, alpha)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(2.2))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return Image.alpha_composite(canvas, layer)


def glow_layer(mask: Image.Image, color: str, opacity=110, expand=32, blur=28) -> Image.Image:
    glow_mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(expand))
    layer = Image.new("RGBA", (SIZE, SIZE), rgba(color, opacity))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), glow_mask))
    return layer


def line_with_glow(canvas: Image.Image, points: list[tuple[int, int]], color: str, width: int, glow_width: int, alpha=230) -> Image.Image:
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(glow).line(points, fill=rgba(color, 105), width=glow_width, joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(12))
    canvas = Image.alpha_composite(canvas, glow)
    draw = ImageDraw.Draw(canvas)
    draw.line(points, fill=rgba(color, 92), width=max(2, width + 10), joint="curve")
    draw.line(points, fill=rgba(color, alpha), width=width, joint="curve")
    return canvas


def sparkle(draw: ImageDraw.ImageDraw, x: int, y: int, radius: int, color: str, alpha=235):
    points = [(x, y - radius), (x + radius * 0.22, y - radius * 0.22), (x + radius, y),
              (x + radius * 0.22, y + radius * 0.22), (x, y + radius),
              (x - radius * 0.22, y + radius * 0.22), (x - radius, y),
              (x - radius * 0.22, y - radius * 0.22)]
    draw.polygon(points, fill=rgba(color, alpha))


def draw_crystal(canvas: Image.Image, points, top, bottom, left, right, outline, facets, bright, glow, seed, rune=None) -> tuple[Image.Image, Image.Image]:
    mask = shape_mask(points)
    canvas = Image.alpha_composite(canvas, clipped_gradient(points, top, bottom, left, right))
    draw = ImageDraw.Draw(canvas)
    draw.line(points + [points[0]], fill=rgba(outline, 225), width=10, joint="curve")

    facet_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    fdraw = ImageDraw.Draw(facet_layer)
    for poly, color, alpha in facets:
        fdraw.polygon(poly, fill=rgba(color, alpha))
    facet_layer.putalpha(ImageChops.multiply(facet_layer.getchannel("A"), mask))
    canvas = Image.alpha_composite(canvas, facet_layer)
    draw = ImageDraw.Draw(canvas)
    for poly, _, _ in facets:
        fdraw = ImageDraw.Draw(canvas)
        fdraw.line(poly + [poly[0]], fill=(255, 255, 255, 42), width=3, joint="curve")

    # Crisp wet-edge watercolor lines along the illuminated side.
    highlights = [
        (points[0], points[1]),
        (points[1], points[2]),
        (points[2], points[3]),
    ]
    for idx, (a, b) in enumerate(highlights):
        draw.line([a, b], fill=rgba(bright, 170 - idx * 28), width=11 - idx * 2)
    canvas = add_watercolor_texture(canvas, mask, bright, seed, 150)

    if rune:
        rune_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        rdraw = ImageDraw.Draw(rune_layer)
        rune(rdraw)
        rune_layer.putalpha(ImageChops.multiply(rune_layer.getchannel("A"), mask))
        canvas = Image.alpha_composite(canvas, rune_layer)
        draw = ImageDraw.Draw(canvas)

    return canvas, mask


def crystal_asset(filename: str, palette: dict, seed: int):
    rng = random.Random(seed)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    all_mask = Image.new("L", (SIZE, SIZE), 0)

    shards = [
        ([(476, 798), (432, 687), (404, 526), (456, 422), (503, 245), (547, 438), (584, 636), (566, 805)],
         [([(503, 245), (547, 438), (584, 636), (566, 805), (520, 792), (520, 428)],
           palette["light"], 178),
          ([(503, 245), (456, 422), (404, 526), (432, 687), (476, 798), (520, 792), (520, 428)],
           palette["deep"], 132),
          ([(520, 428), (547, 438), (584, 636), (566, 805), (520, 792)], palette["mid"], 142),
          ([(455, 622), (506, 583), (575, 668), (530, 721)], palette["accent"], 90)]),
        ([(394, 779), (352, 680), (302, 556), (312, 452), (379, 538), (432, 668)],
         [([(312, 452), (379, 538), (432, 668), (394, 779), (352, 680), (302, 556)], palette["deep"], 165),
          ([(379, 538), (432, 668), (394, 779), (383, 685)], palette["light"], 138)]),
        ([(569, 740), (603, 589), (662, 431), (710, 354), (719, 510), (679, 671), (605, 790)],
         [([(662, 431), (710, 354), (719, 510), (679, 671), (605, 790), (603, 589)], palette["light"], 145),
          ([(603, 589), (662, 431), (679, 671), (605, 790)], palette["mid"], 126)]),
        ([(291, 782), (270, 707), (240, 631), (281, 630), (335, 713), (351, 795)],
         [([(281, 630), (335, 713), (351, 795), (291, 782), (270, 707), (240, 631)], palette["mid"], 170)]),
        ([(690, 760), (720, 672), (779, 605), (800, 649), (771, 729), (730, 792)],
         [([(779, 605), (800, 649), (771, 729), (730, 792), (690, 760), (720, 672)], palette["deep"], 140)]),
    ]

    for points, facets in shards:
        all_mask = ImageChops.lighter(all_mask, shape_mask(points))

    canvas = Image.alpha_composite(glow_layer(all_mask, palette["glow"], 76, 34, 34), canvas)
    canvas = add_drop_shadow(canvas, all_mask, palette["shadow"], (0, 22), 27, 105)

    # Back shards first for a believable cluster silhouette.
    order = [3, 4, 1, 2, 0]
    masks = []
    for index in order:
        points, facets = shards[index]
        rune = palette["rune"] if index == 0 else None
        canvas, mask = draw_crystal(
            canvas, points, palette["top"], palette["bottom"], palette["left"], palette["right"],
            palette["outline"], facets, palette["accent"], palette["glow"], seed + index, rune
        )
        masks.append(mask)

    draw = ImageDraw.Draw(canvas)
    for _ in range(8):
        x = rng.randint(280, 740)
        y = rng.randint(285, 700)
        sparkle(draw, x, y, rng.randint(8, 20), palette["accent"], rng.randint(105, 190))

    # Tiny orbiting dust reinforces each rarity without changing the item silhouette.
    for _ in range(18):
        x = rng.randint(250, 770)
        y = rng.randint(260, 735)
        r = rng.randint(3, 7)
        draw.ellipse((x-r, y-r, x+r, y+r), fill=rgba(palette["accent"], rng.randint(65, 150)))

    return canvas


def furnace_rune(draw: ImageDraw.ImageDraw):
    pass


def furnace_asset():
    rng = random.Random(2401)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    chunks = [
        ([(333, 339), (482, 279), (639, 334), (726, 494), (681, 686), (535, 793), (357, 742), (266, 571)],
         [([(333, 339), (482, 279), (639, 334), (574, 415), (420, 398)], "#626970", 150),
          ([(266, 571), (333, 339), (420, 398), (452, 585), (357, 742)], "#2e3842", 175),
          ([(639, 334), (726, 494), (681, 686), (535, 793), (580, 577), (574, 415)], "#1e2934", 166),
          ([(420, 398), (574, 415), (580, 577), (452, 585)], "#414b55", 158)]),
        ([(635, 436), (748, 387), (835, 456), (845, 590), (770, 680), (670, 651), (614, 559)],
         [([(748, 387), (835, 456), (845, 590), (770, 680), (720, 557)], "#26323e", 175),
          ([(635, 436), (748, 387), (720, 557), (670, 651), (614, 559)], "#404a52", 155),
          ([(720, 557), (814, 518), (845, 590), (770, 680), (670, 651)], "#17232f", 130)]),
        ([(265, 649), (348, 586), (444, 623), (474, 748), (403, 817), (293, 783), (235, 721)],
         [([(348, 586), (444, 623), (474, 748), (403, 817), (362, 723)], "#303a43", 180),
          ([(265, 649), (348, 586), (362, 723), (403, 817), (293, 783), (235, 721)], "#202b35", 150),
          ([(362, 723), (430, 685), (474, 748), (403, 817)], "#59606a", 100)]),
    ]

    all_mask = Image.new("L", (SIZE, SIZE), 0)
    for points, _ in chunks:
        all_mask = ImageChops.lighter(all_mask, shape_mask(points))
    canvas = Image.alpha_composite(glow_layer(all_mask, "#f06f21", 66, 42, 38), canvas)
    canvas = add_drop_shadow(canvas, all_mask, "#162632", (0, 21), 30, 130)

    for index, (points, facets) in enumerate(chunks):
        mask = shape_mask(points)
        canvas = Image.alpha_composite(canvas, clipped_gradient(points, "#35404a", "#17232d", "#4f5962", "#202b35"))
        draw = ImageDraw.Draw(canvas)
        draw.line(points + [points[0]], fill=rgba("#101a23", 235), width=11, joint="curve")
        facet_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        fdraw = ImageDraw.Draw(facet_layer)
        for poly, color, alpha in facets:
            fdraw.polygon(poly, fill=rgba(color, alpha))
        facet_layer.putalpha(ImageChops.multiply(facet_layer.getchannel("A"), mask))
        canvas = Image.alpha_composite(canvas, facet_layer)
        canvas = add_watercolor_texture(canvas, mask, "#f1a04a" if index == 0 else "#a9c0c8", 670 + index, 170)

    # Molten fissures, drawn both as blurred heat and crisp hot cores.
    cracks = [
        [(387, 678), (444, 608), (421, 545), (486, 490), (467, 414)],
        [(444, 608), (526, 628), (571, 579), (630, 604)],
        [(701, 505), (749, 556), (726, 612), (776, 650)],
        [(321, 688), (353, 740), (337, 786)],
    ]
    for idx, crack in enumerate(cracks):
        canvas = line_with_glow(canvas, crack, "#ff6b19" if idx < 2 else "#f39b36", 9, 32, 245)
    draw = ImageDraw.Draw(canvas)
    # Cool steel-blue edge chips keep the carbon from reading as pure lava.
    for _ in range(14):
        x, y = rng.randint(290, 760), rng.randint(320, 740)
        radius = rng.randint(6, 18)
        draw.polygon([(x, y-radius), (x+radius, y+3), (x+5, y+radius), (x-radius, y+8)], fill=rgba("#87939d", rng.randint(50, 115)))
    for _ in range(24):
        x, y = rng.randint(270, 790), rng.randint(300, 790)
        r = rng.randint(3, 8)
        draw.ellipse((x-r, y-r, x+r, y+r), fill=rgba("#ff9a35", rng.randint(80, 190)))
    for x, y, r in [(308, 420, 17), (718, 347, 13), (773, 690, 16), (505, 260, 10)]:
        sparkle(draw, x, y, r, "#ffb34f", 190)
    return canvas


def legendary_rune(draw: ImageDraw.ImageDraw):
    cx, cy = 502, 586
    points = [(cx, cy-74), (cx+20, cy-20), (cx+74, cy), (cx+20, cy+20),
              (cx, cy+74), (cx-20, cy+20), (cx-74, cy), (cx-20, cy-20)]
    draw.polygon(points, fill=rgba("#ffd86a", 180), outline=rgba("#fff2b4", 220), width=5)
    draw.ellipse((cx-27, cy-27, cx+27, cy+27), outline=rgba("#8c431d", 180), width=7)


def mythic_rune(draw: ImageDraw.ImageDraw):
    cx, cy = 501, 575
    draw.ellipse((cx-60, cy-60, cx+60, cy+60), outline=rgba("#ffb8f2", 190), width=8)
    draw.arc((cx-39, cy-39, cx+39, cy+39), 42, 315, fill=rgba("#66205f", 220), width=9)
    draw.ellipse((cx-23, cy-23, cx+23, cy+23), outline=rgba("#ffe1fb", 220), width=5)
    for angle in (0, 90, 180, 270):
        rad = math.radians(angle)
        x1, y1 = cx + math.cos(rad) * 71, cy + math.sin(rad) * 71
        x2, y2 = cx + math.cos(rad) * 92, cy + math.sin(rad) * 92
        draw.line((x1, y1, x2, y2), fill=rgba("#ffd2f7", 175), width=6)


def exotic_rune(draw: ImageDraw.ImageDraw):
    cx, cy = 502, 568
    draw.polygon([(cx, cy-82), (cx+47, cy), (cx, cy+82), (cx-47, cy)], outline=rgba("#d5fff5", 210), width=8)
    draw.arc((cx-58, cy-58, cx+58, cy+58), 28, 332, fill=rgba("#087c7b", 195), width=10)
    draw.ellipse((cx-24, cy-24, cx+24, cy+24), outline=rgba("#f0fffb", 220), width=6)
    for dx, dy in [(-77, 0), (77, 0), (0, -77), (0, 77)]:
        draw.ellipse((cx+dx-7, cy+dy-7, cx+dx+7, cy+dy+7), fill=rgba("#aaffea", 200))


PALETTES = {
    "legendary": dict(
        top="#ffe091", bottom="#cf5b1f", left="#ff9d35", right="#a63d16", outline="#633619",
        light="#ffdf72", mid="#f08a2f", deep="#a94421", accent="#fff3be", glow="#ffae34", shadow="#6b2c17",
        rune=legendary_rune,
    ),
    "mythic": dict(
        top="#ffb7ee", bottom="#6c247f", left="#d55ad0", right="#6e1a6d", outline="#42113f",
        light="#f49ae1", mid="#b940b5", deep="#731b86", accent="#ffe0fc", glow="#ee56d6", shadow="#481243",
        rune=mythic_rune,
    ),
    "exotic": dict(
        top="#c2fff0", bottom="#08767c", left="#4cddc8", right="#075b6a", outline="#073f4a",
        light="#8df5d9", mid="#24b5a9", deep="#08757e", accent="#edfffa", glow="#29e4ce", shadow="#063f4b",
        rune=exotic_rune,
    ),
}


def save_asset(image: Image.Image, filename: str):
    final = image.resize((FINAL, FINAL), Image.Resampling.LANCZOS)
    for folder in OUTPUTS:
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / filename
        final.save(path, "WEBP", quality=94, method=6, lossless=False)
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


save_asset(furnace_asset(), "furnace-carbon.webp")
save_asset(crystal_asset("legendary-gear-crystal.webp", PALETTES["legendary"], 1103), "legendary-gear-crystal.webp")
save_asset(crystal_asset("mythic-gear-crystal.webp", PALETTES["mythic"], 2207), "mythic-gear-crystal.webp")
save_asset(crystal_asset("exotic-gear-crystal.webp", PALETTES["exotic"], 3301), "exotic-gear-crystal.webp")
