import asyncio
import json
import struct
import time
from dataclasses import dataclass

DISCOVERY_MAGIC = b"sesh_discv1"


@dataclass
class PeerPresence:
    peer_id: str
    username: str
    public_key: bytes
    tcp_port: int
    timestamp: float


class PeerDiscovery:
    def __init__(self, config: dict, my_presence: PeerPresence):
        self._config = config
        self._my = my_presence
        self._peers: dict[str, tuple[PeerPresence, str]] = {}
        self._on_discover = None
        self._on_timeout = None

    def set_callbacks(self, on_discover, on_timeout):
        self._on_discover = on_discover
        self._on_timeout = on_timeout

    async def run(self):
        loop = asyncio.get_running_loop()
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _DiscoveryProtocol(self),
            local_addr=(self._config["listen_on"], self._config["discovery_port"]),
            allow_broadcast=True,
            reuse_port=True,
        )
        self._transport = transport
        return transport

    def broadcast_presence(self):
        msg = json.dumps({
            "magic": DISCOVERY_MAGIC.decode(),
            "peer_id": self._my.peer_id,
            "username": self._my.username,
            "public_key": self._my.public_key.hex(),
            "tcp_port": self._my.tcp_port,
            "timestamp": time.time(),
        }).encode()
        self._transport.sendto(msg, (self._config["broadcast_addr"], self._config["discovery_port"]))

    def handle_datagram(self, data: bytes, addr: tuple[str, int]):
        try:
            msg = json.loads(data)
            if msg.get("magic") != DISCOVERY_MAGIC.decode():
                return
            if msg["peer_id"] == self._my.peer_id:
                return
            presence = PeerPresence(
                peer_id=msg["peer_id"],
                username=msg["username"],
                public_key=bytes.fromhex(msg["public_key"]),
                tcp_port=msg["tcp_port"],
                timestamp=msg.get("timestamp", time.time()),
            )
            is_new = presence.peer_id not in self._peers
            self._peers[presence.peer_id] = (presence, addr[0])
            if is_new and self._on_discover:
                self._on_discover(presence)
        except (json.JSONDecodeError, KeyError, ValueError):
            pass

    def cleanup_stale(self, timeout: float = 120.0):
        now = time.time()
        stale = []
        for pid, (presence, ip) in list(self._peers.items()):
            if now - presence.timestamp > timeout:
                stale.append((pid, presence))
                del self._peers[pid]
        for pid, presence in stale:
            if self._on_timeout:
                self._on_timeout(presence)

    def get_peers(self) -> list[tuple[PeerPresence, str]]:
        return list(self._peers.values())


class _DiscoveryProtocol(asyncio.DatagramProtocol):
    def __init__(self, discovery: PeerDiscovery):
        self._discovery = discovery

    def datagram_received(self, data: bytes, addr):
        self._discovery.handle_datagram(data, addr)


class TcpMessenger:
    def __init__(self, on_message):
        self._on_message = on_message
        self._server = None

    async def start(self, host: str, port: int) -> int:
        self._server = await asyncio.start_server(
            self._handle_client, host, port,
        )
        sock = self._server.sockets[0]
        return sock.getsockname()[1]

    async def send_message(self, host: str, port: int, data: bytes):
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=5
            )
            header = struct.pack("!I", len(data))
            writer.write(header + data)
            await writer.drain()
            writer.close()
            await writer.wait_closed()
        except (ConnectionRefusedError, TimeoutError, OSError):
            pass

    async def _handle_client(self, reader, writer):
        try:
            header = await asyncio.wait_for(reader.readexactly(4), timeout=10)
            length = struct.unpack("!I", header)[0]
            data = await asyncio.wait_for(reader.readexactly(length), timeout=30)
            peer_addr = writer.get_extra_info("peername")[0]
            if self._on_message:
                await self._on_message(peer_addr, data)
        except (asyncio.IncompleteReadError, TimeoutError, ConnectionError):
            pass
        finally:
            writer.close()

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()
