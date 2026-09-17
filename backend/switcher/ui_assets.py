"""Assets visuels : logo, emblèmes de rank, avatars, images générées (Pillow)."""
import math
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

from . import paths

# palette Hextech (partagée avec main.py)
BG = "#010a13"
PANEL = "#0a1428"
GOLD = "#c8aa6e"
GOLD_BRIGHT = "#f0e6d2"
GOLD_DIM = "#785a28"
HEX_BLUE = "#0ac8b9"

ICON_CACHE = paths.STORAGE_DIR / "icons"

_AVATAR_URL = ("https://raw.communitydragon.org/latest/game/assets/ux/"
               "summonericons/profileicon{id}.png")


def assets_dir() -> Path:
    """Dossier assets/ (compatible PyInstaller onefile via sys._MEIPASS)."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base / "assets"


# ------------------------------------------------------------------ logo

def _hexagon(cx: float, cy: float, r: float) -> list[tuple[float, float]]:
    return [(cx + r * math.sin(a), cy - r * math.cos(a))
            for a in (math.radians(60 * i) for i in range(6))]


def logo(size: int = 64) -> Image.Image:
    """Hexagone hextech doré + double flèche de cycle bleue (symbole du swap)."""
    big = 512
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = big / 2

    d.polygon(_hexagon(c, c, 244), fill=BG)
    for r, color, w in ((244, GOLD_DIM, 22), (236, GOLD, 14), (222, GOLD_BRIGHT, 5)):
        d.polygon(_hexagon(c, c, r), outline=color, width=w)

    # deux arcs formant un cycle, avec pointes de flèches
    box = (c - 120, c - 120, c + 120, c + 120)
    d.arc(box, start=205, end=335, fill=HEX_BLUE, width=30)
    d.arc(box, start=25, end=155, fill=HEX_BLUE, width=30)

    def arrow_head(angle_deg: float):
        a = math.radians(angle_deg)
        px, py = c + 120 * math.cos(a), c + 120 * math.sin(a)
        tx, ty = -math.sin(a), math.cos(a)   # tangente, sens de l'arc
        nx, ny = math.cos(a), math.sin(a)    # radiale
        length, width = 70, 36
        d.polygon([
            (px + tx * length, py + ty * length),
            (px + nx * width, py + ny * width),
            (px - nx * width, py - ny * width),
        ], fill=HEX_BLUE)

    arrow_head(335)
    arrow_head(155)

    return img.resize((size, size), Image.LANCZOS)


def write_ico() -> Path:
    """Génère l'icône .ico de la fenêtre (mise en cache)."""
    ICON_CACHE.mkdir(parents=True, exist_ok=True)
    ico = ICON_CACHE / "app.ico"
    if not ico.is_file():
        logo(256).save(ico, format="ICO",
                       sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])
    return ico


# ------------------------------------------------------------------ ranks

_rank_cache: dict[str, Image.Image] = {}


def rank_emblem(tier: str | None) -> Image.Image:
    """Emblème officiel du tier (assets/ranks), fallback badge dessiné."""
    key = (tier or "unranked").lower()
    if key in _rank_cache:
        return _rank_cache[key]
    path = assets_dir() / "ranks" / f"{key}.png"
    if path.is_file():
        img = Image.open(path).convert("RGBA")
    else:
        img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.polygon(_hexagon(64, 64, 56), outline=GOLD, width=6)
        d.text((64, 64), (tier or "?")[0], fill=GOLD, anchor="mm", font_size=52)
    _rank_cache[key] = img
    return img


# ------------------------------------------------------------------ avatars

_avatar_cache: dict[tuple, Image.Image] = {}


def avatar(icon_id: int | None, initial: str = "?", ring: str = GOLD_DIM,
           size: int = 96) -> Image.Image:
    """Avatar de profil circulaire avec anneau coloré ; fallback lettre dorée."""
    key = (icon_id, initial, ring)
    if key in _avatar_cache:
        return _avatar_cache[key]

    base = None
    if icon_id is not None:
        ICON_CACHE.mkdir(parents=True, exist_ok=True)
        cached = ICON_CACHE / f"profileicon{icon_id}.png"
        if not cached.is_file():
            try:
                req = urllib.request.Request(_AVATAR_URL.format(id=icon_id),
                                             headers={"User-Agent": "lol-switcher"})
                cached.write_bytes(urllib.request.urlopen(req, timeout=10).read())
            except OSError:
                pass
        if cached.is_file():
            try:
                base = Image.open(cached).convert("RGBA").resize((size, size), Image.LANCZOS)
            except OSError:
                base = None
    if base is None:
        base = Image.new("RGBA", (size, size), PANEL)
        d = ImageDraw.Draw(base)
        d.text((size / 2, size / 2), (initial or "?")[0].upper(),
               fill=GOLD, anchor="mm", font_size=int(size * 0.46))

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    d = ImageDraw.Draw(out)
    d.ellipse((1, 1, size - 2, size - 2), outline=ring, width=max(3, size // 24))
    _avatar_cache[key] = out
    return out


# ------------------------------------------------------------------ décor

def header_banner(width: int = 1920, height: int = 104) -> Image.Image:
    """Bandeau de header : dégradé bleu nuit + diagonales dorées + hexagones."""
    img = Image.new("RGBA", (width, height))
    d = ImageDraw.Draw(img)
    top = (12, 31, 58)      # #0c1f3a
    bottom = (1, 10, 19)    # #010a13
    for y in range(height):
        t = y / max(1, height - 1)
        d.line([(0, y), (width, y)],
               fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    for x in range(-height, width, 46):
        d.line([(x, height), (x + height, 0)], fill=(200, 170, 110, 14), width=1)
    for cx, r in ((width * 0.72, 64), (width * 0.80, 40), (width * 0.88, 84),
                  (width * 0.62, 30), (width * 0.95, 52)):
        d.polygon(_hexagon(cx, height * 0.5, r), outline=(200, 170, 110, 26), width=2)
    # liseré doré dégradé en bas
    for x in range(width):
        a = int(190 * math.sin(math.pi * x / width))
        d.point((x, height - 1), fill=(200, 170, 110, a))
        d.point((x, height - 2), fill=(200, 170, 110, a // 2))
    return img
