import GObject from 'gi://GObject';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

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

    this._addPlaceholder();

    this.menu.connect('open-state-changed', (_menu, isOpen) => {
      if (isOpen) this._onMenuOpen();
    });
  }

  async _onMenuOpen() {
    this._clearMenu();
    // Re-add visible placeholder after every clear so isEmpty() never
    // returns true. _renderMainMenu/_renderChatView add real items below,
    // and the placeholder is non-reactive so it doesn't interfere.
    // This also guards against the race where _renderMainMenu's async
    // D-Bus call yields while the menu is empty.
    this._addPlaceholder();
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

  // Adds a visible, non-reactive placeholder so GNOME 50's isEmpty()
  // guard never blocks open(). Must be visible — isEmpty() checks
  // child.visible. Must be non-reactive so clicks pass through.
  _addPlaceholder() {
    const placeholder = new PopupMenu.PopupMenuItem(' ', {
      reactive: false,
      can_focus: false,
    });
    this.menu.addMenuItem(placeholder);
  }

  _showCustomStatusDialog() {
    const dialog = new ModalDialog({
      styleClass: 'sesh-dialog',
    });

    const contentBox = new St.BoxLayout({
      vertical: true,
      style_class: 'sesh-dialog-content',
    });

    const label = new St.Label({
      text: 'Enter custom status:',
      style_class: 'sesh-dialog-label',
    });
    contentBox.add_child(label);

    const entry = new St.Entry({
      style_class: 'sesh-dialog-entry',
      hint_text: 'What are you up to?',
      can_focus: true,
    });
    contentBox.add_child(entry);

    const buttonBox = new St.BoxLayout({
      style_class: 'sesh-dialog-buttons',
    });

    const cancelBtn = new St.Button({
      style_class: 'sesh-dialog-cancel-btn',
      label: 'Cancel',
    });
    cancelBtn.connect('clicked', () => dialog.close());

    const okBtn = new St.Button({
      style_class: 'sesh-dialog-ok-btn',
      label: 'Set',
    });
    okBtn.connect('clicked', async () => {
      const text = entry.text.trim();
      try {
        await this._dbus.setPresence('custom', text);
      } catch (e) {
        console.error('sesh: set presence failed', e);
      }
      dialog.close();
      this._onMenuOpen();
    });

    buttonBox.add_child(cancelBtn);
    buttonBox.add_child(okBtn);
    contentBox.add_child(buttonBox);

    dialog.contentLayout.add_child(contentBox);
    entry.clutter_text.connect('activate', async () => {
      const text = entry.text.trim();
      try {
        await this._dbus.setPresence('custom', text);
      } catch (e) {
        console.error('sesh: set presence failed', e);
      }
      dialog.close();
      this._onMenuOpen();
    });

    dialog.open(global.get_current_time());
  }

  async _renderMainMenu() {
    const statusSection = new PopupMenu.PopupMenuSection();
    const statusHeader = new PopupMenu.PopupMenuItem('Status', {
      reactive: false,
      can_focus: false,
    });
    statusHeader.actor.style = 'font-weight: bold; padding: 4px 12px;';
    statusSection.addMenuItem(statusHeader);

    const statusItems = [
      { label: '🟢 Online', status: 'online' },
      { label: '🟡 Away', status: 'away' },
      { label: '🟠 Lunch', status: 'lunch' },
      { label: '🔴 Custom...', status: 'custom' },
    ];

    try {
      const [currentStatus] = await this._dbus.getPresence();
      for (const item of statusItems) {
        const menuItem = new PopupMenu.PopupMenuItem(
          currentStatus === item.status ? `  ✓ ${item.label}` : `  ${item.label}`
        );
        menuItem.connect('activate', async () => {
          if (item.status === 'custom') {
            this._showCustomStatusDialog();
          } else {
            try {
              await this._dbus.setPresence(item.status, '');
              this._onMenuOpen();
            } catch (e) {
              console.error('sesh: set presence failed', e);
            }
          }
        });
        statusSection.addMenuItem(menuItem);
      }
    } catch (err) {
      console.error('sesh: get presence failed', err);
      const item = new PopupMenu.PopupMenuItem('Daemon unreachable');
      item.actor.reactive = false;
      statusSection.addMenuItem(item);
    }

    this.menu.addMenuItem(statusSection);
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

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
    const emojiBtn = new St.Button({
      style_class: 'sesh-emoji-btn',
      label: '\u{1F600}',
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

    emojiBtn.connect('clicked', () => {
      const emojiPicker = new Gtk.EmojiChooser();
      emojiPicker.connect('emoji_picked', (_widget, emoji) => {
        entry.text += emoji;
      });
      emojiPicker.set_relative_to(emojiBtn);
      emojiPicker.popup();
    });

    inputBox.add_child(entry);
    inputBox.add_child(emojiBtn);
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
