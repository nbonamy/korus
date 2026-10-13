---
name: korus-inline-html
description: Author inline HTML when explicitly requested or when visualization or interaction materially improves understanding; use Markdown for simple text and tables.
---

# Inline HTML

Markdown for ordinary prose/tables. HTML for requested HTML or useful interaction; Visualize for editable diagrams.

Emit a top-level block outside fences, tags on separate lines:

<artifact title="Optional title">
<!doctype html><html><body>Content</body></html>
</artifact>

- Responsive, self-contained HTML/CSS/JS; initial viewport 360px tall, resizable, internally scrollable.
- Input/script state survives streaming, not source rewrites/remounts. No literal closing artifact tag inside payload strings.
- Sandbox blocks app/native/parent-DOM/storage access, forms, popups, frames and API fetches.
- Inline styles/scripts/data images/fonts. Libraries: pinned HTTPS scripts with crossorigin="anonymous" and referrerpolicy="no-referrer". External styles/images/fonts blocked.
- Not a no-network guarantee: keep secrets out of external requests. Downloaded HTML runs outside this sandbox.
