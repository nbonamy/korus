// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ElPopover, ElSwitch } from "element-plus";
import ConsoleApp from "../ConsoleApp.vue";
import { createConsoleSession } from "../console-session";
import { createConsoleRouter } from "../router";
import { createWebHistory } from "vue-router";
import { metrics } from "./metrics-fixture";
// Public rendered boundary: no reports before sign-in, generic credential errors,
// no password/token persistence, expiry purges, logout failure and recovery.
const credentialStorage = { setItem: vi.fn() };
beforeEach(() => {
  credentialStorage.setItem.mockClear();
  vi.stubGlobal("localStorage", credentialStorage);
  vi.stubGlobal("sessionStorage", credentialStorage);
  window.history.replaceState({}, "", "/login#/models");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});
const render = () => {
  const session = createConsoleSession(),
    router = createConsoleRouter(session, createWebHistory());
  return mount(ConsoleApp, {
    props: { session },
    attachTo: document.body,
    global: { plugins: [router], components: { ElPopover, ElSwitch } },
  });
};
it("does not render login or protected data before the session check finishes", async () => {
  for (const [path, status, heading] of [
    ["/login?redirect=/models", 204, "Models"],
    ["/models", 204, "Models"],
    ["/models", 401, "Sign in"],
  ] as const) {
    window.history.replaceState({}, "", path);
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/auth/session"
          ? new Promise<Response>((done) => {
              resolve = done;
            })
          : Promise.resolve(Response.json(metrics())),
      ),
    );
    const wrapper = render();
    await flushPromises();
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Provider and model"]').exists()).toBe(
      false,
    );
    resolve(new Response(null, { status }));
    await flushPromises();
    expect(wrapper.get("h1").text()).toBe(heading);
    wrapper.unmount();
  }
});
it("recovers session-check outages without presenting login and rejects external return targets", async () => {
  window.history.replaceState(
    {},
    "",
    "/login?redirect=https://external.invalid",
  );
  let unavailable = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/auth/session"
        ? new Response(null, { status: unavailable ? 503 : 204 })
        : Response.json(metrics()),
    ),
  );
  const wrapper = render();
  await flushPromises();
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  expect(wrapper.get('[role="alert"]').text()).toContain("Could not check");
  unavailable = false;
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(window.location.pathname).toBe("/overview");
  expect(wrapper.get("h1").text()).toBe("Overview");
  wrapper.unmount();
});
it("signs in through the server, clears credentials and handles logout failure before successful revocation", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const responses = [
    new Response(null, { status: 401 }),
    new Response("PRIVATE_DIAGNOSTIC", { status: 401 }),
    new Response(null, { status: 204 }),
    Response.json(metrics()),
    new Response(null, { status: 503 }),
    new Response(null, { status: 204 }),
    new Response(null, { status: 401 }),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return responses.shift()!;
    }),
  );
  const wrapper = render();
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("Sign in");
  expect(requests.map((r) => r.url)).toStrictEqual(["/auth/session"]);
  const username = wrapper.get('input[autocomplete="username"]'),
    password = wrapper.get('input[autocomplete="current-password"]');
  await username.setValue("admin");
  await password.setValue("wrong");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "Incorrect username or password.",
  );
  expect(wrapper.text()).not.toContain("PRIVATE_DIAGNOSTIC");
  expect((password.element as HTMLInputElement).value).toBe("");
  await password.setValue("synthetic-test-password");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(window.location.pathname).toBe("/models");
  expect(window.location.hash).toBe("");
  expect(wrapper.get("h1").text()).toBe("Models");
  expect(JSON.parse(requests[2]!.init.body as string)).toStrictEqual({
    username: "admin",
    password: "synthetic-test-password",
  });
  expect(requests[2]!.init.credentials).toBe("same-origin");
  expect(wrapper.find('input[type="password"]').exists()).toBe(false);
  expect(credentialStorage.setItem).not.toHaveBeenCalled();
  await wrapper.get('button[aria-label="Sign out"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "Could not sign out. Try again.",
  );
  expect(wrapper.get("h1").text()).toBe("Models");
  await wrapper.get('button[aria-label="Sign out"]').trigger("click");
  await flushPromises();
  expect(requests[5]!.init.method).toBe("DELETE");
  expect(wrapper.get("h1").text()).toBe("Sign in");
  expect(window.location.pathname).toBe("/login");
  expect(wrapper.find('[aria-label="Provider and model"]').exists()).toBe(
    false,
  );
  wrapper.unmount();
});
it("reuses an existing server session and returns to sign-in when private access expires", async () => {
  const responses = [
    new Response(null, { status: 204 }),
    Response.json(metrics()),
    new Response(null, { status: 401 }),
    new Response(null, { status: 401 }),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => responses.shift()!),
  );
  const wrapper = render();
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("Models");
  await wrapper.get('button[aria-label="Refresh metrics"]').trigger("click");
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("Sign in");
  expect(wrapper.find('[aria-label="Provider and model"]').exists()).toBe(
    false,
  );
  expect(window.location.pathname).toBe("/login");
  wrapper.unmount();
});
