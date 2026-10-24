"""Generate the static website's image assets from the live app screenshots.

Usage (from repo root):  python scripts/generate_website_assets.py
Requires: Pillow

Inputs
  screenshots/live/*.png      fresh captures produced by capture-readme-screenshots.mjs
  app/public/logo.svg         application logo (copied verbatim)

Outputs
  website/assets/screens/<name>-sm.webp   412 px wide  (1x phone viewport)
  website/assets/screens/<name>-lg.webp   824 px wide  (2x / retina)
  website/assets/og.png                   1200x630 social preview card
  website/assets/logo.svg                 logo copy
"""
from pathlib import Path
import shutil

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LIVE = ROOT / "screenshots" / "live"
SITE = ROOT / "website"
SHOTS = SITE / "assets" / "screens"
OG = SITE / "assets" / "og.png"

SM_WIDTH = 412
LG_WIDTH = 824
QUALITY = 78


def font(size, bold=False):
    candidates = ["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def convert_screens():
    SHOTS.mkdir(parents=True, exist_ok=True)
    written = []
    for source in sorted(LIVE.glob("*.png")):
        img = Image.open(source).convert("RGB")
        for suffix, width in (("sm", SM_WIDTH), ("lg", LG_WIDTH)):
            height = round(img.height * width / img.width)
            resized = img.resize((width, height), Image.LANCZOS)
            target = SHOTS / f"{source.stem}-{suffix}.webp"
            resized.save(target, "WEBP", quality=QUALITY, method=6)
            written.append(target)
    return written


def gradient(size, top=(6, 12, 24), bottom=(11, 26, 45)):
    img = Image.new("RGB", size)
    draw = ImageDraw.Draw(img)
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        draw.line([(0, y), (size[0], y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def social_card():
    W, H = 1200, 630
    card = gradient((W, H)).convert("RGBA")

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-140, 120, 560, 760], fill=(24, 138, 190, 90))
    gd.ellipse([700, -220, 1380, 420], fill=(32, 200, 176, 55))
    card = Image.alpha_composite(card, glow.filter(ImageFilter.GaussianBlur(150)))

    phone_src = Image.open(LIVE / "05-home.png").convert("RGB")
    phone_h = 470
    phone_w = round(phone_src.width * phone_h / phone_src.height)
    phone = phone_src.resize((phone_w, phone_h), Image.LANCZOS)
    mask = Image.new("L", phone.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, phone_w - 1, phone_h - 1], 30, fill=255)
    frame = Image.new("RGBA", (phone_w + 14, phone_h + 14), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, frame.width - 1, frame.height - 1], 36, fill=(126, 190, 226, 130))
    frame.paste(phone, (7, 7), mask)
    card.alpha_composite(frame, (W - phone_w - 90, (H - phone_h) // 2 + 10))

    draw = ImageDraw.Draw(card)
    logo = Image.open(ROOT / "app" / "public" / "logo.png").convert("RGBA")
    logo = logo.resize((64, 64), Image.LANCZOS)
    card.alpha_composite(logo, (80, 84))

    draw.text((160, 96), "Shelf Drive", font=font(34, True), fill=(236, 246, 255, 255))
    draw.text((160, 138), "for Android", font=font(22), fill=(120, 200, 232, 255))

    draw.text((80, 208), "Your Telegram files,", font=font(56, True), fill=(240, 249, 255, 255))
    draw.text((80, 272), "organized on your phone.", font=font(56, True), fill=(96, 205, 244, 255))

    body = font(24)
    lines = [
        "Open-source, local-first file workspace powered",
        "by your own Telegram account. No relay servers.",
    ]
    for i, line in enumerate(lines):
        draw.text((80, 366 + i * 34), line, font=body, fill=(168, 190, 212, 255))

    chips = ["Android 12–16", "Google TV", "24 languages", "15 themes"]
    x = 80
    for chip in chips:
        label_font = font(20)
        width = draw.textlength(chip, font=label_font)
        draw.rounded_rectangle([x, 462, x + width + 32, 506], 22, fill=(18, 38, 58, 220), outline=(70, 130, 170, 180))
        draw.text((x + 16, 472), chip, font=label_font, fill=(190, 214, 234, 255))
        x += width + 48

    draw.text((80, 552), "github.com/hellocloudwebdev/shelf-drive-mobile", font=font(20), fill=(110, 150, 185, 255))

    OG.parent.mkdir(parents=True, exist_ok=True)
    card.convert("RGB").save(OG, "PNG", optimize=True)
    return OG


def copy_logo():
    target = SITE / "assets" / "logo.svg"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "app" / "public" / "logo.svg", target)
    return target


if __name__ == "__main__":
    shots = convert_screens()
    print(f"wrote {len(shots)} webp files to {SHOTS}")
    print("wrote", social_card().relative_to(ROOT))
    print("wrote", copy_logo().relative_to(ROOT))
