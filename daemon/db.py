import sqlite3
from pathlib import Path
from dataclasses import dataclass


@dataclass
class StoredMessage:
    id: str
    peer_id: str
    is_outgoing: bool
    content: str
    timestamp: int
    delivered: bool


class MessageStore:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                peer_id TEXT NOT NULL,
                is_outgoing INTEGER NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                delivered INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_messages_peer_id ON messages(peer_id);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        """)
        self._conn.commit()

    def store_message(self, id: str, peer_id: str, is_outgoing: bool, content: str, timestamp: int):
        self._conn.execute(
            "INSERT OR IGNORE INTO messages (id, peer_id, is_outgoing, content, timestamp, delivered) VALUES (?, ?, ?, ?, ?, 0)",
            (id, peer_id, int(is_outgoing), content, timestamp),
        )
        self._conn.commit()

    def get_conversation(self, peer_id: str, limit: int = 50) -> list[StoredMessage]:
        cur = self._conn.execute(
            "SELECT id, peer_id, is_outgoing, content, timestamp, delivered FROM messages WHERE peer_id = ? ORDER BY timestamp ASC LIMIT ?",
            (peer_id, limit),
        )
        return [
            StoredMessage(id=row[0], peer_id=row[1], is_outgoing=bool(row[2]), content=row[3], timestamp=row[4], delivered=bool(row[5]))
            for row in cur.fetchall()
        ]

    def mark_delivered(self, id: str):
        self._conn.execute("UPDATE messages SET delivered = 1 WHERE id = ?", (id,))
        self._conn.commit()

    def all_conversations(self) -> list[str]:
        cur = self._conn.execute("SELECT DISTINCT peer_id FROM messages ORDER BY peer_id")
        return [row[0] for row in cur.fetchall()]
