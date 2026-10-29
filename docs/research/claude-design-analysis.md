# Design workspace handoff

The user authorized a worktree running as a goal after reviewing the investigation below. This is implementation work, not a Mission. Work only in /Users/nbonamy/src/korus-feat-design-workspace on feat/design-workspace.

Goal: Claude Design parity for the software-design workflow: generate strong alternative proposals, review and compare them, comment and refine them, choose a direction, then send the saved design and feedback for coding. The interface must be visually polished, with compact floating controls, a title on the canvas and a toggleable inspector. User edits must survive agent changes, reload and recovery.

Useful refinement features include direct text/style edits, generated tweaks, interactive software prototypes, code inspection and repository-aware handoff. Manual artboard construction is secondary to reviewing agent proposals. Print/paper layout, slide decks, general illustration and PPTX/Canva integrations are outside this goal. Use existing providers and app-owned contracts. Treat the investigation and estimates below as reference evidence, not an exhaustive feature checklist. Inspect current source and resolve essential ambiguity explicitly.

Keep the daemon authoritative for design state, authorization and edits; renderer owns the editor; Electron owns native effects. Preserve isolation and provider conversation ownership. Read repository AGENTS.md and relevant docs/skills, write meaningful behavior tests before implementation, and verify the actual desktop interface. Do not create a plan file unless asked. No further delegation, commits, push, merge, release or deployment are authorized.

Required acceptance evidence: generate -> user changes text/style -> agent edits a different part -> user changes survive -> reload preserves state -> undo/checkpoint recovery. Also prove stale writes cannot overwrite newer state, targeted comments route correctly, generated content stays isolated, and HTML export works. Produce a repeatable artifact and hand off validated uncommitted work with limitations.

The parent checkout contains unrelated modifications; do not touch them. The sibling SDK is reference/context, not authorization to modify another repository. If an SDK change becomes necessary, explain the concrete boundary and coordinate before expanding scope.

---

**Claude Design: implementation findings and a Korus equivalent**

**Assessment:** Korus can reproduce the useful core of this experience with its existing agent runtimes. The substantial new work is an editable, persistent HTML design surface with safe user/agent changes. A preview pane and a design prompt alone would cover only the first generation.

I inspected the installed **Claude 4.29.0**, extracted its two ASAR archives into a temporary directory, examined the shipped JavaScript and embedded WASM, and inspected the open design through macOS Accessibility and screenshots. I navigated editor controls without changing design content or submitting a prompt. Korus source files were read only; its existing uncommitted changes were preserved.

**What is directly observable**

The current design was open inside a normal conversation, beside the chat. Its canvas offered:

- Pages, artboards, pan/zoom, selection, text, notes, pencil and shapes.
- A layer tree and a Properties panel.
- A Code tab exposing a selected element's CSS and attributes.
- Width/height modes, flex direction, alignment, gap, per-side padding, typography, fill, opacity, radius and borders.
- A Play control for prototype interaction.
- Element/artboard export controls.
- A Tweaks tab whose empty state says Claude can add custom adjustment controls.

The selected layer was a real `div` with CSS such as fixed dimensions, padding, a font stack and flex layout. The artboard content appeared as a nested web document. **For this inspected design, the content is DOM/CSS inside a visual artboard editor.** The UI may also have a separate model for artboard positions and drawing objects; the inspection does not establish every supported document type.

