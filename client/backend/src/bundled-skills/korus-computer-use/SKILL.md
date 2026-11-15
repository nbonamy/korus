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
5. type-text with element_index verifies editable focus and focuses the control itself; replace/submit are explicit. Untargeted typing requires confirmed focus, and AX [focused] markers do not prove where keys go (a background Safari page can report its field focused while keys reach the address bar): after element_focus_failed use set-value, never untargeted typing. Use paste only for formatted Markdown/HTML, which apps usually accept only in the foreground.
6. Forms: fill-form takes fields in order (element_index plus one of text, checked for a checkbox/radio, option for a dropdown, value for a slider) and stops at the first failure. To see a dropdown's choices, read just that dropdown (get-app-state rootElementIndex): its line lists options=A|B|C; a wrong option returns the available choices. Never click a dropdown: it opens its menu over the user's screen.
7. accessibilityScope="menu_bar" reads need no window ID/screenshot; actions require window_id. Select AXMenuBarItem semantically; computer-use-dismiss before content/typing. No hover/mouse-move.
8. Batch deterministic actions; observe={} returns settled state, waitForText waits for a result. Check actionResult, settling.timedOut and UI before proceeding. Failed observation does not justify replaying non-idempotent input.
   With an exec code tool, minimize round trips: run each known sequence in one exec, awaiting computer-use tools in order from the global `tools` object (`tools.mcp__{{mcpServerName}}__computer_use_click`, `…_type_text`, `…_get_app_state`; no need to search ALL_TOOLS). Combine discovery (status, list-windows, get-app-state) in the first exec; afterwards chain actions and finish with one observation. Stop the script at the first failed result and return it. Print observations with `text(result.structuredContent.text)`.
9. Observations default to text; includeScreenshot=true adds visuals. Coordinates are absolute macOS logical points, not preview pixels. rootElementIndex narrows AX; retain labels/values/controls, not matching text alone. Selectors target only the matched element; the helper does not infer task groups. Pass label (the control's visible name, e.g. "First Name") on element actions and fill-form fields: the user sees it instead of the element number.
10. File open/save dialogs are sheets of their window: keep the same window_id. Press Super+Shift+g to open Go To, then type the full path into the Go To field with type-text (replace: true, submit: true). Verify the selected filename and the enabled Open/Upload button, then press Return to confirm.
11. computer-use-stop when finished. Otherwise every call resets the 30-second idle timeout.
