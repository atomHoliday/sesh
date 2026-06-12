# Sesh TODO

## Phase 1: Rich Text Features

### 1.1 Emoji Picker

- Add `😀` button next to Send button in input area
- Use `GtkEmojiChooser` (built into GTK4)
- Selected emoji inserts into text entry as Unicode
- No D-Bus/DB changes — emoji are plain text in existing `SendMessage`
- **Files:** `panelMenu.js`, `stylesheet.css`

### 1.2 GIFs (Tenor API, hardcoded key)

- Add GIF button next to emoji button
- Clicking opens search popup (search entry + thumbnail grid)
- **API:** Tenor (free tier, Google-owned, same as Google Messages)
- **API key:** Hardcoded in extension code
- **Message format:** JSON envelope in existing `content` field:
  ```json
  {"type": "gif", "url": "https://tenor.com/view/..."}
  ```
  Text messages stay plain strings or `{"type": "text", "text": "..."}`
- **Rendering:** Replace `St.Label` with custom widget:
  - Text → `St.Label` (with Pango markup for bold/italic/etc.)
  - GIF → `St.Image` loaded from URL via `Clutter.Image`
- **Files:** `panelMenu.js` (refactor `_addMessage`), new `gifSearch.js` (API client + popup), `stylesheet.css`
- **No DB schema changes** — content column stores JSON
- **No D-Bus changes** — content is opaque

### 1.3 Reactions

- **Interaction:** Hover over message → small `+` button appears → click opens mini emoji picker (👍 ❤️ 😂 😮 😢 😡)
- **D-Bus additions:**
  - Method: `AddReaction(string message_id, string emoji)` → void
  - Method: `RemoveReaction(string message_id, string emoji)` → void
  - Method: `GetReactions(string message_id)` → `a(ss)` (emoji, peer_id)
  - Signal: `ReactionAdded(string message_id, string peer_id, string emoji)`
  - Signal: `ReactionRemoved(string message_id, string peer_id, string emoji)`
- **DB additions:**
  ```sql
  CREATE TABLE reactions (
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (message_id, emoji, peer_id),
      FOREIGN KEY (message_id) REFERENCES messages(id)
  );
  ```
- **UI:** Small emoji badges below message bubble, grouped by emoji with count
- **Files:** `db.py`, `sesh-daemon.py`, `dbusClient.js`, `panelMenu.js`, `stylesheet.css`

---

## Phase 2: Status & Settings

### 2.1 Status Selection

- **Options:** Online, Away, Lunch (or Do Not Disturb), Custom (user-typed text)
- **UI:** Dropdown in main menu (below the "S" icon or in a settings area)
- **D-Bus:**
  - Method: `SetPresence(string status, string message)` → void
  - Method: `GetPresence()` → `(string status, string message)`
  - Signal: `PresenceChanged(string peer_id, string status, string message)`
- **Network:** Include status + message in UDP presence broadcast
- **Config:** Store last-used status in `~/.config/sesh/config.toml`
- **Files:** `panelMenu.js`, `sesh-daemon.py`, `dbusClient.js`, `config.py`, `p2p.py`

### 2.2 LAN/WAN Settings

- **Config option:** `network.mode = "lan" | "wan"` in `config.toml`
- **LAN mode (current):** UDP broadcast on port 42069, automatic discovery
- **WAN mode:**
  - No UDP broadcast — peers connect by IP/hostname
  - New D-Bus method: `AddPeer(string host, int port)` to manually add a remote peer
  - New D-Bus method: `RemovePeer(string peer_id)`
  - TCP-only communication (existing `TcpMessenger`)
  - Config stores saved peers: `network.peers = [{host, port, name}]`
- **UI:** Settings section in menu: toggle LAN/WAN, in WAN mode show "Add Peer" form
- **Files:** `config.py`, `sesh-daemon.py`, `dbusClient.js`, `panelMenu.js`, `p2p.py`

---

