---
name: korus-skin
description: Create, edit, apply, reload or disable a custom Korus skin. Use for the app's appearance, not styling a website or generated artifact.
---

# Custom skins

Author a T3 v1 JSON skin, then use `set-skin`. Appearance belongs to the connected
desktop client, not the agent's runtime or other clients. Creating a skin does not
require changing application source or restarting the app.

## Create and apply

Choose a stable source name using 1–64 lowercase letters, digits or hyphens.
The definition's `name` is the human-readable label. Supply the definition to save
and apply it:

```json
{
  "name": "ocean",
  "definition": {
    "version": 1,
    "name": "Ocean",
    "appearance": "dark",
    "colors": {
      "canvas": "#07151f",
      "text": "#e5f5fa",
      "textMuted": "#9ab7c5",
      "accent": "#5ad6ce",
      "accentForeground": "#07151f",
      "surface": "#102532",
      "surfaceRaised": "#193543",
      "surfaceOverlay": "#102532",
      "sidebar": "#091d28",
      "border": "#2c4c5d",
      "messageSurface": "#173746",
      "messageForeground": "#e5f5fa"
    },
    "css": "[data-chat-canvas]{background-image:radial-gradient(ellipse at top right,#18435855,transparent 65%)}"
  }
}
```

Sources are saved as `<name>.json` in the desktop's `~/.korus/skins` folder, where
they also appear under Local skins in Settings → Appearance. The result includes
the saved JSON `path` and small metadata. Keep the source file editable. On the
same host you can edit that file; from a remote workspace, send the updated
definition through the tool. The returned path belongs to the desktop.

- Reload from disk, including the already-active skin: `set-skin({"name":"ocean"})`.
- Replace and apply: call with the same name and an updated `definition`.
- Disable: `set-skin({"name":null})`. The file remains available; the prior palette
  and Light/Dark/System preference return.

Apply when the user asks to use or try the skin. Authoring advice alone should not
change their appearance. Do not treat saving a source as publishing to T3 Skins.

## Format and rendering

`appearance` is `light` or `dark`. `colors` maps role names to literal CSS colors;
use hex or supported RGB/HSL/OKLCH color functions, not `var()` expressions.
Keep text, muted text and interactive states readable. Distinguish canvas, raised
surfaces and menu surfaces. Use opaque menu palette colors.

Optional `variants.light` and `variants.dark` hold complete color-role maps for
each appearance. System mode follows a supported variant; a single-appearance
skin uses its own appearance without overwriting the user's mode preference.

Optional `css` adds visual effects through these T3 hooks:

| Surface | Selector |
| --- | --- |
| Conversation canvas | `[data-chat-canvas]` |
| Conversation layout | `[data-workspace-area="conversation"]` |
| Sidebar | `[data-slot="sidebar-inner"]` |
| Composer | `[data-slot="composer-host"]` |
| User bubble | `[data-user-message-bubble]` |
| Assistant message | `[data-message-role="assistant"]` |
| Popup | `[data-slot="menu-popup"]`, `[data-slot="popover-popup"]` |

Document backgrounds on `html`/`body`, embedded data images, gradients, keyframes
and media queries are supported. Put reduced-motion alternatives behind
`prefers-reduced-motion`. CSS external resources, imports, fonts and unchecked
at-rules are filtered; a remote image URL will not work. Keep the entire MCP
request below 1 MiB, including embedded images and JSON escaping.

Korus preserves square sidebar outer corners, shelf attachment to the composer,
opaque popup surfaces and the single outer popup border. Do not rely on composer
margins, transparent menus or borders on embedded menu contents for the design.

## Verify

Inspect the rendered conversation, user and assistant text, tool labels, composer,
queue/goal shelf and an open menu. Check hovered and selected controls as well as
the background. Match the user's requested style while preserving legibility.
After each source edit call `set-skin` again; saving the JSON alone does not reload
the active snapshot. Do not claim visual verification from a successful tool call.