Anthropic publicly describes inline comments, direct edits, generated sliders, imported design systems and handoff/export as parts of the product. Its current product page also describes Design inside conversations. These are product claims, distinct from the local implementation evidence. [Claude Design](https://claude.com/product/design)

**What ships in the desktop app**

| Layer | Evidence | Implication |
| --- | --- | --- |
| Electron shell | `app.asar` contains `designWindow.js` and Design window creation/navigation code | Native window management is separate from the editor |
| Separate Design window | A sandboxed BrowserWindow calls `loadURL`; Node integration is disabled and context isolation enabled | This path hosts a web experience rather than implementing an editor in native code |
| Native PDF bridge | The Design preload exposes `omeletteDesktopPdf.printFrameToPdf`, with origin checks; main process handles guarded saving | Desktop contributes native export support |
| Bundled web frontend | `ion-dist.asar` includes artifact frame shell, capability broker and replica modules | The installed bundle contains substantial artifact infrastructure |
| Service clients | Design project routes and `anthropic.omelette.api.v1alpha.OmeletteService` clients | There is a hosted service layer; extracting the app is insufficient to reconstruct it |
| Isolated content | Frame code constructs URLs on a separate content host, creates sandboxed iframes and checks message origin/source | Generated content is separated from the trusted application |
| Live document engine | Embedded WASM and JS replica code support DOM/JSON documents, stable IDs, changes, patches, rollback and remote updates | Editing and synchronization are first-class machinery |

The bundle contains both separate Design-window code and the integrated artifact infrastructure seen in the live UI. **Presence of the old window code does not prove the current open artifact uses that path.** Public migration documentation confirms that standalone projects/design systems and integrated artifacts coexist during the transition. [Anthropic migration guide](https://support.claude.com/en/articles/17440474-move-from-standalone-claude-design-to-claude)

**The most consequential technical finding**

The shipped `frame-shell-replica` module embeds a Rust/WASM live-document engine. Its binary contains paths such as `api-rs/livedoc/src/v1/dom.rs`, `intent.rs`, `rebase.rs`, `undo.rs` and `patch.rs`. Its exposed operations include:

`openFlatDom`, `openJson`, `applyIntents`, `applyJsonIntents`, `addRemote`, `patchesTo`, `rollback`, `snapshot`, `liveIds`, and `editTowardFlat`.

The surrounding JavaScript handles sequenced changes, author identity, commit conflicts, pulling remote changes and rebasing/retrying certain conflicts. It also pairs DOM subtrees using stable `data-id` attributes.

This is direct evidence of a reusable live document substrate in the artifact host. **It supports the inference that coordinated editing is a major investment, but it does not establish the exact algorithm used by every Design operation.** I did not find sufficient evidence to label it Automerge, Yjs or any particular CRDT.

A reasonable architectural reconstruction is:

```text
Conversation / agent
        │
        ▼
Design operations + current document
        │
        ▼
Persistent, versioned design document
        │
        ├── visual editor and property controls
        ├── isolated DOM/CSS prototype rendering
        ├── comments and targeted change requests
        └── exports / implementation handoff
```

The important product property is that manual edits and agent edits operate on recoverable document state. Regenerating a complete HTML blob after each request makes preserving user changes much harder.

**What remains unknown**

The installed client does not reveal the complete generation prompt, tool schemas, server implementation, design-system retrieval strategy, model routing or screenshot/repair loop. It also does not prove reliable two-way editing of arbitrary React/Vue source.

Anthropic describes codebase/design-file import and component-aware generation. That does not establish that arbitrary production code can round-trip through visual edits without loss. [Design-system setup](https://academy.claude.com/tutorials/create-a-design-system-with-claude)

**How much Korus already has**

| Existing capability | Reuse | Missing piece |
| --- | --- | --- |
| Provider-backed conversations and app-owned MCP tools | Existing Codex/Claude agents can generate and modify designs | Design-specific document operations and guidance |
| Inline HTML through the conversation SDK | Streaming sandboxed preview, source view and HTML download | Durable design identity, artboards and visual editing |
| In-app browser annotation | Element picking and targeted feedback | Stable design-node identity and revision-aware comments |
| Excalidraw Visualize | Pane UX, selections, annotations and canvas saving patterns | Editable HTML/CSS content |
| Canvas persistence | Expected-revision checks and serialized writes | Equivalent contracts for HTML design operations |

Relevant source:
[canvas document contract](/Users/nbonamy/src/korus-feat-design-workspace/core/src/visualize-canvas.ts:1),
[revision-safe canvas writes](/Users/nbonamy/src/korus-feat-design-workspace/backend/src/visualize-service.ts:271),
[browser element annotations](/Users/nbonamy/src/korus-feat-design-workspace/electron/src/main/browser-pane.ts:309),
[HTML preview in the sibling SDK](/Users/nbonamy/src/codex-app-sdk/packages/vue/src/chat/ChatHtmlBlock.vue:15).

One limit matters: Korus imports Mermaid into editable shapes, but SVG and images are rasterized for Excalidraw. Putting a screenshot of a UI onto that canvas would not make its buttons, text and CSS editable. [Current import behavior](/Users/nbonamy/src/korus-feat-design-workspace/vue/src/components/excalidraw-editor.ts:16)

**Recommended implementation**

Build an app-owned **Design document**, displayed beside the existing conversation. Reuse artifact/pane conventions; give HTML designs their own content model rather than stretching the Excalidraw schema.

For a first version:

1. Persist one or more artboards, an authored HTML node tree with stable IDs, CSS, assets and a revision.
2. Render the design in an isolated frame with an explicit bridge for selection, measurement and preview updates.
3. Offer element comments, text editing and a small style inspector: color, type, padding, gap, size and radius.
4. Route user and agent edits through the same daemon-owned operation service. Require the expected revision; reject stale changes and ask the agent to reread.
5. Keep creation/replacement distinct from subsequent edits. After manual editing begins, use targeted operations and deliberate checkpoints.
6. Support undo and reload persistence; keep Play mode separate from editing.
7. Export self-contained HTML and provide a handoff containing the design, assets, screenshots and intent.

The renderer owns the editor. The daemon owns documents, authorization, persistence and mutations. Electron owns native save/capture effects. Agents use provider-neutral tools such as read design, read selection, apply edits and capture preview; provider transcript ownership remains unchanged.

For editable content, begin with authored HTML/CSS and bounded interactions. Runtime-created nodes and arbitrary framework components need a defined source-mapping strategy before visual edits can reliably reach their source. **Do not promise arbitrary Vue/React round trips in the MVP.**

For design-system fidelity, start with repository tokens, typography, assets and usage guidance. A live component library needs additional bundling, dependency and component-prop contracts. Generated Tweaks can initially be declared controls bound to CSS variables or explicit document properties; the observed tab does not reveal Claude's internal binding API.

**Where the difficult work sits**

- **Edit preservation:** user changes, agent changes, undo and reload must all converge on the same saved state.
- **Source identity:** DOM inspection alone does not reliably identify the authored source of framework-generated content.
- **Layout semantics:** moving a flex/grid child is different from changing an absolutely positioned object's coordinates.
- **Isolation:** an editor bridge must not grant generated scripts access to filesystem, provider credentials or unrestricted app APIs.
- **Output quality:** styling guidance, real assets and visual verification need evaluation against representative designs. The app bundle does not reveal Anthropic's complete quality loop.
- **Exports:** HTML is a practical first target. Editable PowerPoint/Canva output, font fidelity and consistent print layout are separate projects.

**Effort estimate**

These are preliminary engineering ranges, not commitments. They assume one experienced engineer with agent assistance, existing Korus runtimes, a desktop-first local workflow, and a bounded HTML/CSS format. They are cumulative from the start.

| Outcome | Estimated effort | Scope |
| --- | --- | --- |
| Feasibility spike | 3–5 engineering days | One artboard; selection; one persisted user edit; one revision-safe agent edit; reload proof |
| Useful MVP | 4–6 engineering weeks | Basic artboards, comments, text/style controls, undo/checkpoints, persistence, HTML export and owner-boundary tests |
| Polished local design workspace | 10–16 engineering weeks | Better multi-artboard workflows, layout editing, assets/fonts, design-system support, screenshot tooling, recovery and export polish |
| Broad Claude-like parity | Several engineer-months, likely a small team | Collaborative sharing, rich imports, component integration, advanced controls and multiple high-fidelity export targets |

The spike should test the hardest transition early: **generate a design → manually change text/style → ask the agent to restructure another part → verify manual changes survive → reload → undo/recover.** Add a stale-write case to prove concurrent changes cannot silently overwrite the document.

My recommendation is the bounded local design workspace. It fits Korus's repository context and existing agents, and gives a useful design-to-implementation loop before committing to a general collaborative design platform.

The investigation changed no application code. This report was subsequently saved for the delegated implementation. Tests/builds were unnecessary for the investigation; `git diff --check` passed.
