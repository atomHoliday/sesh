import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { makeDbusClient } from './dbusClient.js';
import { SeshPanelButton } from './panelMenu.js';

// ═══════════════════════════════════════════════════════════════════
// SESH EXTENSION — TROUBLESHOOTING NOTES
// ═══════════════════════════════════════════════════════════════════
//
// Common issues and how to debug:
//
// 1. "Tried to construct an object without a GType"
//    → A GObject subclass is missing GObject.registerClass().
//    → Every class extending PanelMenu.Button, PopupMenu, St.Widget, etc.
//      needs `static { GObject.registerClass(this); }` in the class body.
//
// 2. Extension icon appears but menu doesn't open on click
//    → Check panelMenu.js: vfunc_button_press_event must exist.
//    → Check that _clickGesture is disabled in _init.
//    → GNOME versions may change how PanelMenu.Button handles clicks.
//    → FIX (2026-06-11): Neither _clickGesture disable nor
//      vfunc_button_press_event fired on GNOME 50. The fix was
//      connecting to the `clicked` signal on `this` (St.Button API),
//      which is the reliable click path across GNOME versions.
//      See panelMenu.js _init() for the fix and full notes.
//
// 3. "Daemon unreachable" shown in menu
//    → The D-Bus daemon (com.sesh.Daemon) is not running.
//    → Start it: systemctl --user start sesh.service
//    → Check logs: journalctl --user -u sesh.service -f
//    → Verify D-Bus name: busctl --user list | grep sesh
//
// 4. Peers never appear online
//    → Daemon must be running on both machines.
//    → UDP broadcast on port 42069 must not be blocked by firewall.
//    → Both machines must be on the same LAN subnet.
//    → Check: sudo ss -ulnp | grep 42069
//
// 5. Messages fail to send / appear as "Daemon unreachable"
//    → TCP connection to peer failed.
//    → Check if peer's firewall blocks the TCP port.
//    → Check daemon logs for "failed to process message" warnings.
//
// 6. Extension crashes on GNOME Shell reload (Alt+F2 → r)
//    → Check journalctl -b -p err | grep -i sesh
//    → Ensure extension files are in the correct location:
//      ~/.local/share/gnome-shell/extensions/sesh@sesh.local/
//    → Ensure metadata.json shell-version includes your GNOME version.
//
// 7. D-Bus signal not received by extension
//    → Verify D-Bus service file is installed:
//      ls ~/.local/share/dbus-1/services/com.sesh.Daemon.service
//    → Reload D-Bus: dbus-send --session --type=method_call \
//        --dest=org.freedesktop.DBus /org/freedesktop/DBus \
//        org.freedesktop.DBus.ReloadConfig
//
// 8. GNOME 50 specific: Clutter API changes
//    → Use Clutter.Orientation.VERTICAL (not bare integer 1).
//    → Use add_child() not add_actor().
//    → Use vadjustment not vscroll.adjustment.
// ═══════════════════════════════════════════════════════════════════

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
