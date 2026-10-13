import { describe, expect, it, vi } from "vitest";
import type { InteractivePlan } from "@workspace/core/interactive-plan";
import {
  interactivePlanFrame,
  planFrameAnswers,
} from "../interactive-plan-frame";
const hostile =
  '</textarea><script>parent.electron.run()</script><img src="https://attacker.test">';
const plan: InteractivePlan = {
  agentId: "owner",
  conversationId: "thread",
  id: "p",
  revision: 1,
  answerVersion: 0,
  submitted: false,
  history: [],
  answers: { choices: {}, comments: { claim: hostile } },
  document: {
    title: hostile,
    sections: [
      {
        id: "claim",
        claim: hostile,
        exhibit: { title: "Exhibit", text: hostile },
      },
      {
        id: "mockup",
        claim: "Hostile mockup",
        exhibit: {
          title: hostile,
          text: hostile,
          screens: [
            {
              label: hostile,
              title: hostile,
              fields: [{ label: hostile, value: hostile }],
              items: [{ title: hostile, detail: hostile }],
            },
          ],
        },
      },
    ],
  },
};
describe("plan sandbox generation", () => {
  it("renders hostile document and user strings as text with no injected elements or handlers", () => {
    const html = interactivePlanFrame(
      plan,
      "nonce",
      {
        background: "red;url(https://attacker.test)",
        foreground: "black",
        primary: "blue",
        border: "gray",
      },
      { comment: "Comment", proposed: "Proposed", clear: "Clear" },
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(
      document.querySelectorAll("img,a,iframe,form,[onclick]"),
    ).toHaveLength(0);
    expect(document.querySelector("h1")!.textContent).toBe(hostile);
    expect(document.querySelector("textarea")!.textContent).toBe(hostile);
    expect(document.querySelector("pre")!.textContent).toBe(hostile);
    expect(document.querySelector(".mockup-field > div")!.textContent).toBe(
      hostile,
    );
    expect(document.querySelector(".mockup-item strong")!.textContent).toBe(
      hostile,
    );
    expect(document.querySelector("style")!.textContent).not.toContain(
      "attacker.test",
    );
    expect(
      document.querySelector("meta[http-equiv]")!.getAttribute("content"),
    ).toContain("connect-src 'none'");
  });
  it("keeps comments out of the way until requested and posts explicit edits without selecting proposals", async () => {
    const document = {
      title: "Rename product",
      sections: [
        {
          id: "identity",
          claim: "One identity",
          exhibit: {
            title: "App chrome",
            text: "The title changes.",
            screens: [
              { label: "Before", title: "codex-claw" },
              { label: "After", title: "Korus" },
            ],
          },
          decision: {
            question: "Compatibility?",
            options: [
              { id: "keep", label: "Keep aliases" },
              { id: "remove", label: "New names only" },
            ],
            proposed: "keep",
          },
        },
      ],
    };
    const html = interactivePlanFrame(
      { ...plan, document, answers: { choices: {}, comments: {} } },
      "nonce",
      {
        background: "white",
        foreground: "black",
        primary: "blue",
        border: "gray",
      },
      { comment: "Comment", proposed: "Proposed", clear: "Clear" },
    );
    const frame = globalThis.document.createElement("iframe");
    globalThis.document.body.append(frame);
    try {
      const doc = frame.contentDocument!;
      const parsed = new DOMParser().parseFromString(html, "text/html");
      doc.body.innerHTML = parsed.body.innerHTML;
      const post = vi.fn();
      new Function(
        "document",
        "parent",
        parsed.querySelector("script")!.textContent!,
      )(doc, { postMessage: post });
      expect(doc.querySelectorAll(".mockup-screen")).toHaveLength(2);
      expect(doc.querySelectorAll("input:checked")).toHaveLength(0);
      const editor = doc.querySelector("textarea")!;
      expect(editor.hidden).toBe(true);
      (doc.querySelector("[data-comment-toggle]") as HTMLButtonElement).click();
      expect(editor.hidden).toBe(false);
      expect(doc.activeElement).toBe(editor);
      (doc.querySelector("[data-comment-toggle]") as HTMLButtonElement).click();
      expect(editor.hidden).toBe(true);
      (doc.querySelector("[data-comment-toggle]") as HTMLButtonElement).click();
      expect(editor.hidden).toBe(false);
      editor.value = "Keep my settings";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      expect(post).toHaveBeenLastCalledWith(
        expect.objectContaining({
          answers: { choices: {}, comments: { identity: "Keep my settings" } },
        }),
        "*",
      );
      editor.blur();
      expect(editor.hidden).toBe(true);
      expect(
        doc.querySelector("[data-comment-preview]")!.textContent,
      ).toContain("Keep my settings");
      (doc.querySelector("input") as HTMLInputElement).click();
      expect(post).toHaveBeenLastCalledWith(
        expect.objectContaining({
          answers: {
            choices: { identity: "keep" },
            comments: { identity: "Keep my settings" },
          },
        }),
        "*",
      );
      (doc.querySelector("[data-clear]") as HTMLButtonElement).click();
      expect(doc.querySelectorAll("input:checked")).toHaveLength(0);
    } finally {
      frame.remove();
    }
  });
  it("refuses a nonopaque origin and submitted revisions even from the correct frame", () => {
    const payload = {
      type: "plan-answers",
      agentId: "owner",
      conversationId: "thread",
      planId: "p",
      revision: 1,
      nonce: "nonce",
      answers: { choices: {}, comments: { claim: "Why?" } },
    };
    const event = new MessageEvent("message", {
      source: window,
      origin: "https://example.test",
      data: payload,
    });
    expect(planFrameAnswers(event, window, plan, "nonce")).toBeNull();
    expect(
      planFrameAnswers(
        new MessageEvent("message", {
          source: window,
          origin: "null",
          data: payload,
        }),
        window,
        { ...plan, submitted: true },
        "nonce",
      ),
    ).toBeNull();
  });
});
