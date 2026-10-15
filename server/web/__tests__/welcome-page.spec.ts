// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { welcomePage, signInScript } from "../welcome-page";
interface Element {
  value: string;
  textContent: string;
  disabled: boolean;
  dispatchEvent(event: unknown): void;
}
interface Page {
  open(): void;
  write(html: string): void;
  close(): void;
  querySelector(selector: string): Element;
}
interface Frame {
  contentDocument: Page;
  contentWindow: {
    eval(script: string): void;
    Event: new (name: string, options: { cancelable: boolean }) => unknown;
  };
  remove(): void;
}
it("submits the operator password only in a same-origin body, prevents duplicate submits, and recovers from rejection before signing in", async () => {
  const host = (
    globalThis as unknown as {
      document: {
        createElement(tag: string): Frame;
        body: { append(frame: Frame): void };
      };
    }
  ).document;
  const frame = host.createElement("iframe");
  host.body.append(frame);
  let resolve!: (value: { ok: boolean; status: number }) => void;
  let signedIn = false;
  const fetch = vi.fn((url: string, _input?: unknown) => {
    if (url === "/v1/operator/page")
      return Promise.resolve({
        ok: signedIn,
        status: signedIn ? 200 : 401,
        text: async () =>
          '<html><head><title>Console fixture</title></head><body><main id="console-ready"></main><script src="/assets/operator.js"></script></body></html>',
      });
    return new Promise<{ ok: boolean; status: number }>((done) => {
      resolve = done;
    });
  });
  try {
    const doc = frame.contentDocument;
    doc.open();
    doc.write(welcomePage);
    doc.close();
    Object.assign(frame.contentWindow, { fetch });
    frame.contentWindow.eval(signInScript);
    const input = doc.querySelector("#password"),
      button = doc.querySelector("button"),
      form = doc.querySelector("form"),
      error = doc.querySelector('[role="alert"]');
    input.value = "CANARY_operator_password";
    const submit = () =>
      form.dispatchEvent(
        new frame.contentWindow.Event("submit", { cancelable: true }),
      );
    submit();
    submit();
    expect(button.disabled).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/v1/operator/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "CANARY_operator_password" }),
    });
    resolve({ ok: false, status: 401 });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(error.textContent.length).toBeGreaterThan(0);
    expect(error.textContent).not.toContain(input.value);
    expect(doc.querySelector("#console-ready")).toBeNull();
    expect(
      fetch.mock.calls.filter(([url]) => url === "/v1/operator/session"),
    ).toHaveLength(1);
    submit();
    signedIn = true;
    resolve({ ok: true, status: 200 });
    await vi.waitFor(() =>
      expect(doc.querySelector("#console-ready")).not.toBeNull(),
    );
    expect(doc.querySelector("form")).toBeNull();
    expect(input.value).toBe("");
    expect(error.textContent).toBe("");
  } finally {
    frame.remove();
  }
});
