"""Generate the Onboarding Tour Feature Video (MP4) and animated GIF.

Usage: python scripts/generate_tour_video.py
Outputs:
  assets/readme/tour-feature.mp4
  assets/readme/tour-feature.gif
"""
from pathlib import Path
import math
import shutil
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent.parent
LIVE_SHOTS = ROOT / "screenshots" / "live"
OUT = ROOT / "assets" / "readme"

W, H = 1200, 676  # 16:9 even standard aspect ratio
BG_TOP, BG_BOT = (10, 16, 28), (17, 26, 44)
CYAN = (56, 189, 248)
EMERALD = (52, 211, 153)
AMBER = (251, 191, 36)

TOUR_STAGES = [
    {
        "shot": "02-tour-cloud.png",
        "tag": "STEP 1 OF 3 · CLOUD STORAGE",
        "tag_color": CYAN,
        "title": "Telegram becomes your cloud",
        "body": "Saved Messages becomes your personal drive. Direct MTProto connection — zero relay servers.",
        "badge": "DIRECT MTPROTO",
    },
    {
        "shot": "03-tour-private.png",
        "tag": "STEP 2 OF 3 · PRIVATE CHANNELS",
        "tag_color": EMERALD,
        "title": "Private folders, built in",
        "body": "Every folder is backed by a private Telegram channel. Organization survives app reinstalls.",
        "badge": "CHANNEL BACKED",
    },
    {
        "shot": "04-tour-ready.png",
        "tag": "STEP 3 OF 3 · UNIFIED WORKSPACE",
        "tag_color": AMBER,
        "title": "Everything in one place",
        "body": "Photos, videos, audio, documents, and TDENC2 encrypted vault files organized cleanly.",
        "badge": "INSTANT ACCESS",
    },
    {
        "shot": "18-light-tour.png",
        "tag": "ADAPTIVE THEMES · SYSTEM SYNC",
        "tag_color": (192, 132, 252),
        "title": "Light & dark liquid glass",
        "body": "15 curated palettes with automatic system dark/light sync and strict 4.5:1 WCAG contrast.",
        "badge": "15 THEMES",
    },
    {
        "shot": "05-home.png",
        "alt_shot": "15-light-home.png",
        "tag": "EXPLORE · YOUR DIGITAL SHELF",
        "tag_color": CYAN,
        "title": "Ready to explore",
        "body": "Touch-first bottom navigation, offline caches, background transfers and TV spatial navigation.",
        "badge": "ANDROID 12–16",
    },
]

