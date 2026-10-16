# Frontend

The renderer is Vue 3 with TypeScript and Element Plus. This is a working guide for
consistent implementation. Feature behavior belongs in tests; process and backend
ownership in [architecture.md](architecture.md). Update this guide only when a
reusable convention or canonical component changes.

## Working Method

1. Inspect the nearest component and its colocated tests.
2. Search `vue/src/shared/` and `vue/src/components/` by interaction and product
   concept before creating markup or CSS (historical names do not prove a component
   is single-use).
3. Choose the narrowest owner: component, renderer state, composable, view model,
   core policy, SDK, or host capability.
4. Reuse a component only when its contract fits without caller-specific flags. Keep
   one-off composition product-local and promote it after a second real use. When a
   canonical component does not fit, record the mismatch.
5. Verify per [testing.md](testing.md); for visible behavior add one proportional
   runtime, DOM or screenshot check when tooling exists.

Done means ownership is clear, reuse is justified and behavior is specified at its
public seam.

## Visual Direction

`docs/codex.png` is the shell shape: navigation left, conversation center, workspace
artifacts right. The app is a dense operational workspace: quiet, compact,
border-light and stable during loading and streaming; concrete actions, restrained
weight and predictable geometry over decorative cards or explanatory copy.

## Ownership

- **Components:** ephemeral interaction and derived presentation state.
- **`vue/src/app-state.ts`:** renderer state shared across surfaces, the replica of
  server-authored app state, and the registry of per-agent provider replicas. It
  routes provider frames to the matching provider reducer and never interprets or
  rebuilds transcripts. It delegates catalogs, authorization, unread policy, history
  paging and repository discovery to focused `*-state.ts` modules.
- **Composables:** reusable stateful behavior (async loading, caching, request
  lifecycle, mutations). `AppShell` delegates multi-step workflows (onboarding,
  repository acquisition, work-item routing, per-agent right workspace, annotation) to
  `use-*.ts` composables; shells coordinate and keep only navigation and one-step
  event forwarding.
- **Core** owns cross-client policy and contracts, specified in core tests.
- **Product components** (`vue/src/components/`) represent one product concept with
  typed props and semantic emits. **Shared primitives** (`vue/src/shared/`) are
  domain-neutral with isolated tests and never import product components, stores,
  views or backend clients.
- **SDK surfaces** own conversation, composer, message, tool, approval, attachment,
  clipboard and transcription behavior. **Host capabilities** own Electron/web
  differences (dialogs, Browser views, Computer Use, Open In, Dock badges).
- Components consume app-owned contracts, never provider types, Electron globals,
  filesystem APIs or raw backend payloads.

Rules of thumb:

- `App` mounts the shell only after synchronization yields a connected workspace
  snapshot; an empty placeholder or failed read is not evidence of first-run
  onboarding. Later disconnects keep the mounted workspace intact.
- Use `AsyncCatalogCache` for keyed async catalogs (dedupe, invalidation, stale
  rejection, pushed updates) and `shared/use-debounced-save` for autosaved settings
  (immutable snapshots, serialized writes, flush on disposal and before switching
  resources). Commit an async result only while its request identity still matches
  the active selection.
- Name components after product concepts; use typed `defineProps`/`defineEmits`;
  prefer computed presentation state; split a child when it has its own identity,
  state machine, reusable behavior or test seam; keep styles scoped unless a token,
  reset, shell rule or shared primitive is intentionally global; keep wrappers only
  when they add product semantics.

### Conversation Panes

`CodexConversationPane` from `@codex-app-sdk/vue` is the complete conversation and
composer surface. Extend it through its controller, slots and typed actions; Korus's
wrapper only maps app state and product routing. Codex panes receive the SDK-owned
snapshot and call targeted SDK bridge operations; Claude panes receive the Claude
host's snapshot. A generic Codex interaction defect is an SDK defect. Never add a
global message list or provider-neutral reducer to `app-state.ts`; Korus-only
overlays read the provider frame or an explicit coordination projection.

Split layouts hold equal conversation panes, never parent/child agents.
`useSplitWorkspace` owns client-local assignment and focus per team. Controllers and
async actions keep an explicit agent ID (background updates never select a pane); only
the focused conversation handles global composer and interrupt shortcuts; hydration
watches stable conversation identity, not snapshot object identity. One artifact
sidebar follows the selected agent, keeping each agent's tabs separately.

### Surfaces

- **Backlog** (work-provider inbox) and **Cockpit** (all-agent overview) are
  distinct global surfaces. Opening Cockpit must not load Backlog data. Projection
  and sorting live in a focused view model, not `AppShell`.