## Phase 3: Group Chat

### 3.1 Basic Group Chat

- **D-Bus additions:**
  - Method: `CreateGroup(string name)` → `string group_id`
  - Method: `JoinGroup(string group_id)` → void
  - Method: `LeaveGroup(string group_id)` → void
  - Method: `SendGroupMessage(string group_id, string content)` → `string msg_id`
  - Method: `GetGroupMessages(string group_id, int limit)` → `a(ssssu)` (id, sender_id, sender_name, content, timestamp)
  - Method: `ListGroups()` → `a(sss)` (group_id, name, member_count)
  - Signal: `GroupMessageReceived(string group_id, string sender_id, string sender_name, string content, string msg_id)`
  - Signal: `GroupMemberJoined(string group_id, string peer_id, string username)`
  - Signal: `GroupMemberLeft(string group_id, string peer_id, string username)`
- **DB additions:**
  ```sql
  CREATE TABLE groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
  );

  CREATE TABLE group_members (
      group_id TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, peer_id),
      FOREIGN KEY (group_id) REFERENCES groups(id)
  );

  CREATE TABLE group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id)
  );
  ```
- **Network:** Group messages relayed to all group members via TCP
- **UI:** "Groups" section in main menu → create/join → group chat view (similar to 1-on-1 but shows sender names)
- **Files:** `db.py`, `sesh-daemon.py`, `dbusClient.js`, `panelMenu.js`, `stylesheet.css`

### 3.2 Forum Mode (Persistent Named Rooms)

- Groups can be marked as "forum" mode — persistent, named, exportable
- **D-Bus additions:**
  - Method: `SetGroupForumMode(string group_id, bool enabled)` → void
  - Method: `ExportGroupMessages(string group_id, string format)` → `string` (formatted text)
    - Formats: `"markdown"`, `"html"`, `"plaintext"`
- **Export formats:**
  - **Markdown:** Ready to paste into Reddit, GitHub, etc.
    ```markdown
    ## gnome 50 help
    **alice** (12:34): how do I fix the panel?
    **bob** (12:35): try restarting gnome-shell
    ```
  - **HTML:** For forums that accept HTML
  - **Plaintext:** Basic dump
- **UI:** In group settings → "Export" button → copy to clipboard or save to file
- **Files:** `sesh-daemon.py`, `panelMenu.js`

---

## Summary

| Feature | New Files | Modified Files | DB Changes | D-Bus Changes |
|---------|-----------|----------------|------------|---------------|
| Emoji picker | — | `panelMenu.js`, `stylesheet.css` | No | No |
| GIFs | `gifSearch.js` | `panelMenu.js`, `stylesheet.css` | No | No |
| Reactions | — | `db.py`, `sesh-daemon.py`, `dbusClient.js`, `panelMenu.js`, `stylesheet.css` | Yes | Yes (3 methods, 2 signals) |
| Status selection | — | `panelMenu.js`, `sesh-daemon.py`, `dbusClient.js`, `config.py`, `p2p.py` | No | Yes (2 methods, 1 signal) |
| LAN/WAN settings | — | `config.py`, `sesh-daemon.py`, `dbusClient.js`, `panelMenu.js`, `p2p.py` | No | Yes (2 methods) |
| Group chat | — | `db.py`, `sesh-daemon.py`, `dbusClient.js`, `panelMenu.js`, `stylesheet.css` | Yes (3 tables) | Yes (8 methods, 3 signals) |
| Forum mode + export | — | `sesh-daemon.py`, `panelMenu.js` | No | Yes (2 methods) |

## Implementation Order

1. Emoji picker (quick win)
2. Status selection (small, improves UX)
3. GIFs (medium, requires widget refactor)
4. Reactions (medium, spans stack)
5. Typing indicators (small, nice polish)
6. LAN/WAN settings (medium, config + UI)
7. Group chat (large, new concept)
8. Forum mode + export (extends group chat)
