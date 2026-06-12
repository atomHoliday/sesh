import os
import tomllib
from pathlib import Path

# ═══════════════════════════════════════════════════════════════════
# CONFIG — NOTES
# ═══════════════════════════════════════════════════════════════════
#
# Default broadcast address is 255.255.255.255.
# This only works on flat LANs. If peers are on different subnets
# or broadcast is disabled on your network, discovery will fail.
#
# Config file location: ~/.config/sesh/config.toml
# If the file doesn't exist, it's created with defaults on first run.
#
# To change username, edit config.toml:
#   [identity]
#   username = "your_name"
# ═══════════════════════════════════════════════════════════════════

DEFAULT_TOML = """\
[identity]
username = "{username}"
status = "online"
status_message = ""

[network]
discovery_port = 42069
tcp_port = 0
listen_on = "0.0.0.0"
broadcast_addr = "255.255.255.255"

[db]
path = "{db_path}"

[crypto]
key_dir = "{key_dir}"
"""

DEFAULT_CONFIG = {
    "identity": {
        "username": os.environ.get("USER", "user"),
        "status": "online",
        "status_message": "",
    },
    "network": {
        "discovery_port": 42069,
        "tcp_port": 0,
        "listen_on": "0.0.0.0",
        "broadcast_addr": "255.255.255.255",
    },
    "db": {"path": str(Path.home() / ".local" / "share" / "sesh" / "messages.db")},
    "crypto": {"key_dir": str(Path.home() / ".config" / "sesh")},
}


class Config:
    def __init__(self, data: dict):
        self.identity = data["identity"]
        self.network = data["network"]
        self.db = data["db"]
        self.crypto = data["crypto"]

    @classmethod
    def load_or_default(cls) -> "Config":
        path = Path.home() / ".config" / "sesh" / "config.toml"
        if path.exists():
            with open(path, "rb") as f:
                data = tomllib.load(f)
            merged = cls._deep_merge(DEFAULT_CONFIG, data)
            return cls(merged)

        path.parent.mkdir(parents=True, exist_ok=True)
        toml_str = DEFAULT_TOML.format(
            username=DEFAULT_CONFIG["identity"]["username"],
            db_path=DEFAULT_CONFIG["db"]["path"],
            key_dir=DEFAULT_CONFIG["crypto"]["key_dir"],
        )
        path.write_text(toml_str)
        return cls(DEFAULT_CONFIG)

    @staticmethod
    def _deep_merge(base: dict, override: dict) -> dict:
        result = {}
        for key in base:
            if key in override:
                if isinstance(base[key], dict) and isinstance(override[key], dict):
                    result[key] = {**base[key], **override[key]}
                else:
                    result[key] = override[key]
            else:
                result[key] = base[key]
        for key in override:
            if key not in result:
                result[key] = override[key]
        return result
