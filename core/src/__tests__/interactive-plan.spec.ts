import { describe, expect, it } from "vitest";
import {
  isInteractivePlanDocument,
  isPlanAnswers,
  interactivePlanFeedback,
  interactivePlanMarkdown,
  type InteractivePlan,
} from "../interactive-plan";
const plan: InteractivePlan = {
  agentId: "a",
  conversationId: "c",
  id: "p",
  revision: 1,
  answerVersion: 0,
  submitted: false,
  history: [],
  answers: { choices: {}, comments: {} },
  document: {
    title: "Plan",
    sections: [
      {
        id: "one",
        claim: "Users choose.",
        decision: {
          question: "Which?",
          proposed: "a",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      },
    ],
  },
};
describe("interactive plan input boundaries", () => {
  it("rejects duplicate identities, unknown defaults, excessive depth, oversized content and prototype keys", () => {
    expect(isInteractivePlanDocument(plan.document)).toBe(true);
    for (const document of [
      {
        ...plan.document,
        sections: [plan.document.sections[0], plan.document.sections[0]],
      },
      {
        ...plan.document,
        sections: [
          {
            ...plan.document.sections[0],
            decision: {
              ...plan.document.sections[0]!.decision,
              proposed: "missing",
            },
          },
        ],
      },
      { ...plan.document, sections: [{ id: "__proto__", claim: "Bad key" }] },
      { ...plan.document, sections: [{ id: "one", claim: "x".repeat(501) }] },
      {
        ...plan.document,
        sections: [
          {
            id: "one",
            claim: "one",
            children: [
              {
                id: "two",
                claim: "two",
                children: [
                  {
                    id: "three",
                    claim: "three",
                    children: [{ id: "four", claim: "four" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
      expect(isInteractivePlanDocument(document)).toBe(false);
    expect(
      isPlanAnswers({ choices: { missing: "a" }, comments: {} }, plan.document),
    ).toBe(false);
    expect(
      isPlanAnswers(
        { choices: {}, comments: { one: "x".repeat(4001) } },
        plan.document,
      ),
    ).toBe(false);
  });
  it("accepts bounded visual mockups and rejects malformed persisted screens", () => {
    const screen = {
      label: "After",
      title: "Korus",
      navigation: ["Home", "Files"],
      activeItem: "Home",
      content: ["Welcome"],
      actions: ["Open"],
      fields: [{ label: "Destination", value: "~/.korus" }],
      items: [{ title: "Preferences", detail: "Keep settings" }],
    };
    const document = {
      title: "Rename product",
      sections: [
        {
          id: "identity",
          claim: "One identity",
          exhibit: {
            title: "App chrome",
            text: "The app title becomes Korus.",
            screens: [screen],
          },
        },
      ],
    };
    expect(isInteractivePlanDocument(document)).toBe(true);
    for (const screens of [
      [],
      Array(4).fill(screen),
      [{ ...screen, title: 12 }],
      [{ ...screen, navigation: Array(9).fill("Home") }],
      [{ ...screen, activeItem: "Missing" }],
      [{ ...screen, fields: [{ label: "Path", value: 12 }] }],
      [{ ...screen, items: [{ title: "Entry", detail: {} }] }],
      [{ ...screen, html: "<script>run()</script>" }],
    ]) {
      expect(
        isInteractivePlanDocument({
          ...document,
          sections: [
            {
              ...document.sections[0],
              exhibit: { ...document.sections[0]!.exhibit, screens },
            },
          ],
        }),
      ).toBe(false);
    }
  });
  it("distinguishes unanswered proposals and exports a readable plan with attached feedback", () => {
    expect(interactivePlanFeedback(plan, plan.answers)).toContain(
      '"answered": false',
    );
    const answered = {
      ...plan,
      answers: { choices: { one: "b" }, comments: { one: "Why?" } },
    };
    expect(interactivePlanMarkdown(answered)).toContain("B (selected)");
    expect(interactivePlanMarkdown(answered)).toContain("Comment: Why?");
  });
  it("keeps revision details in context with lossless feedback and a concise visible request", () => {
    const comment =
      'Explain </context> and <CONTEXT> literally, including "quotes".\nKeep the draft.';
    const claim = "Display <context> as text, not </CONTEXT> markup.";
    const current = {
      ...plan,
      document: {
        ...plan.document,
        sections: [{ ...plan.document.sections[0]!, claim }],
      },
    };
    const prompt = interactivePlanFeedback(current, {
      choices: { one: "b" },
      comments: { one: comment },
    });
    expect(prompt.match(/<\/?context>/giu)).toStrictEqual([
      "<context>",
      "</context>",
    ]);
    expect(prompt.replace(/<context>[\s\S]*?<\/context>/gu, "").trim()).toBe(
      "Revise the plan using my feedback.",
    );
    const context = prompt.match(/<context>\n([\s\S]*?)\n<\/context>/u)![1]!;
    expect(context).toContain("not implementation approval");
    expect(JSON.parse(context.slice(context.indexOf("{")))).toStrictEqual({
      agentId: "a",
      conversationId: "c",
      planId: "p",
      revision: 1,
      sections: [
        {
          sectionId: "one",
          claim,
          question: "Which?",
          choice: "b",
          proposed: "a",
          answered: true,
          comment,
        },
      ],
    });
  });
});