def get_font(size: int, bold: bool = False):
    names = ["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()

def render_background():
    bg = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        r = int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    
    # Nebula glow
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse([W // 2 - 450, 40, W // 2 + 450, H - 40], fill=(0, 65, 95))
    glow = glow.filter(ImageFilter.GaussianBlur(130))
    bg = ImageChops.add(bg, glow)
    
    # Subtle dot grid
    pdraw = ImageDraw.Draw(bg)
    for gx in range(20, W, 36):
        for gy in range(20, H, 36):
            pdraw.point((gx, gy), fill=(30, 48, 72))
            
    return bg

def make_phone_mockup(img_path: Path, pw: int = 250, ph: int = 540):
    img = Image.open(img_path).convert("RGB")
    ratio = pw / ph
    w, h = img.size
    if w / h > ratio:
        nw = int(h * ratio)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / ratio)
        img = img.crop((0, 0, w, nh))
    
    scale = 3
    img = img.resize((pw * scale, ph * scale), Image.LANCZOS)
    r = 38 * scale
    pad = 7 * scale
    body = Image.new("RGBA", (pw * scale + pad * 2, ph * scale + pad * 2), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    # Bezel
    bd.rounded_rectangle([0, 0, body.width - 1, body.height - 1], r + pad, fill=(58, 72, 96, 255))
    bd.rounded_rectangle([2 * scale, 2 * scale, body.width - 2 * scale, body.height - 2 * scale], r + pad - 2 * scale, fill=(10, 14, 22, 255))
    # Screen mask
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], r, fill=255)
    body.paste(img, (pad, pad), mask)
    
    # Resize down with antialiasing
    final_w, final_h = pw + (pad * 2) // scale, ph + (pad * 2) // scale
    return body.resize((final_w, final_h), Image.LANCZOS)

def generate():
    print("Preparing assets for tour video...")
    bg = render_background()
    OUT.mkdir(parents=True, exist_ok=True)
    
    fonts = {
        "brand": get_font(18, bold=True),
        "tag": get_font(14, bold=True),
        "title": get_font(34, bold=True),
        "body": get_font(18, bold=False),
        "badge": get_font(13, bold=True),
        "counter": get_font(14, bold=True),
    }

    # Pre-render phone mockups
    mockups = []
    for stage in TOUR_STAGES:
        primary = make_phone_mockup(LIVE_SHOTS / stage["shot"], pw=240, ph=520)
        alt = make_phone_mockup(LIVE_SHOTS / stage["alt_shot"], pw=220, ph=480) if "alt_shot" in stage else None
        mockups.append((primary, alt))

    total_stages = len(TOUR_STAGES)
    
    # We will generate frames
    temp_dir = Path(tempfile.mkdtemp(prefix="tour_video_"))
    print(f"Rendering frames into {temp_dir}...")
    
    fps = 30
    hold_sec = 2.4  # seconds on each slide
    trans_sec = 0.6 # seconds transition
    hold_frames = int(hold_sec * fps)
    trans_frames = int(trans_sec * fps)
    
    frame_idx = 0
    gif_frames = []
    
    for s_idx in range(total_stages):
        stage = TOUR_STAGES[s_idx]
        next_stage = TOUR_STAGES[(s_idx + 1) % total_stages]
        m_curr, m_curr_alt = mockups[s_idx]
        m_next, m_next_alt = mockups[(s_idx + 1) % total_stages]

        # 1. HOLD PHASE
        for h_f in range(hold_frames):
            frame_img = bg.copy().convert("RGBA")
            fdraw = ImageDraw.Draw(frame_img)
            
            # Left side: Typography and info card
            tx, ty = 85, 140
            
            # App Pill
            fdraw.rounded_rectangle([tx, ty, tx + 140, ty + 28], 14, fill=(18, 30, 48), outline=(56, 189, 248), width=1)
            fdraw.text((tx + 14, ty + 5), "SHELF DRIVE", font=fonts["brand"], fill=(56, 189, 248))
            
            # Step tag
            ty += 46
            fdraw.text((tx, ty), stage["tag"], font=fonts["tag"], fill=stage["tag_color"])
            
            # Title
            ty += 30
            fdraw.text((tx, ty), stage["title"], font=fonts["title"], fill=(241, 245, 249))
            
            # Body description
            ty += 54
            # Wrap body text to 480px width
            words = stage["body"].split()
            lines, cur_line = [], ""
            for w in words:
                test_line = f"{cur_line} {w}".strip()
                if fdraw.textlength(test_line, font=fonts["body"]) < 460:
                    cur_line = test_line
                else:
                    lines.append(cur_line)
                    cur_line = w
            if cur_line:
                lines.append(cur_line)
            
            for line in lines:
                fdraw.text((tx, ty), line, font=fonts["body"], fill=(148, 163, 184))
                ty += 28
            
            # Feature Badge
            ty += 18
            bw = int(fdraw.textlength(stage["badge"], font=fonts["badge"])) + 26
            fdraw.rounded_rectangle([tx, ty, tx + bw, ty + 30], 15, fill=(15, 23, 42), outline=stage["tag_color"], width=1)
            fdraw.text((tx + 13, ty + 6), stage["badge"], font=fonts["badge"], fill=stage["tag_color"])
            
            # Progress dots on bottom-left
            py = 560
            for d in range(total_stages):
                cx = tx + d * 28 + 10
                is_active = (d == s_idx)
                if is_active:
                    fdraw.rounded_rectangle([cx - 10, py, cx + 10, py + 8], 4, fill=stage["tag_color"])
                else:
                    fdraw.rounded_rectangle([cx - 4, py, cx + 4, py + 8], 4, fill=(51, 65, 85))

            # Right side: Phone mockup(s)
            if m_curr_alt:
                # Dual phone presentation
                # Back phone
                bx, by = 680, 110
                frame_img.alpha_composite(m_curr_alt, (bx, by))
                # Front phone
                fx, fy = 800, 75
                # Shadow
                sh = Image.new("RGBA", frame_img.size, (0, 0, 0, 0))
                ImageDraw.Draw(sh).rounded_rectangle([fx, fy + 20, fx + m_curr.width, fy + m_curr.height + 20], 40, fill=(0, 229, 255, 35))
                frame_img = Image.alpha_composite(frame_img, sh.filter(ImageFilter.GaussianBlur(30)))
                frame_img.alpha_composite(m_curr, (fx, fy))
            else:
                # Single center-right phone
                fx, fy = 760, 75
                # Cyan ambient glow under phone
                sh = Image.new("RGBA", frame_img.size, (0, 0, 0, 0))
                ImageDraw.Draw(sh).rounded_rectangle([fx, fy + 20, fx + m_curr.width, fy + m_curr.height + 20], 40, fill=(0, 229, 255, 45))
                frame_img = Image.alpha_composite(frame_img, sh.filter(ImageFilter.GaussianBlur(32)))
                frame_img.alpha_composite(m_curr, (fx, fy))

            rgb_frame = frame_img.convert("RGB")
            frame_path = temp_dir / f"frame_{frame_idx:05d}.png"
            rgb_frame.save(frame_path)
            
            # Collect a sparse set for GIF (every 4th frame during hold)
            if h_f % 4 == 0:
                gif_frames.append(rgb_frame.resize((800, 450), Image.BILINEAR))
                
            frame_idx += 1

        # 2. TRANSITION PHASE (Smooth slide/crossfade)
        for t_f in range(trans_frames):
            progress = t_f / trans_frames
            # Smoothstep
            e = progress * progress * (3 - 2 * progress)
            
            frame_img = bg.copy().convert("RGBA")
            fdraw = ImageDraw.Draw(frame_img)
            
            # Text crossfades
            alpha_out = int(255 * (1 - e))
            alpha_in = int(255 * e)
            
            tx = 85
            # App Pill
            fdraw.rounded_rectangle([tx, 140, tx + 140, 140 + 28], 14, fill=(18, 30, 48), outline=(56, 189, 248), width=1)
            fdraw.text((tx + 14, 145), "SHELF DRIVE", font=fonts["brand"], fill=(56, 189, 248))

            # Current stage leaving (slides up slightly)
            ty_out = 140 + 46 - int(12 * e)
            if alpha_out > 20:
                fdraw.text((tx, ty_out), stage["tag"], font=fonts["tag"], fill=(*stage["tag_color"], alpha_out))
                fdraw.text((tx, ty_out + 30), stage["title"], font=fonts["title"], fill=(241, 245, 249, alpha_out))
                
            # Next stage entering (slides up into place)
            ty_in = 140 + 46 + int(12 * (1 - e))
            if alpha_in > 20:
                fdraw.text((tx, ty_in), next_stage["tag"], font=fonts["tag"], fill=(*next_stage["tag_color"], alpha_in))
                fdraw.text((tx, ty_in + 30), next_stage["title"], font=fonts["title"], fill=(241, 245, 249, alpha_in))

            # Phone motion: slide left/out and new phone slides in
            x_curr = int(760 - e * 180)
            x_next = int(760 + (1 - e) * 220)
            
            # Paste outgoing phone
            p_out = m_curr.copy()
            if alpha_out < 255:
                p_out.putalpha(p_out.split()[3].point(lambda v: int(v * (1 - e))))
            frame_img.alpha_composite(p_out, (x_curr, 75))

            # Paste incoming phone
            p_in = m_next.copy()
            p_in.putalpha(p_in.split()[3].point(lambda v: int(v * e)))
            frame_img.alpha_composite(p_in, (x_next, 75))

            rgb_frame = frame_img.convert("RGB")
            frame_path = temp_dir / f"frame_{frame_idx:05d}.png"
            rgb_frame.save(frame_path)
            
            # Sparse GIF collection
            if t_f % 3 == 0:
                gif_frames.append(rgb_frame.resize((800, 450), Image.BILINEAR))
                
            frame_idx += 1

    print(f"Total {frame_idx} video frames generated.")

    # 1. ENCODE HIGH-DEFINITION MP4 VIDEO WITH FFMPEG
    mp4_out = OUT / "tour-feature.mp4"
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", str(temp_dir / "frame_%05d.png"),
        "-c:v", "libx264",
        "-profile:v", "high",
        "-level", "4.1",
        "-pix_fmt", "yuv420p",
        "-vf", "scale=1200:676:flags=lanczos",
        "-crf", "18",
        "-movflags", "+faststart",
        str(mp4_out)
    ]
    print(f"Compiling MP4 video to {mp4_out}...")
    res = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"Wrote {mp4_out} ({mp4_out.stat().st_size // 1024} KB)")
    else:
        print(f"ffmpeg error: {res.stderr}")

    # 2. ENCODE COMPACT ANIMATED GIF WITH PALETTE
    gif_out = OUT / "tour-feature.gif"
    print(f"Compiling animated tour GIF to {gif_out}...")
    if gif_frames:
        pal = gif_frames[0].quantize(colors=128, method=Image.MEDIANCUT, dither=Image.NONE)
        q_frames = [f.quantize(palette=pal, dither=Image.NONE) for f in gif_frames]
        # Durations: ~100ms per frame
        durations = [120] * len(q_frames)
        q_frames[0].save(
            gif_out,
            save_all=True,
            append_images=q_frames[1:],
            duration=durations,
            loop=0,
            optimize=True,
            disposal=1
        )
        print(f"Wrote {gif_out} ({gif_out.stat().st_size // 1024} KB)")

    # Cleanup temp directory
    shutil.rmtree(temp_dir, ignore_errors=True)
    print("Tour video generation complete!")

if __name__ == "__main__":
    generate()
