"""Generate the animated README assets (carousel GIF + SVG banners).

Usage (from repo root):  python scripts/generate_readme_assets.py
Requires: Pillow
"""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LIVE_SHOTS = ROOT / "screenshots" / "live"
SHOTS = ROOT / "screenshots"
OUT = ROOT / "assets" / "readme"

SCREENS = [
    ("04-home.png", "Touch-first home dashboard"),
    ("05-folder.png", "Organized folders & 2-way sync"),
    ("06-photos.png", "Vibrant photo gallery grid"),
    ("07-videos.png", "4K video streaming & offline cache"),
    ("08-documents.png", "TDENC2 encrypted document vault"),
    ("09-settings.png", "Storage telemetry & bandwidth limits"),
    ("11-light-home.png", "Pristine frosted light theme"),
    ("01-tour-cloud.png", "Interactive onboarding tour"),
]

W, H = 1100, 700
PW, PH = 250, 540  # center phone size
BG_TOP, BG_BOT = (11, 18, 32), (18, 27, 46)
CYAN = (79, 195, 247)


def font(size, bold=False):
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def background():
    bg = Image.new("RGB", (W, H))
    px = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        px.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W // 2 - 380, 60, W // 2 + 380, 620], fill=(0, 70, 95))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    from PIL import ImageChops
    bg = ImageChops.add(bg, glow)
    d = ImageDraw.Draw(bg)
    for gx in range(16, W, 32):
        for gy in range(16, H, 32):
            d.point((gx, gy), fill=(30, 52, 78))
    return bg


def phone(path):
    file_path = LIVE_SHOTS / path if (LIVE_SHOTS / path).exists() else (SHOTS / path)
    img = Image.open(file_path).convert("RGB")
    # cover-crop to the phone aspect ratio
    ratio = PW / PH
    w, h = img.size
    if w / h > ratio:
        nw = int(h * ratio)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / ratio)
        img = img.crop((0, 0, w, nh))
    scale = 3
    img = img.resize((PW * scale, PH * scale), Image.LANCZOS)
    r = 44 * scale
    pad = 7 * scale
    body = Image.new("RGBA", (PW * scale + pad * 2, PH * scale + pad * 2), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.rounded_rectangle([0, 0, body.width - 1, body.height - 1], r + pad, fill=(52, 66, 88, 255))
    bd.rounded_rectangle([2 * scale, 2 * scale, body.width - 2 * scale, body.height - 2 * scale], r + pad - 2 * scale, fill=(8, 12, 20, 255))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], r, fill=255)
    body.paste(img, (pad, pad), mask)
    return body


def render():
    bg = background()
    base_phones = [phone(p) for p, _ in SCREENS]
    n = len(SCREENS)
    title_f, sub_f = font(30, True), font(17)
    spacing = 300

    def frame(t):
        im = bg.copy().convert("RGBA")
        items = []
        for i in range(n):
            d = (i - t + n / 2) % n - n / 2  # signed distance to the center
            if abs(d) > 2.4:
                continue
            items.append((abs(d), d, i))
        for _, d, i in sorted(items, reverse=True):
            s = 1 - 0.2 * min(abs(d), 1.4)
            ph = base_phones[i]
            tw = int(PW * s) + 14
            th = int((ph.height / ph.width) * tw)
            p = ph.resize((tw, th), Image.LANCZOS)
            dim = min(abs(d), 1.5) / 1.5
            alpha = max(0.0, 1 - max(0, abs(d) - 1.6) / 0.8)
            pa = p.split()[3]
            rgb = Image.blend(p.convert("RGB"), Image.new("RGB", p.size, (11, 18, 32)), 0.6 * dim)
            p = rgb.convert("RGBA")
            p.putalpha(pa)
            if alpha < 1:
                a = p.split()[3].point(lambda v: int(v * alpha))
                p.putalpha(a)
            x = int(W / 2 + d * spacing * (1 - 0.06 * abs(d)) - tw / 2)
            y = int(H / 2 - 30 - th / 2)
            # soft shadow for the active phone
            if abs(d) < 0.6:
                sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
                ImageDraw.Draw(sh).rounded_rectangle([x, y + 20, x + tw, y + th + 20], 50, fill=(0, 188, 212, int(60 * (1 - abs(d) / 0.6))))
                im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(28)))
            im.alpha_composite(p, (x, y))
        # caption crossfades with distance to the nearest slot
        near = round(t) % n
        off = abs(t - round(t))
        a = max(0.0, 1 - off * 2.2)
        cap = Image.new("RGBA", im.size, (0, 0, 0, 0))
        cd = ImageDraw.Draw(cap)
        text = SCREENS[near][1]
        tw_ = cd.textlength(text, font=title_f)
        cd.text(((W - tw_) / 2, H - 78), text, font=title_f, fill=(230, 244, 255, int(255 * a)))
        # progress dots
        for k in range(n):
            cx = W / 2 + (k - (n - 1) / 2) * 22
            on = k == near
            col = (251, 191, 36, 255) if on else (70, 90, 120, 255)
            cd.rounded_rectangle([cx - (11 if on else 4), H - 26, cx + (11 if on else 4), H - 18], 4, fill=col)
        return Image.alpha_composite(im, cap).convert("RGB")

    frames, durations = [], []
    steps = 10
    for k in range(n):
        frames.append(frame(k))
        durations.append(1700)
        for s in range(1, steps):
            u = s / steps
            e = u * u * (3 - 2 * u)  # smoothstep
            frames.append(frame(k + e))
            durations.append(45)
    pal = frames[0].quantize(colors=128, method=Image.MEDIANCUT, dither=Image.NONE)
    q = [f.quantize(palette=pal, dither=Image.NONE) for f in frames]
    OUT.mkdir(parents=True, exist_ok=True)
    q[0].save(OUT / "showcase.gif", save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)
    print("wrote showcase.gif", (OUT / "showcase.gif").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    render()
