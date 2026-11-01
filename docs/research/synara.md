# Synara competitive analysis

Research snapshot: October 3, 2026. Synara source cb760d5b5eace10c3e823feb8dc5a39748f0c67e; Korus 0.25.0, commit 307e2e3530038ca7471d4dab81532514c69415b9.

## Bottom line

**Synara is a serious direct competitor, not just a terminal wrapper with more provider logos.** Its strongest advantages are provider/account breadth, cross-provider continuation, integrated GitHub delivery, and explicit recovery machinery. Korus already overlaps substantially in agent collaboration, isolated worktrees, split views, browser/computer tools, approvals, and automation.

My recommendation is to position Korus around **directing a persistent team across repositories and machines**, with deep Codex/Claude support. Improve continuity, recovery, and discoverability before expanding the provider list. This is a strategic recommendation, not an approved implementation plan.

## Scope and confidence

- Read the official [documentation](https://www.trysynara.com/docs), selected workflow pages, and [release notes](https://www.trysynara.com/changelog), then inspected both local repositories.
- Synara's public changelog identifies 0.9.2 as its latest Stable release. The supplied checkout is newer main. Implemented on main does not mean shipped in Stable.
- No applications were started, provider calls made, tests run, or credentials inspected. Source and existing test/CI definitions establish implementation intent and mechanisms, not live reliability, speed, or complete platform compatibility.
- Negative comparisons mean no equivalent was established in the inspected Korus surfaces, not proof that no related code exists anywhere.
- Sources below pin Synara code to the inspected commit. Korus links are repository-relative and can drift after this snapshot.

## Competitive scorecard

| Area | Synara evidence | Korus position | Assessment |
| --- | --- | --- | --- |
| Provider breadth | Ten registered adapters on main: Codex, Claude, Cursor, Devin, Antigravity, Grok, Droid, OpenCode, Oh My Pi, Pi. | Codex and Claude drivers. | Clear Synara breadth advantage; not ten equally capable integrations. [S1], [C1] |
| Accounts and configuration | Multiple Codex accounts, account-specific selection, generated home overlays, shared source state and isolated account-private credentials. | A configured setup per engine, with separate/shared conversation-home choice. | Synara has more account flexibility; Korus's default isolation is easier to explain. [S2], [C2] |
| Switching provider mid-task | In-place or new-thread handoff, workspace retained, bounded transcript bootstrap. | Session continuation and worker reports exist, but no equivalent general cross-provider handoff was established. | Meaningful Synara workflow advantage, not lossless session portability. [S3], [C3] |
| Claude conversation depth | Claude adapter implements forks, rollback through session restart, and active-session message injection called steering. | Current capabilities disable Claude goals, forks, steering, turn deletion/edit/retry. | Investigate actual runtime support before treating these as permanent provider limitations. [S4], [C4] |
| GitHub delivery | Repository-wide PR/issue review surface and agent actions. Auto-fix CI exists on main but is Beta-gated. | Cockpit work assignment, Git/PR actions, independent review, and staged Missions. | Different emphases: Synara makes GitHub delivery more central; Korus has a structured team workflow. [S5], [C5] |
| Recovery | Durable command receipts and event projections; hidden Git-ref workspace checkpoints; retryable imports. | Versioned app metadata with verified migration backup, provider-owned histories, Git/worktree workflows. | Synara exposes more explicit task/workspace recovery machinery. This is not proof of fewer failures. [S6], [C6] |
| Editing and verification | Editable files with guarded autosave, revision diffs, terminal/browser, embedded [iOS Simulator][S17]. | Source preview/diffs, external-editor integration, browser and macOS Computer Use. | Synara is closer to an integrated IDE. Korus need not copy every surface. [S7], [C7] |
| Team coordination | Internal Agent Gateway; Beta Hubs add coordinator, shared memory/library, and worker monitoring. | Persistent teams, named agents, collaboration MCP, Missions, SSH remote teams. | Broad orchestration is shared territory. Korus's multi-host team model is a useful distinction. [S8], [C8] |
| Distribution | Documented Windows, Intel/Apple Silicon Mac and Linux releases; [headless server/web distribution][S18]. | Current advertised desktop release is Apple Silicon Mac; Linux experimental. | Synara has broader documented reach. No platform builds were qualified in this analysis. [S9], [C9] |
| Visual collaboration | Markdown/artifact and preview surfaces. | Dedicated editable Visualize canvas with revision-aware agent tools. | A concrete Korus surface to demonstrate; no equivalent editable agent canvas was established here. [C10] |

## What matters most

### 1. Provider neutrality is more than onboarding

Korus's recent work makes Codex and Claude selectable, connectable, and disableable peers. That does not yet make their conversation workflows equivalent. The current capability table still exposes a substantial difference. Some differences are legitimate provider constraints; others may be adapter work we have not done. [C4]

An especially useful counterexample to our earlier steering discussion: Synara's Claude adapter advertises steering and puts a user message into the active query's prompt queue, preserving the current turn ID. For an absent or synthetic live turn, it falls back to ordinary sending. This is **not evidence of Codex-identical interruption semantics**. It is evidence that “Claude cannot receive input while working” is too broad a conclusion. The next investigation should observe when Claude consumes that injected message and whether it changes the current work versus becoming a later turn. [S4]

Likewise, Synara calls native Claude session forking rather than treating fork as universally unavailable. Before changing Korus capabilities, prove a real Claude fork preserves the intended history, isolates future messages, and survives restart. Equal citizenship should mean the strongest supported workflow, with honest differences—not identical buttons regardless of semantics. [S4]

### 2. Handoff is a small product idea with a real architectural cost

The user-facing value is straightforward: continue a task with Claude after Codex, or vice versa, without manually re-explaining everything. Synara preserves its task and environment, starts the target runtime, and supplies a bounded recap. Its source caps bootstrap text at 32,000 characters; recent and older messages have different truncation limits ([bootstrap implementation][S15]). Native session IDs, hidden reasoning, provider tools and background jobs do not transfer. [S3]

For Korus, a good first version would be an explicit **Continue with…** action that creates a target-provider conversation with a reviewed context packet and a link to its source. Preserve the original conversation; require a safe idle boundary; make repository/worktree ownership explicit. This is a recommendation, not a claim that the design is already decided.

Keep generic Codex conversation operations in the SDK. Korus can own the cross-provider product transaction without acquiring a second global transcript reducer. [C3]

### 3. Recovery is worth borrowing more than another provider logo

Synara's accepted-command retry path verifies identity and returns the existing sequence. Event writes, projection updates and accepted receipts participate in a SQL transaction. Its checkpoint service captures hidden Git refs with a separate index and exposes restore/diff operations ([checkpoint contract][S16]). These are substantive mechanisms behind “durable tasks.” They do not guarantee exactly-once external tool effects. [S6]

Korus already protects migration and app state, but that addresses a different question from “did my send happen?” or “can I undo this task's file changes?” A useful next audit would follow interrupted send, reconnect, cold history load, and workspace recovery end to end. Add identity/retry semantics at the boundary that needs them; the evidence does not justify rewriting all Korus persistence as event sourcing. [C6]

### 4. GitHub and import reduce the effort of adopting the product

Synara makes existing work a first-class entry point: scan Codex/Claude history, select sessions, map moved folders, and retry incomplete imports without duplicating completed work. It copies provider sessions for continuation rather than simply mutating the originals. Korus has resume/session surfaces, but the equivalent batch-import journey was not established here. [S10], [C3]

Its PR/issue inbox, review detail and send-to-agent actions also make the product useful without first inventing a team structure. Korus has related capabilities; the opportunity is a clearer journey from existing issue or PR to agent work and verified delivery, not necessarily a new orchestration subsystem. [S5], [C5]

### 5. We should not copy their entire scope

Synara includes an editor, simulator, multiple providers/accounts, headless operation, integrations and orchestration. This is real breadth, but every integration multiplies lifecycle, permissions, recovery and platform obligations. The README explicitly calls it early-stage. Its CI configuration has meaningful unit/browser/platform/migration lanes, ([CI configuration][S19]), while selected geometry/font tests are in a non-blocking nightly lane. None of those lanes were executed or verified green in this analysis. [S9], [S11]

Debug mode is a useful example of distinguishing product polish from a deep technical advantage: the inspected implementation applies a provider-independent evidence-first prompt policy. Korus can already express such a workflow through skills. A dedicated mode may improve discoverability, but it is not by itself a new debugging engine. [S12]

## Korus's defensible direction

These are emphasis opportunities, not claims of exclusive features or proven superiority:

- **A persistent team across repositories and hosts.** Korus's remote-team service projects remote daemon state into local teams. Synara's documented headless access is valuable, but is not evidence of an equivalent multi-host team roster. [C8], [S9]
- **Structured delivery with explicit acceptance.** Missions model requirements, tickets, implementation, review and per-repository shipping. Synara's Hubs are a related alternative, so “we coordinate agents” alone is not differentiation. [C5], [S8]
- **Rich collaborative artifacts.** The editable Visualize surface, revision checks and agent tools give Korus a concrete non-chat story. Show the workflow rather than list Mermaid rendering as a feature. [C10]
- **Deep provider integration without owning every protocol twice.** Korus's SDK boundary is a reasonable architectural choice. Preserve it when adding provider-neutral policy and continuity. [C3]

## Practical next steps, in order

1. **Correct the public story.** README still says “Your Codex team” and describes only the OpenAI harness; the website still refers to the existing OpenAI account. Bring the public explanation and screenshots into line with shipped Codex/Claude onboarding. This is a low-cost, immediately useful correction. [C9]
2. **Run a bounded Claude capability audit.** Prioritize live-input semantics and native fork/resume; then goals, retry/edit and context controls. Classify each as implemented, unsupported by the selected runtime, or missing in Korus. Require live runtime evidence before enabling a capability. [S4], [C4]
3. **Validate one Codex↔Claude handoff workflow.** Preserve the original session and repository ownership, disclose lossy context transfer, and test startup failure/retry. No broad transcript rewrite. [S3], [C3]
4. **Audit recovery boundaries.** Establish behavior for uncertain send results, restart, failed hydration, missing sessions and file-change recovery before choosing new storage machinery. [S6], [C6]
5. **Improve one delivery journey.** Prefer issue/PR → agent → independent review → delivery, using existing Cockpit/Missions/Git seams. Keep Auto-fix CI opt-in and bounded if pursued later. [S5], [C5]

Defer adding a long list of runtimes, recreating an IDE, or a wholesale event-sourcing migration until a concrete user workflow demands it. If a third runtime is added later, choose it to validate the provider abstraction, not to improve the logo count.

## Release and evidence caveats

- Current source gates Hubs/Groups, Inbox, Tasks and Auto-fix CI out of Stable. They are implemented, not merely roadmap prose. [S13]
- Public 0.9.2 documentation calls Oh My Pi Beta-only; the inspected main gate no longer lists it. Count ten adapters as **current source breadth**, not verified Stable availability. [S1], [S13]
- The public “Features on main” page still refers to an older Stable version. For release claims use the changelog and the exact build's gates, not that page alone. [S14]
- No adoption, revenue, retention, latency, resource-use or live defect-rate comparison was established. Feature breadth does not settle those questions.

## Evidence index

[S1]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/provider/Layers/ProviderAdapterRegistry.ts#L210
[S2]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/docs/providers/codex.md
[S3]: https://www.trysynara.com/docs/workflows/handoffs
[S4]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/provider/Layers/ClaudeAdapter.ts#L7071
[S5]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/docs/core-concepts.md#code-review
[S6]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L759
[S7]: https://www.trysynara.com/docs/features/workspace-editor
[S8]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/docs/hubs.md
[S9]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/README.md
[S10]: https://www.trysynara.com/docs/features/project-import
[S11]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/.github/workflows/ci-nightly.yml#L51
[S12]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/provider/debugMode.ts
[S13]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/packages/shared/src/betaFeatures.ts#L38
[S14]: https://www.trysynara.com/docs/reference/main-preview
[S15]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/orchestration/handoff.ts#L4
[S16]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/checkpointing/Services/CheckpointStore.ts
[S17]: https://www.trysynara.com/docs/features/ios-simulator
[S18]: https://www.trysynara.com/docs/workflows/headless-server
[S19]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/.github/workflows/ci.yml
[C1]: ../../client/backend/src/driver-rpc.ts
[C2]: ../codex.md#lifecycle
[C3]: ../codex.md
[C4]: ../../core/src/backend-capabilities.ts
[C5]: ../architecture.md#product-model
[C6]: ../../client/backend/src/persistence/store.ts
[C7]: ../../client/vue/src/components/SourcePreviewPanel.vue
[C8]: ../../client/backend/src/connections/remote-team-service.ts
[C9]: ../../README.md
[C10]: ../mcp.md

Additional implementation evidence:

- [Synara bounded handoff construction](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/orchestration/handoff.ts#L4) and [lifecycle coordination](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts#L6384).
- [Synara checkpoint interface](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/checkpointing/Services/CheckpointStore.ts) and [implementation](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/checkpointing/Layers/CheckpointStore.ts).
- [Synara import handlers](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/orchestration/projectImportRoute.ts), [PR auto-fix server gate](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/pullRequestAutoFix/Layers/PullRequestAutoFixService.ts#L86), and [Hubs server gate](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/projectAgent/groupsBetaGate.ts).
- [Synara Codex-home overlays](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/codexProcessEnv.ts#L2474), [provider contract](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/provider/Services/ProviderAdapter.ts#L83), and [architecture](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/.docs/architecture.md#L96).
- [Synara headless server](https://www.trysynara.com/docs/workflows/headless-server), [iOS Simulator](https://www.trysynara.com/docs/features/ios-simulator), [Computer Use limits](https://www.trysynara.com/docs/features/computer-use), and [External MCP permissions](https://www.trysynara.com/docs/workflows/external-mcp).
- [Korus Missions](../../core/src/missions.ts), [Visualize service](../../client/backend/src/visualize-service.ts), [Claude transport](../../client/backend/src/claude/agent-sdk-transport.ts), and [website copy](../../website/index.html).

## Verification

Documentation-only change: source/reference consistency and diff whitespace checked. No product code, package versions, changelog, running applications or Synara files changed. No runtime or test-suite success is claimed.
