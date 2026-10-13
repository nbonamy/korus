import { describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createInitialSnapshot } from "@workspace/core/snapshot";
import { defaultBackendCapabilities } from "@workspace/core/backend-capabilities";
import type { AgentBackendDriver } from "@workspace/core/backend-driver";
import { backendMethods } from "@workspace/core/backend-protocol/methods";
import { AppMcpService } from "../service";
import { createInteractivePlanToolModuleProvider } from "../interactive-plan-tools";
import { AppBackendServer } from "../../server";
import { BackendDriverRpc } from "../../driver-rpc";

async function call(
  url: string,
  agentId: string,
  name: string,
  args = {},
): Promise<CallToolResult> {
  const response = await fetch(`${url}?agentId=${agentId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return ((await response.json()) as { result: CallToolResult }).result;
}
describe("interactive planning owning protocol boundaries", () => {
  it.each(["codex", "claude", "antigravity"] as const)(
    "publishes via authenticated MCP and submits feedback only to the owning %s conversation in plan mode",
    async (backend) => {
      const snapshot = createInitialSnapshot();
      const agent = snapshot.agents[0]!;
      agent.backend = backend;
      agent.backendSession =
        backend === "codex"
          ? { kind: "codex", threadId: "planning" }
          : { kind: backend, sessionId: "planning", transport: "stdio" };
      agent.status = { type: "idle" };
      snapshot.providerConnections = [
        { backend, installed: true, connected: true, checking: false },
      ];
      agent.planReview = {
        id: "native",
        conversationId: "planning",
        turnId: "native-turn",
        markdown: "# Native plan",
        status: "pending",
      };
      const sendPrompt = vi
        .fn()
        .mockResolvedValue({ backendSession: agent.backendSession });
      const driver: AgentBackendDriver = {
        backend,
        getRuntimeStatus: () => ({ backend, status: "running" }),
        getCapabilities: () => defaultBackendCapabilities(backend),
        sendPrompt,
        interrupt: vi.fn(),
        respondToAgentRequest: vi.fn(),
        onEvent: () => () => undefined,
        close: vi.fn(),
      };
      const server = new AppBackendServer({
        version: "test",
        snapshot,
        saveSnapshot: vi.fn(),
        driverRpc: new BackendDriverRpc(new Map([[backend, driver]])),
      });
      const mcp = new AppMcpService({
        snapshot,
        toolModuleProviders: [
          createInteractivePlanToolModuleProvider({
            publish: (id, input) => server.publishInteractivePlan(id, input),
            read: (id) => server.readInteractivePlan(id),
          }),
        ],
      });
      try {
        const url = await mcp.start();
        expect(
          (await call(url, agent.id, "read-skill", { name: "korus-html-plan" }))
            .isError,
        ).toBe(false);
        const document = {
          title: "Choose a delivery mode",
          sections: [
            {
              id: "delivery",
              claim: "Users choose delivery.",
              exhibit: { title: "Composer", text: "Choose when to send.", screens: [{ label: "Compose", title: "New message", content: ["Review the release notes"], actions: ["Schedule", "Send now"] }] },
              decision: {
                question: "How?",
                options: [
                  { id: "manual", label: "Manual" },
                  { id: "auto", label: "Automatic" },
                ],
              },
            },
          ],
        };
        const published = await call(url, agent.id, "publish-html-plan", {
          document,
        });
        expect(published.isError).toBe(false);
        expect(
          (await call(url, snapshot.agents[1]!.id, "read-html-plan")).isError,
        ).toBe(true);
        const plan = agent.interactivePlan!;
        expect(plan.document).toStrictEqual(document);
        const response = {
          planId: plan.id,
          revision: 1,
          answerVersion: 0,
          action: "submit",
          answers: { choices: { delivery: "manual" }, comments: {} },
        };
        const result = await server.handleMessage({
          jsonrpc: "2.0",
          id: 1,
          method: backendMethods.agentInteractivePlanRespond,
          params: { agentId: agent.id, response },
        });
        expect(result).not.toHaveProperty("error");
        expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(
          agent,
          expect.stringContaining('"choice": "manual"'),
          { planMode: true },
        );
        expect(agent.planReview.status).toBe("pending");
        const revised = await call(url, agent.id, "publish-html-plan", {
          planId: plan.id,
          expectedRevision: 1,
          document: { ...document, title: "Manual delivery" },
        });
        expect(revised.structuredContent).toMatchObject({
          planId: plan.id,
          revision: 2,
          agentId: agent.id,
        });
        expect(agent.interactivePlan!.answers).toStrictEqual({
          choices: {},
          comments: {},
        });
        const hostile = server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: backendMethods.agentInteractivePlanRespond,
          params: {
            agentId: agent.id,
            response: { ...response, action: "accept" },
          },
        });
        await expect(hostile).rejects.toThrow("Invalid plan response");
      } finally {
        await mcp.stop();
        await server.close();
      }
    },
  );
});
