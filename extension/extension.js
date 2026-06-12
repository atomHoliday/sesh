import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { makeDbusClient } from './dbusClient.js';
import { SeshPanelButton } from './panelMenu.js';

export default class SeshExtension extends Extension {
  enable() {
    try {
      this._dbus = makeDbusClient({
        onPeerOnline: (peerId, username) => {
          if (this._panelBtn) this._panelBtn.onPeerOnline(peerId, username);
        },
        onPeerOffline: (peerId, username) => {
          if (this._panelBtn) this._panelBtn.onPeerOffline(peerId, username);
        },
        onMessageReceived: (peerId, username, content, msgId) => {
          if (this._panelBtn)
            this._panelBtn.onMessageReceived(peerId, username, content, msgId);
        },
        onPresenceChanged: (_status, _statusMessage) => {
          if (this._panelBtn && this._panelBtn.menu.isOpen && !this._panelBtn._chatPeerId) {
            this._panelBtn._onMenuOpen();
          }
        },
      });

      this._panelBtn = new SeshPanelButton(this._dbus);
      Main.panel.addToStatusArea('sesh', this._panelBtn, 0, 'right');
    } catch (e) {
      // If you see "sesh enable error" in journalctl, check:
      //   - Is GObject imported? (import GObject from 'gi://GObject')
      //   - Does SeshPanelButton have GObject.registerClass()?
      //   - Are all gi:// imports valid for your GNOME version?
      console.error('sesh enable error:', e, e.stack);
    }
  }

  disable() {
    if (this._panelBtn) {
      this._panelBtn.destroy();
      this._panelBtn = null;
    }
    if (this._dbus) {
      this._dbus.destroy();
      this._dbus = null;
    }
  }
}
