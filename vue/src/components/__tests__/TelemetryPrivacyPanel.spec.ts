import { flushPromises, mount } from "@vue/test-utils";
import { it, expect, vi } from "vitest";
import { setElectronTestClient } from "../../test/client";
import TelemetryPrivacyPanel from "../TelemetryPrivacyPanel.vue";
import TelemetryDisclosure from "../TelemetryDisclosure.vue";
it("shows accurate disabled status, saves opt-out and exposes only the pending report preview", async () => {
  const setTelemetryPrivacy = vi
    .fn()
    .mockResolvedValue({
      choice: { enabled: false, disclosure: 1 },
      active: false,
      blocked: null,
      pending: [],
    });
  setElectronTestClient({
    getTelemetryPrivacy: vi
      .fn()
      .mockResolvedValue({
        choice: { enabled: true, disclosure: 1 },
        active: false,
        blocked: "rollout",
        pending: [],
      }),
    setTelemetryPrivacy,
  });
  const wrapper = mount(TelemetryPrivacyPanel);
  await flushPromises();
  expect(wrapper.text()).toContain("Uploads are disabled");
  expect(wrapper.get("pre").text()).toBe("[]");
  await wrapper
    .findComponent({ name: "ElSwitch" })
    .vm.$emit("update:modelValue", false);
  await flushPromises();
  expect(setTelemetryPrivacy).toHaveBeenCalledExactlyOnceWith({
    enabled: false,
    disclosure: 1,
  });
  wrapper.unmount();
});
it("requires a first-run disclosure and allows disabling the default before continuing", async () => {
  const setTelemetryPrivacy = vi
    .fn()
    .mockResolvedValue({
      choice: { enabled: false, disclosure: 1 },
      active: false,
      blocked: "rollout",
      pending: [],
    });
  setElectronTestClient({
    getTelemetryPrivacy: vi
      .fn()
      .mockResolvedValue({
        choice: null,
        active: false,
        blocked: "disclosure",
        pending: [],
      }),
    setTelemetryPrivacy,
  });
  const wrapper = mount(TelemetryDisclosure, { attachTo: document.body });
  await flushPromises();
  expect(wrapper.text()).toContain("enabled by default");
  await wrapper.get('input[type="checkbox"]').setValue(false);
  await wrapper.get("button").trigger("click");
  await flushPromises();
  expect(setTelemetryPrivacy).toHaveBeenCalledWith({
    enabled: false,
    disclosure: 1,
  });
  wrapper.unmount();
});
