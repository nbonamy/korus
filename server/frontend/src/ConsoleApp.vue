<template>
  <main v-if="session.status.value === 'unavailable'" class="sign-in-page">
    <div role="alert">
      Could not check your session. <ElButton @click="retry">Retry</ElButton>
    </div>
  </main>
  <main
    v-else-if="waiting"
    class="sign-in-page"
    role="status"
    aria-label="Loading console"
  >
    Loading…
  </main>
  <RouterView v-else v-slot="{ Component }">
    <component
      :is="Component"
      :signing-out="signingOut"
      :auth-error="error"
      @authenticated="authenticated"
      @session-expired="expired"
      @sign-out="signOut"
    />
  </RouterView>
</template>
<script setup lang="ts">
import { computed, ref, onUnmounted } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { ElButton } from "element-plus";
import { sessionRequest } from "./session";
import { loginDestination } from "./router";
import type { ConsoleSession } from "./console-session";
const props = defineProps<{ session: ConsoleSession }>();
const route = useRoute(),
  router = useRouter();
const signingOut = ref(false),
  error = ref("");
const controller = new AbortController();
const waiting = computed(
  () =>
    ["unknown", "checking"].includes(props.session.status.value) ||
    (route.meta.requiresAuth && props.session.status.value !== "authenticated"),
);
async function authenticated() {
  error.value = "";
  props.session.authenticate();
  await router.replace(loginDestination(route));
}
async function expired() {
  error.value = "";
  props.session.expire();
  await router.replace({ name: "login", query: { redirect: route.path } });
}
async function retry() {
  const status = await props.session.check(true);
  if (status === "authenticated" && route.name === "login")
    await router.replace(loginDestination(route));
  else if (status === "anonymous" && route.meta.requiresAuth) await expired();
}
async function signOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  error.value = "";
  try {
    const response = await sessionRequest("DELETE", controller.signal);
    if (!controller.signal.aborted) {
      if (response.status === 204 || response.status === 401) await expired();
      else error.value = "Could not sign out. Try again.";
    }
  } catch {
    if (!controller.signal.aborted)
      error.value = "Could not sign out. Try again.";
  } finally {
    signingOut.value = false;
  }
}
onUnmounted(() => {
  controller.abort();
  props.session.dispose();
});
</script>
