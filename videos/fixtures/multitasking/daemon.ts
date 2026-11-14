import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AppBackendServer } from "../../../client/backend/src/server";
import { ProviderDriverRpc } from "../../../client/backend/src/driver-rpc";
import { StdioRpcPeer } from "../../../client/backend/src/stdio";
import { backendMethods } from "../../../core/src/backend-protocol/methods";
import { createEmptySnapshot } from "../../../core/src/snapshot-construction";
import { defaultProviderCapabilities } from "../../../core/src/provider-capabilities";
const home = process.env.APP_HOME!;
const root = path.join(home, "projects");
const now = new Date().toISOString();
const seed = createEmptySnapshot();
const briefs = [
  {
    id: "checkout",
    team: "feature",
    name: "Checkout UI",
    repo: "storefront",
    prompt:
      "Finish the checkout experience for our launch. Keep the current payment API.",
    text: "The checkout form is wired up. I’m checking keyboard navigation and the validation states while the API work continues.",
    tool: "Checking checkout form and keyboard navigation…",
  },
  {
    id: "api",
    team: "feature",
    name: "Payment API",
    repo: "storefront-api",
    prompt:
      "Implement the checkout validation API. Coordinate the response shape with the checkout UI.",
    text: "One detail before I continue: should invalid addresses show inline errors or a page-level summary?",
    tool: "Running payment validation and idempotency checks…",
  },
  {
    id: "fix",
    team: "support",
    name: "Sign-in fix",
    repo: "accounts",
    prompt:
      "A user gets stuck after their sign-in link expires. Fix the recovery path without changing valid-link behavior.",
    text: "I reproduced the expired-link issue. I’m adding a clear recovery action and a regression test.",
    tool: "Checking expired links and valid-link regression…",
  },
  {
    id: "review",
    team: "support",
    name: "Independent review",
    repo: "accounts",
    prompt:
      "Review the sign-in recovery independently. Check expiry, single use and cross-account access.",
    text: "I’m reviewing the recovery path independently, including replay protection and account isolation.",
    tool: "Inspecting the recovery diff and security checks…",
  },
];
seed.teams = [
  {
    id: "feature",
    name: "Launch checkout",
    color: "#1b4fb2",
    avatar: "LC",
    agentIds: ["checkout", "api"],
    activeAgentId: "checkout",
  },
  {
    id: "support",
    name: "Customer support",
    color: "#ea8a23",
    avatar: "CS",
    agentIds: ["fix", "review"],
    activeAgentId: "fix",
  },
];
seed.agents = briefs.map((b) => ({
  id: b.id,
  teamId: b.team,
  name: b.name,
  folder: path.join(root, b.repo),
  provider: "codex",
  providerSession: { kind: "codex", conversationId: "demo-" + b.id },
  providerDefaults: {
    kind: "codex",
    model: "gpt-6.1-sol",
    reasoningEffort: "high",
  },
  workspace: {
    kind: "git",
    folder: path.join(root, b.repo),
    repositoryName: b.repo,
    repositoryRoot: path.join(root, b.repo),
    primaryWorktreeRoot: path.join(root, b.repo),
    branch: b.team === "feature" ? "feat/checkout" : "fix/sign-in-recovery",
    defaultBranch: "main",
    isLinkedWorktree: false,
    updatedAt: now,
  },
  status: { type: b.id === "api" ? "idle" : "working" },
  statusText: b.id === "api" ? "Waiting for direction" : b.tool,
  createdAt: now,
  updatedAt: now,
}));
for (const b of briefs) {
  const folder = path.join(root, b.repo);
  await fs.mkdir(folder, { recursive: true });
  try {
    execFileSync(
      "git",
      [
        "init",
        "-b",
        b.team === "feature" ? "feat/checkout" : "fix/sign-in-recovery",
        folder,
      ],
      { stdio: "ignore" },
    );
    await fs.writeFile(
      path.join(folder, "README.md"),
      "# " + b.repo + "\nFictional recording workspace.\n",
    );
    execFileSync("git", ["-C", folder, "add", "README.md"]);
    execFileSync(
      "git",
      [
        "-C",
        folder,
        "-c",
        "user.name=Demo",
        "-c",
        "user.email=demo@example.invalid",
        "commit",
        "-m",
        "initial demo",
      ],
      { stdio: "ignore" },
    );
  } catch {}
}
seed.activeTeamId = "feature";
seed.activeAgentId = "checkout";
seed.providerConnections = [
  { provider: "codex", installed: true, connected: true, checking: false },
];
seed.providerRuntimes = [{ provider: "codex", status: "running" }];
seed.general.providerEnabled = { codex: true };
seed.general.useInteractivePlans = true;
seed.sourceFolder = { path: root, initialized: true, recentRepoNames: [] };
seed.theme = {
  id: "app-light",
  mode: "light",
  uiFontSize: 15,
  chatFontSize: 16,
  codeFontSize: 14,
};
const replies = new Map<string, string>();
const revisions = new Map<string, number>();
const listeners = new Set<(event: any) => void>();
function frame(agent: any) {
  const b = briefs.find((b) => b.id === agent.id)!;
  const turnId = "turn-" + b.id;
  return {
    activeTurnId: b.id === "api" && !replies.has(b.id) ? null : turnId,
    turns: [
      {
        id: turnId,
        status:
          b.id === "api" && !replies.has(b.id) ? "completed" : "inProgress",
        error: null,
        willRetry: false,
        startedAt: now,
        completedAt: null,
        durationMs: null,
      },
    ],
    messages: [
      {
        id: b.id + "-prompt",
        agentId: b.id,
        role: "user",
        status: "complete",
        turnId,
        parts: [{ type: "text", text: b.prompt }],
        createdAt: now,
      },
      {
        id: b.id + "-answer",
        agentId: b.id,
        role: "assistant",
        status: "complete",
        turnId,
        parts: [
          {
            type: "text",
            text: replies.has(b.id)
              ? "Inline validation it is. I’m checking the response contract and retry-safe submissions."
              : b.text,
          },
        ],
        createdAt: now,
      },
      {
        id: b.id + "-tool",
        agentId: b.id,
        role: "assistant",
        status: "complete",
        turnId,
        parts: [
          {
            type: "tool",
            id: b.id + "-checks",
            kind: "command",
            title: "Run focused checks",
            status: "running",
            body: b.tool,
          },
        ],
        createdAt: now,
      },
    ],
    answeredClientRequestIds: [],
    busy: b.id !== "api" || replies.has(b.id),
    historyLoading: false,
    requests: [],
    title: null,
    goal: null,
    historyState: { hasOlder: false, loadingOlder: false },
    contextUsage: null,
    plan: null,
    error: null,
  };
}
const driver = {
  provider: "codex",
  getRuntimeStatus: () => ({ provider: "codex", status: "running" }),
  getCapabilities: () => ({
    ...defaultProviderCapabilities("codex"),
    models: true,
    history: true,
    turnHistory: false,
  }),
  onEvent: (listener: any) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  listModels: async () => [
    {
      id: "gpt-6.1-sol",
      model: "gpt-6.1-sol",
      displayName: "GPT-6.1 Sol",
      isDefault: true,
    },
  ],
  listSkills: async () => [],
  listPlugins: async () => [],
  listConversations: async () => [],
  loadConversation: async (agent: any) => {
    const event = {
      agentId: agent.id,
      provider: "codex",
      type: "conversation.sessionSnapshot",
      payload: {
        conversation: "demo-" + agent.id,
        epoch: "multitasking-" + agent.id,
        snapshot: {
          revision: revisions.get(agent.id) ?? 0,
          state: frame(agent),
        },
      },
    };
    for (const l of listeners) l(event);
    return { hasOlder: false };
  },
  sendPrompt: async (agent: any, prompt: string) => {
    replies.set(agent.id, prompt);
    revisions.set(agent.id, (revisions.get(agent.id) ?? 0) + 1);
    for (const l of listeners)
      l({
        agentId: agent.id,
        provider: "codex",
        type: "conversation.sessionSnapshot",
        payload: {
          conversation: "demo-" + agent.id,
          epoch: "multitasking-" + agent.id,
          snapshot: { revision: revisions.get(agent.id), state: frame(agent) },
        },
      });
    return {
      providerSession: agent.providerSession,
      turnId: "turn-" + agent.id,
    };
  },
  interrupt: async (agent: any) => ({
    providerSession: agent.providerSession,
    activeTurnId: null,
  }),
  respondToAgentRequest: async () => {},
  shutdown: async () => {},
  reconcileConversations: async () => {},
  agentChanged: () => {},
};
const peers = new Set<StdioRpcPeer>();
const server = new AppBackendServer({
  version: process.env.APP_DEMO_VERSION ?? "0.57.1",
  snapshot: seed,
  driverRpc: new ProviderDriverRpc(new Map([["codex", driver as any]])),
  onEvent: (event) => {
    for (const p of peers) p.notify(backendMethods.backendEventNotify, event);
  },
  saveSnapshot: async (snapshot) => {
    await fs.writeFile(
      path.join(home, "demo-snapshot.json"),
      JSON.stringify(snapshot),
    );
  },
});
await server.initialize();
const socket = path.join(home, "daemon.sock");
await fs.mkdir(home, { recursive: true });
const network = net.createServer((connection) => {
  const peer = new StdioRpcPeer({
    input: connection,
    output: connection,
    onMessage: (message) => server.handleMessage(message),
  });
  peers.add(peer);
  connection.on("close", () => {
    peers.delete(peer);
    peer.stop();
  });
  peer.start();
});
network.listen(socket, () => process.stderr.write("Demo daemon ready\n"));
process.on("SIGTERM", () => {
  network.close();
  void server.close().finally(() => process.exit(0));
});
