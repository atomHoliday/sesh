# Sesh

End-to-end encrypted peer-to-peer chat for GNOME. Lives in your top bar.

## Quick Install

```bash
git clone https://github.com/atomHoliday/sesh.git && cd sesh && ./install.sh
```

## Features

- **E2EE** — Messages encrypted with X25519 + ChaCha20-Poly1305
- **P2P** — Direct connection, no server needed
- **LAN discovery** — Automatic peer discovery on local network
- **Chat in top bar** — Quick access from the GNOME panel

## Requirements

- GNOME 45+ (supports up to GNOME 50)
- Python 3.10+
- `dbus-python`, `cryptography`, `PyGObject`

## Manual Install

```bash
git clone https://github.com/atomHoliday/sesh.git
cd sesh
./install.sh
```

Then reload GNOME Shell: `Alt+F2`, type `r`, press Enter.

## Usage

1. The `S` icon appears in your top bar
2. Click it to see online peers on your LAN
3. Click a peer to start chatting

## Config

Config file: `~/.config/sesh/config.toml`

```toml
[identity]
username = "your_name"

[network]
discovery_port = 42069
tcp_port = 0
listen_on = "0.0.0.0"
broadcast_addr = "255.255.255.255"
```

## Commands

```bash
# Start daemon
systemctl --user start sesh.service

# Stop daemon
systemctl --user stop sesh.service

# View logs
journalctl --user -u sesh.service -f

# Check status
systemctl --user status sesh.service
```

## License

MIT
