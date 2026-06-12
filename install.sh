#!/usr/bin/env bash
set -euo pipefail

DEST_BIN="${HOME}/.local/bin"
DEST_SERVICE="${HOME}/.config/systemd/user"
DEST_DBUS="${HOME}/.local/share/dbus-1/services"
DEST_EXTENSION="${HOME}/.local/share/gnome-shell/extensions/sesh@sesh.local"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing daemon..."
mkdir -p "$DEST_BIN"
cp "$SCRIPT_DIR/daemon/sesh-daemon.py" "$DEST_BIN/sesh-daemon"
chmod +x "$DEST_BIN/sesh-daemon"

echo "==> Installing Python dependencies..."
pip3 install -r "$SCRIPT_DIR/daemon/requirements.txt" --quiet --break-system-packages 2>/dev/null || \
  pip3 install -r "$SCRIPT_DIR/daemon/requirements.txt" --quiet 2>/dev/null || \
  echo "WARNING: could not install deps, run: pip3 install -r daemon/requirements.txt"

echo "==> Installing systemd user service..."
mkdir -p "$DEST_SERVICE"
cp "$SCRIPT_DIR/sesh.service" "$DEST_SERVICE/sesh.service"

echo "==> Installing D-Bus service file..."
mkdir -p "$DEST_DBUS"
cp "$SCRIPT_DIR/com.sesh.Daemon.service" "$DEST_DBUS/com.sesh.Daemon.service"

echo "==> Reloading systemd and D-Bus..."
systemctl --user daemon-reload 2>/dev/null || true
dbus-send --session --type=method_call --dest=org.freedesktop.DBus \
  /org/freedesktop/DBus org.freedesktop.DBus.ReloadConfig 2>/dev/null || true

echo "==> Installing GNOME Shell extension..."
mkdir -p "$DEST_EXTENSION"
cp "$SCRIPT_DIR/extension"/*.js "$DEST_EXTENSION/"
cp "$SCRIPT_DIR/extension/metadata.json" "$DEST_EXTENSION/"
cp "$SCRIPT_DIR/extension/stylesheet.css" "$DEST_EXTENSION/"

echo "==> Registering extension..."
CURRENT_EXTENSIONS="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]")"
if ! echo "$CURRENT_EXTENSIONS" | grep -q "sesh@sesh.local"; then
  NEW_EXTENSIONS="$(echo "$CURRENT_EXTENSIONS" | sed "s/\]$/,'sesh@sesh.local'\]/")"
  gsettings set org.gnome.shell enabled-extensions "$NEW_EXTENSIONS" || true
fi

echo "==> Starting daemon..."
systemctl --user start sesh.service 2>/dev/null || true
systemctl --user enable sesh.service 2>/dev/null || true

echo ""
echo "  Sesh installed!"
echo ""
echo "  Reload GNOME Shell: Alt+F2, type 'r', Enter"
echo "  The 'S' icon will appear in your top bar."
echo ""
echo "  To view logs: journalctl --user -u sesh.service -f"
echo "  To stop:      systemctl --user stop sesh.service"
