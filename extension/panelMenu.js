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

    this.menu.connect('open-state-changed', (menu, isOpen) => {
      if (isOpen) this._onMenuOpen();
    });

    // GNOME 50: PanelMenu.Button default click handling is broken.
    // Disable the built-in click gesture and handle clicks manually.
    // If the menu stops opening, check if _clickGesture still exists
    // or if GNOME changed the click handling mechanism.
    if (this._clickGesture)
      this._clickGesture.set_enabled(false);

    // FIX (2026-06-11): vfunc_button_press_event was not firing on click
    // despite being defined. Neither _clickGesture disable nor the
    // vfunc override worked — clicking the panel icon did nothing.
    // The fix is connecting to St.Button's `clicked` signal directly,
    // which is the standard signal for St.Button (the base class of
    // PanelMenu.Button). This works across GNOME versions because
    // `clicked` is part of the St.Button public API, unlike
    // _clickGesture (private) and vfunc_button_press_event (Clutter
    // event routing, which GNOME can change without notice).
    // If clicks break again, check:
    //   1. Is `clicked` signal still emitted by St.Button?
    //   2. Has PanelMenu.Button stopped extending St.Button?
    //   3. Does this.menu still exist at signal-connection time?
    this.connect('clicked', () => this.menu.toggle());
  }

  // Manual click handler — kept as fallback. Was not firing on GNOME 50
  // despite being correctly defined. The `clicked` signal above is the
  // reliable path. If vfunc_button_press_event starts working again in
  // a future GNOME version, it will fire *in addition to* `clicked`,
  // which could double-toggle the menu. In that case, remove the
  // `this.connect('clicked', ...)` line above and rely on this vfunc.
  vfunc_button_press_event(event) {
    if (event.get_button() === 1) {
      this.menu.toggle();
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
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
