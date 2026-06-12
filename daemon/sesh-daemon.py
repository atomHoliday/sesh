#!/usr/bin/env python3
import asyncio
import json
import logging
import os
import secrets
import signal
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

import re

from config import Config
from crypto import SeshCrypto
from db import MessageStore
from p2p import PeerDiscovery, PeerPresence, TcpMessenger

BUS_NAME = "com.sesh.Daemon"
BUS_PATH = "/com/sesh/Daemon"
IFACE_NAME = BUS_NAME
PRESENCE_INTERVAL = 30
PRESENCE_TIMEOUT = 120

log = logging.getLogger("sesh-daemon")


class DbusApi(dbus.service.Object):
    def __init__(self, daemon, conn, path):
        self._d = daemon
        self._conn = conn
        super().__init__(conn, path)

    @dbus.service.method(IFACE_NAME, in_signature="ss", out_signature="s")
    def SendMessage(self, peer_id, content):
        return self._d.cmd_send_message(peer_id, content)

    @dbus.service.method(IFACE_NAME, in_signature="", out_signature="a(sss)")
    def GetOnlinePeers(self):
        return self._d.cmd_get_online_peers()

    @dbus.service.method(IFACE_NAME, in_signature="", out_signature="s")
    def GetMyPeerId(self):
        return self._d.cmd_get_my_peer_id()

    @dbus.service.method(IFACE_NAME, in_signature="su", out_signature="a(ssbstb)")
    def GetConversation(self, peer_id, limit):
        return self._d.cmd_get_conversation(peer_id, limit)

    @dbus.service.method(IFACE_NAME, in_signature="", out_signature="as")
    def ListConversations(self):
        return self._d.cmd_list_conversations()

    @dbus.service.method(IFACE_NAME, in_signature="ss", out_signature="")
    def SetPresence(self, status, status_message):
        self._d.cmd_set_presence(status, status_message)

    @dbus.service.method(IFACE_NAME, in_signature="", out_signature="ss")
    def GetPresence(self):
        return self._d.cmd_get_presence()

    @dbus.service.signal(IFACE_NAME, signature="ss")
    def PresenceChanged(self, status, status_message):
        pass

    @dbus.service.signal(IFACE_NAME, signature="ss")
    def PeerOnline(self, peer_id, username):
        pass

    @dbus.service.signal(IFACE_NAME, signature="ss")
    def PeerOffline(self, peer_id, username):
        pass

    @dbus.service.signal(IFACE_NAME, signature="ssss")
    def MessageReceived(self, peer_id, username, content, msg_id):
        pass

    def send_peer_online(self, peer_id, username):
        self.PeerOnline(peer_id, username)

    def send_peer_offline(self, peer_id, username):
        self.PeerOffline(peer_id, username)

    def send_message_received(self, peer_id, username, content, msg_id):
        self.MessageReceived(peer_id, username, content, msg_id)