- Activity sidebar grouping and recency belong to `core/src/workspace-sidebar.ts`;
  desktop and mobile own their local view preference, clock and transitions. Native
  activity rows share one identity space across groups so regrouping preserves rows.
- Team-rail dot: red for unread, orange for working, unread wins, never on the
  selected team. Agent activity is stored apart from metadata so startup hydration
  does not make idle agents look active.
- Mission navigation reuses the workspace group, session row and status-dot
  primitives of Quick Chats. Mission surfaces show artifacts for review with comments
  flowing through the conversation; they have no setup or artifact-editing forms.
  Mission-owned workers stay out of the global agent sidebar.

## Canonical UI

Search by behavior first.

| Need | Use | Location |
| --- | --- | --- |
| Action, checkbox/radio, separator, submenu rows | `AppMenu` | `vue/src/shared/menu/` |
| Pointer-positioned context menu | `AppContextMenu` | `vue/src/shared/menu/` |
| Application launcher and icons | `OpenInControl` | `vue/src/shared/` |
| Product glyphs (incl. GitHub) | app icon catalog | `vue/src/shared/icons/app-icons.ts` |
| Reopen collapsed sidebar | `SidebarExpandButton` | `vue/src/shared/` |
| Workspace header / body containment | `WorkspaceHeader`, `.workspace-header__title`, `.workspace-body` | `vue/src/shared/`, `styles/base.css` |
| Dialog chrome and footer actions | `.app-dialog`, `.app-button` | `vue/src/styles/base.css` |
| Form dialogs | `FormDialog` | `vue/src/shared/dialog/` |
| Form structure: card, label-left rows, label-above fields | `FormSection`, `FormRow`, `FormField` | `vue/src/shared/form/` |
| Single-line text with an inline clear action | `ClearableTextInput` | `vue/src/shared/form/` |
| Command palettes | `QuickOpenDialog` | `vue/src/shared/` |
| Voice multiline input | `VoiceTextarea` | `vue/src/shared/` |
| Emoji, grapheme or cropped-image identity | `IdentityPicker` (product component despite its path; keep new product dependencies out of `shared/`) | `vue/src/shared/identity/` |
| Enabled coding backend picker | `BackendSelector` (consumes the choices `AppShell` provides once through `backend-selection`; hides a single choice unless explicit provider identity is needed; dialogs never read backend settings) | `vue/src/components/` |
| New-work provider, model and effort picker | `BackendModelSelector` (icon-only provider tabs in fixed order, cascading model → effort menu, owning-host catalog cached per provider and host with stale-response protection; the saved or provider default model and effort are selected explicitly, never a blank "default") | `vue/src/components/` |
| Settings structure | `SettingsPanelFrame`, `SettingsTextareaField` (compose `FormSection`/`FormRow`) | `vue/src/components/` |
| Dense structured data | `AppDataList` | `vue/src/components/` |
| Operation feedback | `GitOperationFeedback` | `vue/src/components/` |
| Worktree provisioning progress | `WorkspaceProvisioningProgressDialog` | `vue/src/components/` |

App-owned keyboard shortcuts live in `core/src/keyboard-shortcuts.ts`. Native menus,
native input routing, shell matching and the shortcut reference share these
binding declarations. Availability reflects the host and current surface; provider
composer bindings remain SDK-owned. Reference and command-palette opening bindings
are handled in the renderer so editable targets and modal dialogs retain their input.
The command palette and shortcut reference share the canonical quick-open dialog's
search, rows and key hints. The reference groups read-only rows; the palette invokes
existing shell handlers. Their action icons share renderer presentation metadata;
Git actions retain the icons supplied by their workflow control.
Quick-open rows support sibling actions that appear on hover or keyboard focus,
keeping secondary actions separate from the primary row target.
Palette entries declare their sections explicitly and preserve owning-menu order.
Settings destinations share their icons, labels and host/provider availability in
`components/settings-tabs.ts`, consumed by both the sidebar and command search.
Git command availability and dispatch come from the focused agent's workflow control,
which retains ownership of operation state, confirmations and host routing.

## Interaction

- **Dialogs:** compose `FormDialog`/`FormField` (title, optional subtitle, one
  padded body, labels above controls, divided footer, no second gutter). Footer:
  dismiss tertiary, alternatives secondary, at most one primary. Compact pickers use
  the filter as the whole top row, then loading/error/empty/results. Dialogs emit
  domain actions; the parent or composable persists and calls the backend.
  Shared dialog styles reset inherited text alignment to left; footer actions stay
  right-aligned. Do not add per-dialog alignment resets.
