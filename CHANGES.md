# Sesh Changelog

## 2026-06-12

### Fixed: Menu doesn't open on click (GNOME 50) — second attempt

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

**First fix attempt (broken):** Pre-populate with a hidden placeholder item
(`placeholder.actor.visible = false`) so `isEmpty()` returns false. This did
NOT work because GNOME 50's `isEmpty()` checks `child.visible` — invisible
items are not counted. The placeholder was invisible, so `isEmpty()` still
returned true.

**Second fix (this):** Keep the placeholder VISIBLE. GNOME 50's `isEmpty()`
checks `child.visible` to count children. A visible (but non-reactive)
placeholder makes `isEmpty()` return false. `_onMenuOpen()` immediately clears
and rebuilds the menu on open, so the placeholder is replaced within one frame.

**Key insight from GNOME 50 source (`popupMenu.js`):**
```javascript
function isPopupMenuItemVisible(child) {
    if (child._delegate instanceof PopupMenuSection) {
        if (child._delegate.isEmpty()) return false;
    }
    return child.visible;  // ← must be true for the item to count
}

isEmpty() {
    const hasVisibleChildren = this.box.get_children().some(child => {
        if (child._delegate instanceof PopupSeparatorMenuItem) return false;
        return isPopupMenuItemVisible(child);
    });
    return !hasVisibleChildren;
}
```

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
