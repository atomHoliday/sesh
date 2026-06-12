#!/bin/bash
set -euo pipefail

echo "=== Installing Sesh Extension ==="
echo ""

# Install dependencies
echo "Installing Python dependencies..."
pip3 install cryptography dasbus --quiet 2>/dev/null || \
python3 -m pip install cryptography dasbus --quiet 2>/dev/null || \
echo "WARNING: could not install deps, run: pip install cryptography dasbus"

# Install daemon
echo "Installing daemon..."
mkdir -p "$HOME/.local/bin"
cp /home/holiday/sesh/daemon/sesh-daemon.py "$HOME/.local/bin/sesh-daemon"
chmod +x "$HOME/.local/bin/sesh-daemon"

# Install systemd services
echo "Installing systemd services..."
mkdir -p "$HOME/.config/systemd/user"
cp /home/holiday/sesh/sesh.service "$HOME/.config/systemd/user/"
mkdir -p "$HOME/.local/share/dbus-1/services"
cp /home/holiday/sesh/com.sesh.Daemon.service "$HOME/.local/share/dbus-1/services/"

# Reload systemd
echo "Reloading systemd..."
systemctl --user daemon-reload 2>/dev/null || true
dbus-send --session --type=method_call --dest=org.freedesktop.DBus \
  /org/freedesktop/DBus org.freedesktop.DBus.ReloadConfig 2>/dev/null || true

# Start the daemon
echo "Starting daemon..."
systemctl --user start sesh.service
systemctl --user enable sesh.service

# Install extension
echo "Installing GNOME Shell extension..."
mkdir -p "$HOME/.local/share/gnome-shell/extensions/sesh@sesh.local"
cp /home/holiday/sesh/extension/*.js "$HOME/.local/share/gnome-shell/extensions/sesh@sesh.local/"
cp /home/holiday/sesh/extension/metadata.json "$HOME/.local/share/gnome-shell/extensions/sesh@sesh.local/"
cp /home/holiday/sesh/extension/stylesheet.css "$HOME/.local/share/gnome-shell/extensions/sesh@sesh.local/"

# Register extension
CURRENT_EXTENSIONS="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo '[]')"
if ! echo "$CURRENT_EXTENSIONS" | grep -q "sesh@sesh.local"; then
  NEW_EXTENSIONS="$(echo "$CURRENT_EXTENSIONS" | sed "s/\]$/,'sesh@sesh.local'\]/")"
  gsettings set org.gnome.shell enabled-extensions "$NEW_EXTENSIONS" || true
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Next steps:"
echo "1. Restart GNOME Shell (ALT+F2, type 'r', Enter)"
echo "2. Check your top panel for the 'S' icon"
echo "3. Run ~/verify_installation.sh to verify the installation"
echo ""
echo "To view logs: journalctl --user -u sesh.service -f"