- **Menus and tabs:** `AppMenu` gives consistent rows, roles and states; add roving
  focus and Arrow/Home/End to `AppMenu` itself while the containing overlay owns
  Escape, closing and focus return. Share one item model between inline and menu
  actions. Use Element Plus teleport/placement for popovers, Element Plus tabs for
  navigation, radio/segmented controls for exclusive form choices; pill tabs keep
  symmetric edge padding.
  Exclusive-choice popup menus show the selected option with `CheckIcon` in place
  of its leading icon; other options keep their normal icons. Use radio items
  with `checked` for accessibility and `:show-selection-check="false"` on `AppMenu`
  so the selected row has one leading checkmark, not an additional trailing one.
- **Lists:** `AppDataList` for dense data, focused rows for navigation. Make the
  whole row the primary target with quiet, keyboard-reachable secondary actions;
  hover and focus keep geometry stable; titlebars align to the shared appbar height;
  each pane owns its scroll axes.
- **Forms:** `FormSection` is the card; its body holds either `FormRow`s (label and
  description left, control right: preferences, toggles, single values) or
  `FormField`s in a two- or three-column grid (label above: related fields being
  configured, e.g. Automations). One section may mix both. `density="compact"` tightens
  `FormSection` rows and switches `FormField` to the grid layout; dialogs keep the
  default.

## Styling And Feedback

- Semantic variables for colors and repeated design values; component-specific
  geometry stays local. Derive Element Plus overrides from the same variables and
  scope them to the owning wrapper. Bridge themes into the SDK through documented
  `--codex-*` variables and `data-codex-theme`; never restyle SDK internals.
- App chrome (buttons, menus, headers) is unselectable; conversation and document
  content stays selectable. Native system sans stack, restrained weights.
- Make loading, working, awaiting-input, empty, offline, error and interrupted
  states explicit near what they affect. Drive staged steps from real backend phases;
  timing may smooth completion but must never imply a phase finished early.
- The in-app browser's `<webview>` sits in the workspace DOM so menus and dialogs
  layer over it; never hide the page to expose an overlay.

Native mobile sheets use an opaque, light neutral canvas with white grouped rows
and subtle separators, adapting both surfaces in dark mode. A shared sheet style keeps settings destinations, forms and
footers consistent in light and dark mode. Camera and image content retain their
own contrast treatment; system pickers retain their native controls.
Long-running operations replace their sheet forms with `AppSheetProgress`, using
one centered layout for the operation, context and indeterminate indicator. Progress
uses the medium sheet height; multi-step sheets keep Cancel at the trailing edge
and Back at the leading edge throughout the flow.
Actions and dismissal remain unavailable until the operation resolves; failures
return to the form with its inputs preserved.

## Accessibility And Copy

- Every icon-only control has an accessible name; keep native keyboard behavior,
  visible focus and predictable focus return; one semantic target per action, no
  nested interactives.
- Short, concrete labels. Reusable copy lives in `vue/src/i18n/messages.ts` (use
  `vue-i18n` for dynamic labels). Backend and IPC send app-owned error and status
  descriptors that only the rendering client localizes; raw backend, provider, Git
  or shell text stays diagnostic detail.

## Themes

Components never import fixed colors. Themes are `ThemeDefinition`s of semantic
tokens (`--color-*`, `--diff-*`) applied as CSS custom properties on the document
root; syntax and diff highlighting share the theme source. VS Code theme import is a
desired direction, not a requirement.

## Editable Visualize Canvases

Visualize imports Mermaid, SVG and image input into an Excalidraw canvas (read-only
with pan by default; Edit unlocks). After import `Visualization.canvas` is
authoritative: **never regenerate Mermaid over an edited canvas**. Mermaid imports as
native shapes; SVG, generated images and converter fallbacks are rasterized sanitized
content, not editable vectors. `ExcalidrawCanvas.vue` owns save scheduling and
selection persistence; `excalidraw-editor.ts` isolates the React SDK, browser-only
Mermaid import, sanitization, exports and cleanup. The canvas has no composer: the
normal conversation handles change requests and the agent reads the saved selection
through its canvas tools.

Elements, assets, selection, revision and a bounded PNG preview persist through the
daemon's save method, with no hosted editor or browser database. Saves carry the
Visualize session ID and expected revision (a final save may finish after the pane
closes); conflicting revisions are rejected without replacing local edits. Agent
batches are one undo unit; editor history is local and resets on remount. Git
workspace diagrams belong to the primary worktree's repository identity, so linked
worktree agents share the library, while pane visibility, suggestions, selection and
tool authorization stay conversation-scoped.
