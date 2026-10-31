---
name: korus-computer-use
description: Required procedure before using Korus Computer Use to interact with macOS apps.
---

# Computer Use

Use only {{mcpServerName}} tools; native Computer Use/sky.* target another host.

1. computer-use-status first; request Accessibility/Screen Recording only if needed.
2. Target the known app or discover/launch it. computer-use-list-windows → explicit window_id for state, screenshot, focus and actions. Refresh after window changes; never silently switch targets.
3. computer-use-get-app-state before decisions: full hierarchy first, per-window diffs later; stable element_index. Lost baseline: disableDiff=true. Keep traversal settings consistent; "=" lines are unchanged ancestors.
4. AX reads/clicks work in background: no focus-app. Clicks move the virtual cursor by default. physical=true moves the real cursor and leaves it at the target; use it only after observed AXPress failure. Physical input needs foreground. Keyboard input verifies the target without activation.
5. type-text with element_index verifies editable focus; replace/submit are explicit. Untargeted typing requires confirmed focus. Use paste for rich content.
6. accessibilityScope="menu_bar" reads need no window ID/screenshot; actions require window_id. Select AXMenuBarItem semantically; computer-use-dismiss before content/typing. No hover/mouse-move.
7. Batch deterministic actions; observe={} returns settled state, waitForText waits for a result. Check actionResult, settling.timedOut and UI before proceeding. Failed observation does not justify replaying non-idempotent input.
8. Observations default to text; includeScreenshot=true adds visuals. Coordinates are absolute macOS logical points, not preview pixels. rootElementIndex narrows AX; retain labels/values/controls, not matching text alone. Selectors target only the matched element; the helper does not infer task groups.
9. computer-use-stop when finished. Otherwise every call resets the 30-second idle timeout.
