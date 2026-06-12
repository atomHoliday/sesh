import GObject from 'gi://GObject';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

export class SeshPanelButton extends PanelMenu.Button {
  static {
    GObject.registerClass(this);
  }

  _init(dbusClient) {
    super._init(0.0, 'Sesh', false);
    this._dbus = dbusClient;
    this._conversations = {};
    this._chatPeerId = null;
    this._chatUsername = null;
    this._menuItems = [];

    const label = new St.Label({
      text: 'S',
      style_class: 'system-status-icon',
      y_align: Clutter.ActorAlign.CENTER,
    });
    this.add_child(label);

    // GNOME 50 FIX: PopupMenu.open() has an isEmpty() guard that returns
    // early if the menu has no children. We only populate items in
    // _onMenuOpen() (via open-state-changed), creating a chicken-and-egg
    // problem: menu can never open because it's empty, and items are only
    // added when it opens. Pre-populate with a hidden placeholder so
    // isEmpty() returns false on the first click. _onMenuOpen() clears
    // everything and rebuilds on open.
    const placeholder = new PopupMenu.PopupMenuItem(' ', {
      reactive: false,
      can_focus: false,
    });
    placeholder.actor.visible = false;
    this.menu.addMenuItem(placeholder);

    this.menu.connect('open-state-changed', (_menu, isOpen) => {
      if (isOpen) this._onMenuOpen();
    });

    // ═══════════════════════════════════════════════════════════════
    // TROUBLESHOOTING NOTES — GNOME 50 PanelMenu click handling
    // ═══════════════════════════════════════════════════════════════
    //
    // How it works:
    //   PanelMenu.Button._init creates a Clutter.ClickGesture and
    //   adds it as an action via add_action(). The gesture has
    //   set_recognize_on_press(true) and connects 'recognize' to
    //   this.menu?.toggle(). That's the ENTIRE click mechanism.
    //
    // If the menu doesn't open on click, check these in order:
    //
    //   1. isEmpty() guard: Does the menu have visible children?
    //      → open() returns early if isEmpty() is true. We fix this
    //        with a hidden placeholder item in _init().
    //
    //   2. _clickGesture exists and is enabled?
    //      → this._clickGesture?.get_enabled?.() should be true.
    //      → Do NOT disable it — it breaks the menu.
    //
    //   3. Does this.menu exist?
    //      → setMenu() must have been called (it is, via super._init).
    //
    //   4. PanelMenu.js source changes?
    //      → Check /usr/share/gnome-shell/js/ui/panelMenu.js
    //        (may be in gresource bundle) for changes to the Button
    //        class, _clickGesture setup, or toggle() call.
    //
    //   5. Conflicting signal handlers?
    //      → If another extension or code connects to _clickGesture
    //        'recognize' and returns EVENT_STOP, it could block the
    //        default handler. Check with:
    //          journalctl --user -b | grep "sesh"
    //
    //   6. PopupMenu.toggle() or open() overridden?
    //      → Check popupMenu.js for changes to open() or toggle().
    //
    // To add debug logging back, uncomment these lines:
    //   log('sesh DEBUG: _clickGesture.recognize fired!');
    //   log(`sesh DEBUG: open-state-changed isOpen=${isOpen}`);
    // ═══════════════════════════════════════════════════════════════
  }

  async _onMenuOpen() {
    this._clearMenu();
    try {
      if (this._chatPeerId) {
        this._renderChatView();
      } else {
        await this._renderMainMenu();
      }
    } catch (e) {
      console.error('sesh: menu render error', e);
    }
  }

  _clearMenu() {
    this.menu.removeAll();
    this._menuItems = [];
  }

  async _renderMainMenu() {
    const onlineSection = new PopupMenu.PopupMenuSection();
    const header = new PopupMenu.PopupMenuItem('Online', {
      reactive: false,
      can_focus: false,
    });
    header.actor.style = 'font-weight: bold; padding: 4px 12px;';
    onlineSection.addMenuItem(header);
    this.menu.addMenuItem(onlineSection);

    try {
      const peers = await this._dbus.getOnlinePeers();
      if (peers.length === 0) {
        const item = new PopupMenu.PopupMenuItem('No peers online');
        item.actor.reactive = false;
        onlineSection.addMenuItem(item);
      } else {
        for (const [username, peerId] of peers) {
          const item = new PopupMenu.PopupMenuItem(`● ${username}`);
          item.connect('activate', () => this._openChat(peerId, username));
          onlineSection.addMenuItem(item);
        }
      }
    } catch (err) {
      const item = new PopupMenu.PopupMenuItem('Daemon unreachable');
      item.actor.reactive = false;
      onlineSection.addMenuItem(item);
    }

    const chatIds = Object.keys(this._conversations);
    if (chatIds.length > 0) {
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const chatsHeader = new PopupMenu.PopupMenuItem('Active Chats', {
        reactive: false,
        can_focus: false,
      });
      chatsHeader.actor.style = 'font-weight: bold; padding: 4px 12px;';
      this.menu.addMenuItem(chatsHeader);
      for (const peerId of chatIds) {
        const conv = this._conversations[peerId];
        const item = new PopupMenu.PopupMenuItem(`💬 ${conv.username}`);
        item.connect('activate', () => this._openChat(peerId, conv.username));
        this.menu.addMenuItem(item);
      }
    }
  }

