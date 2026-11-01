<template>
  <SignIn
    v-if="login"
    :check-session="checkSession"
    @authenticated="showConsole"
  />
  <Dashboard
    v-else
    :signing-out="signingOut"
    :auth-error="error"
    @session-expired="showLogin"
    @sign-out="signOut"
  />
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import SignIn from "./SignIn.vue";
import Dashboard from "./Dashboard.vue";
import { sessionRequest } from "./session";
const isLogin = () => window.location.pathname.replace(/\/+$/, "") === "/login";
const login = ref(isLogin()),
  checkSession = ref(true),
  signingOut = ref(false),
  error = ref("");
const controller = new AbortController();
function showConsole() {
  error.value = "";
  window.history.replaceState({}, "", `/${window.location.hash}`);
  login.value = false;
}
function showLogin() {
  error.value = "";
  checkSession.value = false;
  window.history.replaceState({}, "", `/login${window.location.hash}`);
  login.value = true;
}
function navigate() {
  checkSession.value = true;
  login.value = isLogin();
}
async function signOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  error.value = "";
  try {
    const response = await sessionRequest("DELETE", controller.signal);
    if (!controller.signal.aborted) {
      if (response.status === 204 || response.status === 401) showLogin();
      else error.value = "Could not sign out. Try again.";
    }
  } catch {
    if (!controller.signal.aborted)
      error.value = "Could not sign out. Try again.";
  } finally {
    signingOut.value = false;
  }
}
onMounted(() => window.addEventListener("popstate", navigate));
onUnmounted(() => {
  controller.abort();
  window.removeEventListener("popstate", navigate);
});
</script>
