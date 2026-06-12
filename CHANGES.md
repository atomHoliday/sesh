# Sesh Changelog

## 2026-06-12

### Fixed: Menu doesn't open on click (GNOME 50)

**Error:** Clicking the "S" panel icon does nothing. `_clickGesture.recognize`
fires repeatedly but `open-state-changed` never fires. Menu never appears.

**Root cause:** GNOME 50's `PopupMenu.open()` has an `isEmpty()` guard:

```javascript
open(animate) {
    if (this.isOpen) return;
    if (this.isEmpty()) return;  // ← returns early if no menu items
    // ...
    this.emit('open-state-changed', true);
}
```

We only populate menu items in `_onMenuOpen()`, which is called from the
`open-state-changed` handler. This creates a chicken-and-egg problem: the menu
can never open because it's empty, and items are only added when it opens.

**Fix:** Pre-populate the menu in `_init()` with a hidden placeholder item so
`isEmpty()` returns false on the first click. `_onMenuOpen()` clears everything
and rebuilds the menu on every open, so the placeholder is immediately replaced.

**Testing notes:** See `panelMenu.js` TROUBLESHOOTING NOTES for a numbered list
of what to check if clicks still break in a future GNOME version.

## 2026-06-11

### Fixed: Extension not loading (no 'S' icon in panel)

**Error:** `Error: Tried to construct an object without a GType`

**Root cause:** `SeshPanelButton` in `panelMenu.js` extends `PanelMenu.Button`, which is a
GObject subclass. GJS requires any JavaScript class extending a GObject type to be
registered with the GObject type system via `GObject.registerClass()` before it can be
instantiated.

**Fix:** In `panelMenu.js`:
1. Added `import GObject from 'gi://GObject'` to imports
2. Added `static { GObject.registerClass(this); }` inside the class body

This uses the static class block pattern (supported since GJS 1.72 / GNOME 42), which is
the standard approach for GNOME 45+ ESM extensions. The class is still exported as a
named export (`export class SeshPanelButton`).

**After applying:** Restart GNOME Shell (Alt+F2 → `r` on X11, or re-login on Wayland).

### Note

If this error reappears in the future, it means a class extending a GObject type
(PanelMenu.Button, PopupMenu.PopupMenuItem, St.Widget, etc.) is missing its
`GObject.registerClass()` registration. Every GObject subclass needs this. The pattern is:

```javascript
import GObject from 'gi://GObject';

export class MyWidget extends PanelMenu.Button {
  static {
    GObject.registerClass(this);
  }
  // ... rest of class
}
```