class SeshDaemon:
    def __init__(self, config: Config):
        self._config = config
        self._config_path = Path.home() / ".config" / "sesh" / "config.toml"
        self._crypto = SeshCrypto.load_or_generate(config.crypto["key_dir"])
        self._store = MessageStore(config.db["path"])

        my_peer_id = self._gen_peer_id()
        log.info("peer id: %s", my_peer_id)

        presence = PeerPresence(
            peer_id=my_peer_id,
            username=config.identity["username"],
            public_key=self._crypto.public_key_bytes(),
            tcp_port=0,
            timestamp=time.time(),
            status=config.identity.get("status", "online"),
            status_message=config.identity.get("status_message", ""),
        )

        self._my_peer_id = my_peer_id
        self._discovery = PeerDiscovery(config.network, presence)
        self._messenger = TcpMessenger(self._on_tcp_message)
        self._discovery.set_callbacks(self._on_peer_discover, self._on_peer_timeout)
        self._dbus_api = None
        self._glib_loop = None

    @staticmethod
    def _gen_peer_id() -> str:
        raw = secrets.token_bytes(32)
        return "sesh_" + raw.hex()[:16]

    async def start(self):
        await self._discovery.run()
        actual_tcp_port = await self._messenger.start(
            self._config.network["listen_on"],
            self._config.network["tcp_port"],
        )
        log.info("tcp listening on port %d", actual_tcp_port)

        self._discovery._my.tcp_port = actual_tcp_port

        dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
        bus = dbus.SessionBus()
        ret = bus.request_name(BUS_NAME)
        if ret != dbus.bus.REQUEST_NAME_REPLY_PRIMARY_OWNER:
            log.warning("bus name request returned %d", ret)
        self._dbus_api = DbusApi(self, bus, BUS_PATH)
        log.info("dbus service registered: %s", BUS_NAME)

        self._glib_loop = GLib.MainLoop()
        glib_thread = threading.Thread(target=self._glib_loop.run, daemon=True)
        glib_thread.start()

    async def run_forever(self):
        loop = asyncio.get_running_loop()

        async def periodic():
            while True:
                await asyncio.sleep(PRESENCE_INTERVAL)
                self._discovery.broadcast_presence()
                self._discovery.cleanup_stale(PRESENCE_TIMEOUT)

        async def initial_broadcast():
            await asyncio.sleep(1)
            self._discovery.broadcast_presence()

        asyncio.create_task(periodic())
        asyncio.create_task(initial_broadcast())

        stop_future = loop.create_future()
        loop.add_signal_handler(signal.SIGINT, lambda: stop_future.cancel())
        loop.add_signal_handler(signal.SIGTERM, lambda: stop_future.cancel())

        try:
            await stop_future
        except asyncio.CancelledError:
            pass

    async def stop(self):
        if self._glib_loop:
            self._glib_loop.quit()
            self._glib_loop = None
        await self._messenger.stop()

    def _on_peer_discover(self, presence: PeerPresence):
        log.info("peer discovered: %s (%s)", presence.peer_id, presence.username)
        if self._dbus_api:
            self._dbus_api.send_peer_online(presence.peer_id, presence.username)

    def _on_peer_timeout(self, presence: PeerPresence):
        log.info("peer timed out: %s (%s)", presence.peer_id, presence.username)
        if self._dbus_api:
            self._dbus_api.send_peer_offline(presence.peer_id, presence.username)

    async def _on_tcp_message(self, peer_ip: str, data: bytes):
        try:
            msg = json.loads(data)
            peer_id = msg.get("sender_id")
            if not peer_id:
                return
            ciphertext_hex = msg.get("ciphertext")
            if not ciphertext_hex:
                return
            sender_pub_hex = msg.get("sender_pub")
            if not sender_pub_hex:
                return
            timestamp = msg.get("timestamp", int(time.time()))

            sender_pub = bytes.fromhex(sender_pub_hex)
            ciphertext = bytes.fromhex(ciphertext_hex)
            plaintext = self._crypto.decrypt(sender_pub, ciphertext)
            text = plaintext.decode("utf-8", errors="replace")

            log.info("message from %s: %s", peer_id, text)
            msg_id = secrets.token_hex(8)
            self._store.store_message(msg_id, peer_id, False, text, timestamp)

            username = ""
            for pid, (presence, _ip) in self._discovery._peers.items():
                if pid == peer_id:
                    username = presence.username
                    break

            if self._dbus_api:
                GLib.idle_add(
                    self._dbus_api.send_message_received,
                    peer_id, username, text, msg_id,
                )
        except Exception as e:
            log.warning("failed to process message from %s: %s", peer_ip, e)

    def cmd_send_message(self, peer_id: str, content: str) -> str:
        for pid, (presence, ip) in self._discovery._peers.items():
            if pid == peer_id:
                pubkey = presence.public_key
                ciphertext = self._crypto.encrypt(pubkey, content.encode())
                msg_id = secrets.token_hex(8)
                payload = json.dumps({
                    "sender_id": self._my_peer_id,
                    "sender_pub": self._crypto.public_key_bytes().hex(),
                    "ciphertext": ciphertext.hex(),
                    "timestamp": int(time.time()),
                }).encode()
                asyncio.run_coroutine_threadsafe(
                    self._messenger.send_message(ip, presence.tcp_port, payload),
                    asyncio.get_event_loop(),
                )
                self._store.store_message(
                    msg_id, peer_id, True, content, int(time.time())
                )
                return msg_id
        raise LookupError(f"peer {peer_id} not found")

    def cmd_get_online_peers(self) -> list[tuple[str, str, str]]:
        return [
            (p.username, p.peer_id, "Online")
            for p, _ in self._discovery.get_peers()
        ]

    def cmd_get_my_peer_id(self) -> str:
        return self._my_peer_id

    def cmd_get_conversation(self, peer_id: str, limit: int = 50) -> list:
        return [
            (m.id, m.peer_id, m.is_outgoing, m.content, m.timestamp, m.delivered)
            for m in self._store.get_conversation(peer_id, limit)
        ]

    def cmd_list_conversations(self) -> list[str]:
        return self._store.all_conversations()

    def cmd_set_presence(self, status: str, status_message: str):
        valid_statuses = ["online", "away", "lunch", "custom"]
        if status not in valid_statuses:
            status = "online"
        self._discovery._my.status = status
        self._discovery._my.status_message = status_message
        self._persist_status(status, status_message)
        self._discovery.broadcast_presence()
        if self._dbus_api:
            self._dbus_api.PresenceChanged(status, status_message)
        log.info("presence set to: %s (%s)", status, status_message)

    def _persist_status(self, status: str, status_message: str):
        try:
            text = self._config_path.read_text()
            text = re.sub(
                r'^(status\s*=\s*)"[^"]*"',
                f'\\1"{status}"',
                text,
                flags=re.MULTILINE,
            )
            text = re.sub(
                r'^(status_message\s*=\s*)"[^"]*"',
                f'\\1"{status_message}"',
                text,
                flags=re.MULTILINE,
            )
            self._config_path.write_text(text)
        except Exception as e:
            log.warning("failed to persist status to config: %s", e)

    def cmd_get_presence(self) -> tuple[str, str]:
        return (
            self._discovery._my.status,
            self._discovery._my.status_message,
        )


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    config = Config.load_or_default()
    daemon = SeshDaemon(config)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        loop.run_until_complete(daemon.start())
        log.info("sesh daemon started")
        loop.run_until_complete(daemon.run_forever())
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        loop.run_until_complete(daemon.stop())
        loop.close()


if __name__ == "__main__":
    main()
