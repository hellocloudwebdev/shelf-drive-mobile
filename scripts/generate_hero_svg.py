"""Generate the ultra-premium animated hero banner (assets/readme/hero-animated.svg)
with real-time app screenshots embedded inside precision dual-phone mockups.
"""
from pathlib import Path
import base64
import io
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LIVE_SHOTS = ROOT / "screenshots" / "live"
OUT_SVG = ROOT / "assets" / "readme" / "hero-animated.svg"

def encode_image(path: Path, size: tuple[int, int]) -> str:
    im = Image.open(path)
    im_resized = im.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    im_resized.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")

def generate():
    # Encode real live screenshots
    # Phone 1 (Front: Dark Home)
    p1_w, p1_h = 264, 572
    b64_p1 = encode_image(LIVE_SHOTS / "04-home.png", (p1_w, p1_h))

    # Phone 2 (Back: Photos or Light Mode)
    p2_w, p2_h = 240, 520
    b64_p2 = encode_image(LIVE_SHOTS / "06-photos.png", (p2_w, p2_h))

    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1280 640" width="1280" height="640">
  <title>Shelf Drive — The Telegram-Powered Cloud Workspace</title>
  <defs>
    <!-- Background Gradients -->
    <linearGradient id="bgCanvas" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#040812"/>
      <stop offset="45%" stop-color="#091224"/>
      <stop offset="100%" stop-color="#050a16"/>
    </linearGradient>

    <!-- Animated Shimmer Gradient for Title -->
    <linearGradient id="titleShimmer" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38BDF8"/>
      <stop offset="25%" stop-color="#34D399"/>
      <stop offset="50%" stop-color="#818CF8"/>
      <stop offset="75%" stop-color="#FBBF24"/>
      <stop offset="100%" stop-color="#38BDF8"/>
      <animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="8s" repeatCount="indefinite"/>
    </linearGradient>

    <!-- Moving Laser Beam -->
    <linearGradient id="laserBeam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0"/>
      <stop offset="30%" stop-color="#38BDF8" stop-opacity="0.8"/>
      <stop offset="50%" stop-color="#34D399" stop-opacity="1"/>
      <stop offset="70%" stop-color="#818CF8" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#FBBF24" stop-opacity="0"/>
    </linearGradient>

    <!-- Glowing Accent Gradient -->
    <linearGradient id="accentGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#00E5FF"/>
      <stop offset="100%" stop-color="#1DE9B6"/>
    </linearGradient>

    <!-- Glass Fill for Cards -->
    <linearGradient id="glassCard" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.03"/>
    </linearGradient>

    <!-- Titanium Phone Bezel -->
    <linearGradient id="titanium" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b485d"/>
      <stop offset="25%" stop-color="#1f2937"/>
      <stop offset="50%" stop-color="#4b5563"/>
      <stop offset="75%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>

    <linearGradient id="titaniumBack" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2a3447"/>
      <stop offset="100%" stop-color="#141c2c"/>
    </linearGradient>

    <!-- Glass Specular Highlight -->
    <linearGradient id="sheenGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="42%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="58%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>

    <!-- Radial Nebula Glows -->
    <radialGradient id="nebulaCyan" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#00BCD4" stop-opacity="0.32"/>
      <stop offset="60%" stop-color="#00BCD4" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#00BCD4" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="nebulaAmber" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="#F59E0B" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="phoneGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.45"/>
      <stop offset="45%" stop-color="#00BCD4" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#00BCD4" stop-opacity="0"/>
    </radialGradient>

    <!-- Patterns -->
    <pattern id="gridDots" width="36" height="36" patternUnits="userSpaceOnUse">
      <circle cx="18" cy="18" r="1.1" fill="#38BDF8" opacity="0.18"/>
      <line x1="18" y1="14" x2="18" y2="22" stroke="#38BDF8" stroke-width="0.5" opacity="0.08"/>
      <line x1="14" y1="18" x2="22" y2="18" stroke="#38BDF8" stroke-width="0.5" opacity="0.08"/>
    </pattern>

    <!-- Drop Shadows -->
    <filter id="shadowGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#00E5FF" flood-opacity="0.25"/>
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.6"/>
    </filter>

    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.55"/>
      <feDropShadow dx="0" dy="1" stdDeviation="3" flood-color="#38BDF8" flood-opacity="0.25"/>
    </filter>

    <filter id="backPhoneShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#000000" flood-opacity="0.65"/>
    </filter>

    <!-- Clip Paths for Phone Screens -->
    <clipPath id="p1ScreenClip">
      <rect x="0" y="0" width="{p1_w}" height="{p1_h}" rx="32"/>
    </clipPath>

    <clipPath id="p2ScreenClip">
      <rect x="0" y="0" width="{p2_w}" height="{p2_h}" rx="28"/>
    </clipPath>

    <!-- Styles & Keyframes -->
    <style>
      .font-sans {{ font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Inter, Roboto, sans-serif; }}
      .title-text {{ font-weight: 850; font-size: 78px; letter-spacing: -2px; }}
      .sub-text {{ font-weight: 450; font-size: 21px; line-height: 1.45; fill: #94A3B8; }}
      .tag-text {{ font-weight: 600; font-size: 13.5px; fill: #E2E8F0; letter-spacing: 0.3px; }}
      .badge-text {{ font-weight: 700; font-size: 12px; letter-spacing: 1.2px; fill: #38BDF8; text-transform: uppercase; }}

      /* Animations */
      .pulse-slow {{
        animation: pulseSlow 5s ease-in-out infinite alternate;
      }}
      @keyframes pulseSlow {{
        0% {{ transform: scale(0.92); opacity: 0.7; }}
        100% {{ transform: scale(1.08); opacity: 1; }}
      }}

      .float-card-1 {{
        animation: floatCard1 6s ease-in-out infinite alternate;
      }}
      @keyframes floatCard1 {{
        0% {{ transform: translateY(0px); }}
        100% {{ transform: translateY(-14px); }}
      }}

      .float-card-2 {{
        animation: floatCard2 7s ease-in-out infinite alternate;
      }}
      @keyframes floatCard2 {{
        0% {{ transform: translateY(0px); }}
        100% {{ transform: translateY(12px); }}
      }}

      .float-card-3 {{
        animation: floatCard3 6.5s ease-in-out infinite alternate;
      }}
      @keyframes floatCard3 {{
        0% {{ transform: translateY(0px); }}
        100% {{ transform: translateY(-10px); }}
      }}

      .sheen-anim {{
        animation: sheenMove 6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }}
      @keyframes sheenMove {{
        0% {{ transform: translateY(-700px); }}
        40%, 100% {{ transform: translateY(700px); }}
      }}

      .orbit-ring {{
        transform-origin: 1000px 320px;
        animation: spinOrbit 45s linear infinite;
      }}
      @keyframes spinOrbit {{
        from {{ transform: rotate(0deg); }}
        to {{ transform: rotate(360deg); }}
      }}

      .beacon-dot {{
        animation: beaconPing 2s cubic-bezier(0, 0, 0.2, 1) infinite;
      }}
      @keyframes beaconPing {{
        0% {{ r: 3.5px; opacity: 1; }}
        75%, 100% {{ r: 9px; opacity: 0; }}
      }}

      @media (prefers-reduced-motion: reduce) {{
        *, .pulse-slow, .float-card-1, .float-card-2, .float-card-3, .sheen-anim, .orbit-ring, .beacon-dot {{
          animation: none !important;
        }}
      }}
    </style>
  </defs>

  <!-- Base Canvas Background -->
  <rect width="1280" height="640" fill="url(#bgCanvas)"/>
  <rect width="1280" height="640" fill="url(#gridDots)"/>

  <!-- Ambient Nebula Flares -->
  <ellipse class="pulse-slow" cx="1020" cy="300" rx="360" ry="290" fill="url(#nebulaCyan)"/>
  <ellipse class="pulse-slow" cx="300" cy="180" rx="320" ry="240" fill="url(#nebulaAmber)" style="animation-delay: -2.5s;"/>

  <!-- Orbit Rings around Phone Stage -->
  <g class="orbit-ring" fill="none" stroke="#38BDF8" opacity="0.14">
    <ellipse cx="1000" cy="320" rx="420" ry="280" stroke-width="1.2" stroke-dasharray="8 12"/>
    <ellipse cx="1000" cy="320" rx="320" ry="210" stroke-width="0.8" stroke-dasharray="4 8" transform="rotate(-15 1000 320)"/>
    <circle cx="1420" cy="320" r="5" fill="#38BDF8" stroke="none"/>
    <circle cx="680" cy="320" r="4" fill="#34D399" stroke="none"/>
  </g>

  <!-- ============================================================== -->
  <!-- LEFT COLUMN: Brand Identity, Pitch, Features & Tech Matrix    -->
  <!-- ============================================================== -->
  <g class="font-sans" transform="translate(68, 64)">

    <!-- Release Pill Badge -->
    <g transform="translate(0, 0)">
      <rect width="365" height="34" rx="17" fill="#ffffff" fill-opacity="0.06" stroke="#38BDF8" stroke-opacity="0.4" stroke-width="1.2"/>
      <!-- Glowing live beacon -->
      <circle cx="20" cy="17" r="4" fill="#34D399"/>
      <circle class="beacon-dot" cx="20" cy="17" r="4" stroke="#34D399" stroke-width="1.5" fill="none"/>
      <text class="badge-text" x="34" y="21.5">v4.0 Mobile Workspace • Local-First</text>
    </g>

    <!-- Main Title -->
    <g transform="translate(0, 80)">
      <text class="title-text" x="0" y="0" fill="url(#titleShimmer)">Shelf Drive</text>
      <!-- Horizontal glowing laser accent line -->
      <rect x="0" y="16" width="340" height="3.5" rx="1.75" fill="url(#laserBeam)"/>
    </g>

    <!-- Subtitle / Value Proposition -->
    <g transform="translate(0, 142)">
      <text class="sub-text" x="0" y="0">
        <tspan x="0" dy="0">Transform your personal Telegram into a lightning-fast,</tspan>
        <tspan x="0" dy="28">zero-relay, beautifully organized cloud workspace.</tspan>
      </text>
    </g>

    <!-- High-Impact 4-Feature Glass Grid -->
    <g transform="translate(0, 222)">
      <!-- Card 1: Zero-Relay MTProto -->
      <g transform="translate(0, 0)">
        <rect width="265" height="64" rx="14" fill="url(#glassCard)" stroke="#38BDF8" stroke-opacity="0.25" stroke-width="1"/>
        <circle cx="32" cy="32" r="16" fill="#38BDF8" fill-opacity="0.14"/>
        <!-- Bolt Icon -->
        <path d="M33 22l-7 12h6l-2 10 9-13h-6l2-9z" fill="#38BDF8"/>
        <text class="font-sans" x="58" y="27" font-weight="700" font-size="14" fill="#F1F5F9">Direct MTProto</text>
        <text class="font-sans" x="58" y="46" font-size="12" fill="#94A3B8">0 relay servers • direct pipe</text>
      </g>

      <!-- Card 2: TDENC2 Vault -->
      <g transform="translate(280, 0)">
        <rect width="265" height="64" rx="14" fill="url(#glassCard)" stroke="#34D399" stroke-opacity="0.25" stroke-width="1"/>
        <circle cx="32" cy="32" r="16" fill="#34D399" fill-opacity="0.14"/>
        <!-- Shield Lock Icon -->
        <path d="M32 22l8 3v5c0 6-4 11-8 13-4-2-8-7-8-13v-5l8-3z" fill="#34D399" fill-opacity="0.3"/>
        <path d="M30 31v-2a2 2 0 1 1 4 0v2m-3 0h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" stroke="#34D399" stroke-width="1.4" fill="none"/>
        <text class="font-sans" x="58" y="27" font-weight="700" font-size="14" fill="#F1F5F9">TDENC2 Envelope</text>
        <text class="font-sans" x="58" y="46" font-size="12" fill="#94A3B8">Argon2 + XChaCha20</text>
      </g>

      <!-- Card 3: 4K HDR Streaming -->
      <g transform="translate(0, 76)">
        <rect width="265" height="64" rx="14" fill="url(#glassCard)" stroke="#818CF8" stroke-opacity="0.25" stroke-width="1"/>
        <circle cx="32" cy="32" r="16" fill="#818CF8" fill-opacity="0.14"/>
        <!-- Play / Film Icon -->
        <path d="M27 24l13 8-13 8z" fill="#818CF8"/>
        <text class="font-sans" x="58" y="27" font-weight="700" font-size="14" fill="#F1F5F9">Instant Streaming</text>
        <text class="font-sans" x="58" y="46" font-size="12" fill="#94A3B8">4K video, audio &amp; PDF</text>
      </g>

      <!-- Card 4: Android & Google TV -->
      <g transform="translate(280, 76)">
        <rect width="265" height="64" rx="14" fill="url(#glassCard)" stroke="#FBBF24" stroke-opacity="0.25" stroke-width="1"/>
        <circle cx="32" cy="32" r="16" fill="#FBBF24" fill-opacity="0.14"/>
        <!-- TV / Screen Icon -->
        <rect x="24" y="24" width="16" height="12" rx="2" fill="none" stroke="#FBBF24" stroke-width="1.6"/>
        <path d="M29 39h6m-3-3v3" stroke="#FBBF24" stroke-width="1.6" stroke-linecap="round"/>
        <text class="font-sans" x="58" y="27" font-weight="700" font-size="14" fill="#F1F5F9">Android &amp; Google TV</text>
        <text class="font-sans" x="58" y="46" font-size="12" fill="#94A3B8">Touch + spatial remote nav</text>
      </g>
    </g>

    <!-- Tech Stack Architecture Ribbon -->
    <g transform="translate(0, 396)">
      <!-- Label -->
      <text class="font-sans" x="0" y="0" font-size="11.5" font-weight="700" letter-spacing="1" fill="#64748B" text-transform="uppercase">Core Architecture</text>
      
      <!-- Chips -->
      <g transform="translate(0, 12)">
        <!-- React 19 -->
        <g transform="translate(0, 0)">
          <rect width="90" height="26" rx="13" fill="#ffffff" fill-opacity="0.05" stroke="#38BDF8" stroke-opacity="0.3"/>
          <text class="tag-text" x="45" y="17.5" text-anchor="middle" font-size="12">React 19</text>
        </g>
        <!-- Tauri 2 -->
        <g transform="translate(98, 0)">
          <rect width="82" height="26" rx="13" fill="#ffffff" fill-opacity="0.05" stroke="#FFC131" stroke-opacity="0.3"/>
          <text class="tag-text" x="41" y="17.5" text-anchor="middle" font-size="12">Tauri 2</text>
        </g>
        <!-- Rust -->
        <g transform="translate(188, 0)">
          <rect width="70" height="26" rx="13" fill="#ffffff" fill-opacity="0.05" stroke="#DEA584" stroke-opacity="0.3"/>
          <text class="tag-text" x="35" y="17.5" text-anchor="middle" font-size="12">Rust</text>
        </g>
        <!-- Tailwind 4 -->
        <g transform="translate(266, 0)">
          <rect width="98" height="26" rx="13" fill="#ffffff" fill-opacity="0.05" stroke="#38BDF8" stroke-opacity="0.3"/>
          <text class="tag-text" x="49" y="17.5" text-anchor="middle" font-size="12">Tailwind 4</text>
        </g>
        <!-- Grammers -->
        <g transform="translate(372, 0)">
          <rect width="96" height="26" rx="13" fill="#ffffff" fill-opacity="0.05" stroke="#00BCD4" stroke-opacity="0.3"/>
          <text class="tag-text" x="48" y="17.5" text-anchor="middle" font-size="12">Grammers</text>
        </g>
        <!-- SQLite -->
        <g transform="translate(476, 0)">
          <rect width="76" height="26" rx="13" fill="#ffffff" fill-opacity="0.05" stroke="#34D399" stroke-opacity="0.3"/>
          <text class="tag-text" x="38" y="17.5" text-anchor="middle" font-size="12">SQLite</text>
        </g>
      </g>
    </g>

    <!-- Bottom Guarantees / Badges -->
    <g transform="translate(0, 474)" fill="#64748B" font-size="12.5" font-weight="600">
      <circle cx="6" cy="-4" r="3" fill="#34D399"/>
      <text x="16" y="0">No telemetry by default</text>

      <circle cx="180" cy="-4" r="3" fill="#38BDF8"/>
      <text x="190" y="0">24 Languages (RTL Ready)</text>

      <circle cx="370" cy="-4" r="3" fill="#C084FC"/>
      <text x="380" y="0">15 Liquid Themes</text>
    </g>

  </g>

  <!-- ============================================================== -->
  <!-- RIGHT STAGE: Precision Dual-Phone Mockups with Real Live App UI-->
  <!-- ============================================================== -->
  <g id="phoneStage" transform="translate(710, 32)">

    <!-- Pulsing ambient floor light under the phones -->
    <ellipse class="pulse-slow" cx="300" cy="420" rx="280" ry="180" fill="url(#phoneGlow)"/>

    <!--  -->
    <!-- BACK PHONE: Media Gallery (06-photos.png)                     -->
    <!--  -->
    <g transform="translate(230, 20) rotate(4)" filter="url(#backPhoneShadow)" opacity="0.88">
      <!-- Outer Metal Frame -->
      <rect x="-6" y="-6" width="{p2_w + 12}" height="{p2_h + 12}" rx="38" fill="url(#titaniumBack)" stroke="#475569" stroke-width="1.5"/>
      <!-- Inner Bezel -->
      <rect x="-2" y="-2" width="{p2_w + 4}" height="{p2_h + 4}" rx="34" fill="#0b1220"/>
      <!-- Real Screenshot Screen -->
      <g clip-path="url(#p2ScreenClip)">
        <image href="data:image/png;base64,{b64_p2}" width="{p2_w}" height="{p2_h}" preserveAspectRatio="xMidYMid slice"/>
        <!-- Glass Tint Overlay -->
        <rect width="{p2_w}" height="{p2_h}" fill="#0b1220" opacity="0.12"/>
      </g>
      <!-- Speaker & Camera -->
      <circle cx="{p2_w / 2}" cy="14" r="4.5" fill="#000000" stroke="#1f2937" stroke-width="1"/>
    </g>

    <!--  -->
    <!-- FRONT PHONE: Dark Home Screen (04-home.png)                   -->
    <!--  -->
    <g transform="translate(30, 0)" filter="url(#shadowGlow)">
      <!-- Outer Titanium Chassis -->
      <rect x="-8" y="-8" width="{p1_w + 16}" height="{p1_h + 16}" rx="44" fill="url(#titanium)" stroke="#64748B" stroke-opacity="0.6" stroke-width="1.5"/>
      <!-- Inner Black Bezel Frame -->
      <rect x="-3" y="-3" width="{p1_w + 6}" height="{p1_h + 6}" rx="38" fill="#030712"/>

      <!-- Real Live Screenshot Screen -->
      <g clip-path="url(#p1ScreenClip)">
        <image href="data:image/png;base64,{b64_p1}" width="{p1_w}" height="{p1_h}" preserveAspectRatio="xMidYMid slice"/>
        
        <!-- Animated Specular Glass Sheen Sweep -->
        <g class="sheen-anim" pointer-events="none">
          <rect x="-100" y="0" width="{p1_w + 200}" height="280" fill="url(#sheenGrad)" transform="rotate(-25 {p1_w / 2} 140)"/>
        </g>
      </g>

      <!-- Glass Border Rim Light -->
      <rect x="0" y="0" width="{p1_w}" height="{p1_h}" rx="32" fill="none" stroke="#ffffff" stroke-opacity="0.15" stroke-width="1.2"/>

      <!-- Speaker Grille & Punch Hole Camera -->
      <rect x="{p1_w / 2 - 24}" y="6" width="48" height="4" rx="2" fill="#0f172a"/>
      <circle cx="{p1_w / 2}" cy="18" r="5" fill="#020617" stroke="#1e293b" stroke-width="1.2"/>
      <!-- Camera lens glass reflection -->
      <circle cx="{p1_w / 2 - 1}" cy="17" r="1.5" fill="#38BDF8" opacity="0.6"/>

      <!-- Phone Side Buttons -->
      <!-- Volume Rocker (Left) -->
      <rect x="-10" y="110" width="3" height="46" rx="1.5" fill="#475569"/>
      <rect x="-10" y="165" width="3" height="46" rx="1.5" fill="#475569"/>
      <!-- Power Button (Right) -->
      <rect x="{p1_w + 7}" y="130" width="3" height="54" rx="1.5" fill="#475569"/>
    </g>

    <!--  -->
    <!-- FLOATING GLASS MICRO-CARDS (Overlaying Phone Stage)          -->
    <!--  -->

    <!-- Floating Card 1: Direct Pipe Stats (Left of Phone) -->
    <g transform="translate(-85, 140)">
      <g class="float-card-1 font-sans" filter="url(#cardShadow)">
        <rect width="216" height="62" rx="16" fill="#0c182c" fill-opacity="0.95" stroke="#38BDF8" stroke-opacity="0.6" stroke-width="1.2"/>
        <circle cx="28" cy="31" r="14" fill="#38BDF8" fill-opacity="0.18"/>
        <!-- Cloud Download Icon -->
        <path d="M28 24v8m0 0l-3-3m3 3l3-3m-6 5h6" stroke="#38BDF8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <text x="50" y="26" font-weight="700" font-size="12" fill="#F1F5F9">Direct MTProto Pipe</text>
        <text x="50" y="44" font-size="11" font-weight="600" fill="#34D399">100% Client-Side Socket</text>
        <!-- Active Status Dot -->
        <circle cx="194" cy="22" r="3.5" fill="#34D399"/>
        <circle class="beacon-dot" cx="194" cy="22" r="3.5" stroke="#34D399" stroke-width="1" fill="none"/>
      </g>
    </g>

    <!-- Floating Card 2: Security Enclave (Bottom Left of Phone) -->
    <g transform="translate(-65, 430)">
      <g class="float-card-2 font-sans" filter="url(#cardShadow)">
        <rect width="206" height="60" rx="16" fill="#0b1526" fill-opacity="0.95" stroke="#34D399" stroke-opacity="0.6" stroke-width="1.2"/>
        <circle cx="28" cy="30" r="14" fill="#34D399" fill-opacity="0.18"/>
        <!-- Shield Lock Icon -->
        <circle cx="28" cy="28" r="3" fill="#34D399"/>
        <path d="M27 29l-1 5h4l-1-5z" fill="#34D399"/>
        <text x="50" y="26" font-weight="700" font-size="12" fill="#F1F5F9">Keystore Secured</text>
        <text x="50" y="42" font-size="11" fill="#94A3B8">Credentials stay on device</text>
      </g>
    </g>

    <!-- Floating Card 3: 15 Themes Pill (Bottom Right) -->
    <g transform="translate(180, 500)">
      <g class="float-card-3 font-sans" filter="url(#cardShadow)">
        <rect width="180" height="44" rx="22" fill="#0d1728" fill-opacity="0.95" stroke="#FBBF24" stroke-opacity="0.5" stroke-width="1.2"/>
        <!-- Theme circles palette -->
        <circle cx="24" cy="22" r="5" fill="#38BDF8"/>
        <circle cx="36" cy="22" r="5" fill="#34D399"/>
        <circle cx="48" cy="22" r="5" fill="#C084FC"/>
        <circle cx="60" cy="22" r="5" fill="#FBBF24"/>
        <text x="74" y="26.5" font-weight="700" font-size="12" fill="#F1F5F9">15 Liquid Themes</text>
      </g>
    </g>

  </g>

</svg>'''

    OUT_SVG.write_text(svg_content, encoding="utf-8")
    print(f"Successfully generated ultra-premium hero: {OUT_SVG} ({OUT_SVG.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    generate()
