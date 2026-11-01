#!/bin/bash
# Create a simple icon for Lector

ICONSET="build/Lector.iconset"
mkdir -p "$ICONSET"

# Create a simple SVG icon
cat > build/icon.svg << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FAF9F7"/>
      <stop offset="100%" style="stop-color:#F5F0EB"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="1024" height="1024" rx="200" fill="url(#bg)"/>
  <!-- Book/Document shape -->
  <rect x="200" y="150" width="624" height="724" rx="40" fill="#D4A574" opacity="0.2"/>
  <rect x="220" y="170" width="584" height="684" rx="30" fill="white" stroke="#D4A574" stroke-width="8"/>
  <!-- Text lines -->
  <rect x="300" y="280" width="400" height="20" rx="10" fill="#D4A574"/>
  <rect x="300" y="340" width="350" height="16" rx="8" fill="#E5DDD5"/>
  <rect x="300" y="380" width="380" height="16" rx="8" fill="#E5DDD5"/>
  <rect x="300" y="420" width="320" height="16" rx="8" fill="#E5DDD5"/>
  <!-- Mind map symbol -->
  <circle cx="512" cy="620" r="40" fill="#D4A574"/>
  <circle cx="380" cy="560" r="20" fill="#D4A574" opacity="0.7"/>
  <circle cx="644" cy="560" r="20" fill="#D4A574" opacity="0.7"/>
  <circle cx="380" cy="700" r="20" fill="#D4A574" opacity="0.7"/>
  <circle cx="644" cy="700" r="20" fill="#D4A574" opacity="0.7"/>
  <line x1="512" y1="620" x2="380" y2="560" stroke="#D4A574" stroke-width="6" opacity="0.5"/>
  <line x1="512" y1="620" x2="644" y2="560" stroke="#D4A574" stroke-width="6" opacity="0.5"/>
  <line x1="512" y1="620" x2="380" y2="700" stroke="#D4A574" stroke-width="6" opacity="0.5"/>
  <line x1="512" y1="620" x2="644" y2="700" stroke="#D4A574" stroke-width="6" opacity="0.5"/>
</svg>
SVGEOF

echo "SVG icon created at build/icon.svg"
echo "To convert to .icns, use an online converter or install librsvg and iconutil"
