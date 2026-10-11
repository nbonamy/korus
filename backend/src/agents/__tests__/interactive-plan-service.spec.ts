import { describe, expect, it, vi } from "vitest";
import { createInitialSnapshot } from "@workspace/core/snapshot";
import type {
  InteractivePlanDocument,
  InteractivePlanResponse,
} from "@workspace/core/interactive-plan";
import { InteractivePlanService } from "../interactive-plan-service";
import {
  persistedStateFromSnapshot,
  snapshotFromPersistedState,
} from "../../state-persistence";

const document: InteractivePlanDocument = {
  title: "Scheduled messages",
  sections: [
    {
      id: "schedule",
      claim: "Users can schedule messages.",
      exhibit: { title: "Composer", text: "[Message] [Send later]" },
      decision: {
        question: "Where?",
        options: [
          { id: "folder", label: "Folder" },
          { id: "inline", label: "Inline" },
        ],
        proposed: "folder",
      },
    },
  ],
};
function fixture() {
  const snapshot = createInitialSnapshot();
  const agent = snapshot.agents[0]!;
  agent.backendSession = { kind: "codex", threadId: "planning-conversation" };
  let disk = persistedStateFromSnapshot(snapshot);
  const persist = vi.fn(async () => {
    disk = persistedStateFromSnapshot(snapshot);
  });
  const submit = vi.fn().mockResolvedValue(undefined);
  const publish = vi.fn();
  const service = new InteractivePlanService({ persist, submit, publish });
  const response = (
    action: "save" | "submit" = "save",
  ): InteractivePlanResponse => ({
    planId: agent.interactivePlan!.id,
    revision: agent.interactivePlan!.revision,
    answerVersion: agent.interactivePlan!.answerVersion,
    action,
    answers: {
      choices: { schedule: "inline" },
      comments: { schedule: "Show cancellation too." },
    },
  });
  return {
    snapshot,
    agent,
    service,
    persist,
    submit,
    publish,
    response,
    restore: () => snapshotFromPersistedState(disk),
  };
}
describe("interactive planning lifecycle", () => {
  it("persists answers without a turn, sends explicit structured feedback, and isolates revised plans", async () => {
    const f = fixture();
    const plan = await f.service.publish(f.agent, { document });
    expect(plan.answers).toStrictEqual({ choices: {}, comments: {} });
    await f.service.respond(f.agent, f.response());
    const restored = f.restore().agents[0]!;
    expect(restored.interactivePlan?.answers).toStrictEqual({
      choices: { schedule: "inline" },
      comments: { schedule: "Show cancellation too." },
    });
    expect(f.submit).not.toHaveBeenCalled();
    const feedback = f.response("submit");
    await f.service.respond(f.agent, feedback);
    await f.service.respond(f.agent, feedback);
    expect(f.submit).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      f.submit.mock.calls[0]![1].slice(f.submit.mock.calls[0]![1].indexOf("{")),
    );
    expect(payload).toStrictEqual({
      agentId: f.agent.id,
      conversationId: "planning-conversation",
      planId: plan.id,
      revision: 1,
      sections: [
        {
          sectionId: "schedule",
          claim: "Users can schedule messages.",
          question: "Where?",
          choice: "inline",
          proposed: "folder",
          answered: true,
          comment: "Show cancellation too.",
        },
      ],
    });
    expect(f.agent.planReview).toBeUndefined();
    const revision = await f.service.publish(f.agent, {
      planId: plan.id,
      expectedRevision: 1,
      document: { ...document, title: "Scheduled messages with cancellation" },
    });
    expect(revision).toMatchObject({
      id: plan.id,
      revision: 2,
      answers: { choices: {}, comments: {} },
      submitted: false,
      history: [{ revision: 1, answers: feedback.answers, submitted: true }],
    });
    await expect(f.service.respond(f.agent, feedback)).rejects.toThrow(
      "revision changed",
    );
    expect(f.restore().agents[0]!.interactivePlan).toStrictEqual(revision);
  });
  it("rejects wrong owners, conversations, unknown choices, malformed responses and conflicting windows", async () => {
    const f = fixture();
    await f.service.publish(f.agent, { document });
    await expect(
      f.service.respond(f.snapshot.agents[1]!, f.response()),
    ).rejects.toThrow("belong");
    f.agent.backendSession = { kind: "codex", threadId: "other" };
    expect(() => f.service.read(f.agent)).toThrow("belong");
    f.agent.backendSession.threadId = "planning-conversation";
    await expect(
      f.service.respond(f.agent, {
        ...f.response(),
        answers: { choices: { schedule: "execute" }, comments: {} },
      }),
    ).rejects.toThrow("answers");
    await expect(
      f.service.respond(f.agent, {
        ...f.response(),
        action: "accept" as "save",
      }),
    ).rejects.toThrow("response");
    const stale = f.response();
    await f.service.respond(f.agent, stale);
    await expect(f.service.respond(f.agent, stale)).rejects.toThrow(
      "another window",
    );
    await expect(
      f.service.publish(f.agent, {
        document,
        planId: "someone-else",
        expectedRevision: 1,
      }),
    ).rejects.toThrow("revision changed");
    expect(f.submit).not.toHaveBeenCalled();
  });
  it("serializes saves and revision publication and recovers failed persistence or delivery", async () => {
    const f = fixture();
    await f.service.publish(f.agent, { document });
    f.persist.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.service.respond(f.agent, f.response())).rejects.toThrow(
      "disk full",
    );
    expect(f.agent.interactivePlan?.answerVersion).toBe(0);
    f.submit.mockRejectedValueOnce(new Error("offline"));
    await expect(
      f.service.respond(f.agent, f.response("submit")),
    ).rejects.toThrow("offline");
    expect(f.agent.interactivePlan?.submitted).toBe(false);
    let done!: () => void;
    f.submit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    const pending = f.service.respond(f.agent, f.response("submit"));
    await expect(
      f.service.publish(f.agent, {
        document,
        planId: f.agent.interactivePlan!.id,
        expectedRevision: 1,
      }),
    ).rejects.toThrow("in progress");
    await expect(f.service.respond(f.agent, f.response())).rejects.toThrow(
      "in progress",
    );
    await vi.waitFor(() => expect(done).toBeTypeOf("function"));
    done();
    await pending;
    expect(f.agent.interactivePlan?.submitted).toBe(true);
  });
  it("keeps ambiguous delivery locked after restart instead of resending accepted feedback", async () => {
    const f = fixture();
    await f.service.publish(f.agent, { document });
    f.persist
      .mockImplementationOnce(f.persist.getMockImplementation()!)
      .mockRejectedValueOnce(new Error("final write failed"));
    await expect(
      f.service.respond(f.agent, f.response("submit")),
    ).rejects.toThrow("final write failed");
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.agent.interactivePlan?.deliveryPending).toBe(true);
    const restored = f.restore().agents[0]!;
    expect(restored.interactivePlan?.deliveryPending).toBe(true);
    await expect(
      f.service.respond(restored, f.response("submit")),
    ).rejects.toThrow("unconfirmed");
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
});