  _renderChatView() {
    const view = new PopupMenu.PopupMenuSection();

    const header = new St.BoxLayout({ style_class: 'sesh-header' });
    const backBtn = new St.Button({
      style_class: 'sesh-back-btn',
      label: '←',
    });
    backBtn.connect('clicked', () => {
      this._chatPeerId = null;
      this._chatUsername = null;
      this._onMenuOpen();
    });
    const title = new St.Label({
      text: `Chat with ${this._chatUsername}`,
      style_class: 'sesh-title',
    });
    header.add_child(backBtn);
    header.add_child(title);
    view.actor.add_child(header);

    const scrollView = new St.ScrollView({
      style_class: 'sesh-messages',
      reactive: true,
    });
    const messageBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, style_class: 'sesh-message-box' });
    scrollView.add_child(messageBox);
    view.actor.add_child(scrollView);

    const inputBox = new St.BoxLayout({ style_class: 'sesh-input-box' });
    const entry = new St.Entry({
      style_class: 'sesh-input',
      hint_text: 'Type a message...',
      can_focus: true,
    });
    const sendBtn = new St.Button({
      style_class: 'sesh-send-btn',
      label: 'Send',
    });

    const doSend = () => {
      const text = entry.text.trim();
      if (!text) return;
      this._dbus.sendMessage(this._chatPeerId, text);
      this._addMessage(messageBox, scrollView, 'You', text, true);
      entry.text = '';
    };

    sendBtn.connect('clicked', () => doSend());
    entry.clutter_text.connect('activate', () => doSend());

    inputBox.add_child(entry);
    inputBox.add_child(sendBtn);
    view.actor.add_child(inputBox);

    this.menu.addMenuItem(view);
    this._menuItems.push({ view, messageBox, scrollView });

    this._loadHistory(messageBox, scrollView);
  }

  async _loadHistory(messageBox, scrollView) {
    try {
      const msgs = await this._dbus.getConversation(this._chatPeerId, 50);
      for (const [, , isOutgoing, content] of msgs) {
        const sender = isOutgoing ? 'You' : this._chatUsername;
        this._addMessage(messageBox, scrollView, sender, content, isOutgoing);
      }
    } catch (err) {
      console.error('sesh: load history', err);
    }
  }

  _sanitize(text) {
    const MAX_LEN = 2000;
    let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    if (sanitized.length > MAX_LEN) {
      sanitized = sanitized.slice(0, MAX_LEN) + '\u2026';
    }
    return sanitized;
  }

  _addMessage(messageBox, scrollView, sender, text, isOwn) {
    const msg = new St.Label({
      text: `${sender}: ${this._sanitize(text)}`,
      style_class: isOwn ? 'sesh-msg-own' : 'sesh-msg-other',
    });
    messageBox.add_child(msg);
    scrollView.vadjustment.value = scrollView.vadjustment.upper;
  }

  _openChat(peerId, username) {
    this._chatPeerId = peerId;
    this._chatUsername = username;
    if (!this._conversations[peerId]) {
      this._conversations[peerId] = { username };
    }
    this.menu.close();
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this.menu.open();
      return GLib.SOURCE_REMOVE;
    });
  }

  // Called from extension.js when a peer comes online.
  // Parameters: peerId, username (passed from D-Bus signal PeerOnline).
  // If menu is open on the main list, refresh to show the new peer.
  onPeerOnline(_peerId, _username) {
    if (this.menu.isOpen && !this._chatPeerId) {
      this._onMenuOpen();
    }
  }

  onPeerOffline(peerId, username) {
    if (this._conversations[peerId]) {
      delete this._conversations[peerId];
    }
    if (this._chatPeerId === peerId) {
      this._chatPeerId = null;
      this._chatUsername = null;
    }
    if (this.menu.isOpen) {
      this._onMenuOpen();
    }
  }

  onMessageReceived(peerId, username, content, msgId) {
    if (!this._conversations[peerId]) {
      this._conversations[peerId] = { username };
    }

    if (this._chatPeerId === peerId) {
      for (const item of this._menuItems) {
        if (item.messageBox && item.scrollView) {
          this._addMessage(item.messageBox, item.scrollView, username, content, false);
        }
      }
    }

    Main.notify(`Sesh: ${username}`, content);
  }
}
