#!/bin/sh
# Lector installer for Mac and Linux (WSL or native).
# Usage: curl -fsSL https://lector.dockerbop.fr/download/install.sh | sh

set -e

BASE_URL="${LECTOR_INSTALL_URL:-https://lector.dockerbop.fr/download}"

PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')

case "$PLATFORM" in

  darwin)
    echo "==> Detected macOS"
    # Choose install location: prefer /Applications if writable (no sudo prompt),
    # otherwise fall back to ~/Applications (works on locked-down work Macs).
    if [ -w /Applications ] 2>/dev/null; then
      DEST_DIR="/Applications"
    else
      DEST_DIR="$HOME/Applications"
      mkdir -p "$DEST_DIR"
      echo "==> /Applications not writable (corp Mac?), installing to $DEST_DIR"
    fi
    DEST="$DEST_DIR/Lector.app"

    DMG="/tmp/Lector-install.dmg"
    echo "==> Downloading Lector.dmg…"
    curl -fL --progress-bar "$BASE_URL/Lector.dmg" -o "$DMG"
    echo "==> Mounting…"
    MNT=$(hdiutil attach -nobrowse -plist "$DMG" 2>/dev/null | sed -n 's/.*<string>\(\/Volumes\/.*\)<\/string>.*/\1/p' | head -1)
    [ -d "$MNT/Lector.app" ] || { echo "Could not find Lector.app inside the DMG"; exit 1; }
    echo "==> Killing any running Lector…"
    pkill -9 -f "Lector.app" 2>/dev/null || true
    sleep 1
    echo "==> Installing to $DEST…"
    rm -rf "$DEST"
    cp -R "$MNT/Lector.app" "$DEST_DIR/"
    hdiutil detach "$MNT" -quiet 2>/dev/null || true
    rm -f "$DMG"
    echo "==> Launching Lector…"
    open "$DEST"
    echo ""
    echo "✓ Lector installed → $DEST"
    ;;

  linux)
    echo "==> Detected Linux"
    DEST="${LECTOR_DIR:-$HOME/Apps/Lector}"
    TAR="/tmp/Lector-linux.tar.xz"
    echo "==> Downloading Lector-linux.tar.xz…"
    mkdir -p "$DEST"
    curl -fL --progress-bar "$BASE_URL/Lector-linux.tar.xz" -o "$TAR"
    echo "==> Extracting to $DEST…"
    rm -rf "$DEST/linux-unpacked"
    tar -xJf "$TAR" -C "$DEST" 2>/dev/null
    rm -f "$TAR"
    # Symlink for quick access
    mkdir -p "$HOME/.local/bin"
    ln -sf "$DEST/linux-unpacked/lector" "$HOME/.local/bin/lector"
    echo ""
    echo "✓ Lector installed → $DEST/linux-unpacked/"
    echo "  Launch with: lector  (or $DEST/linux-unpacked/lector)"
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) ;;
      *) echo "  ⚠ Add $HOME/.local/bin to your PATH:"
         echo "    export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
    esac
    echo ""
    # Optional: auto-launch if a display is available (WSLg / X11)
    if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
      echo "==> Launching Lector…"
      nohup "$DEST/linux-unpacked/lector" >/dev/null 2>&1 &
    fi
    ;;

  *)
    echo "Unsupported platform: $PLATFORM"
    echo "Lector currently supports macOS and Linux (incl. WSL/WSLg)."
    exit 1
    ;;
esac
