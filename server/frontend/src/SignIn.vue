<template>
  <main class="sign-in-page">
    <section class="sign-in-panel" aria-labelledby="sign-in-title">
      <div class="brand sign-in-brand">
        <img :src="productIcon" alt="" width="44" height="44" /><span
          class="brand-copy"
          ><strong>{{ productName }}</strong
          ><span>Console</span></span
        >
      </div>
      <h1 id="sign-in-title">Sign in</h1>
      <form
        aria-label="Console sign in"
        method="post"
        action="/auth/session"
        @submit.prevent="signIn"
      >
        <FormField
          label="Username"
          label-for="console-username"
          density="compact"
        >
          <ElInput
            id="console-username"
            ref="usernameInput"
            v-model="username"
            name="username"
            autocomplete="username"
            :spellcheck="false"
            :maxlength="64"
            :disabled="busy"
            required
          />
        </FormField>
        <FormField
          label="Password"
          label-for="console-password"
          density="compact"
        >
          <ElInput
            id="console-password"
            ref="passwordInput"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            show-password
            :maxlength="1024"
            :disabled="busy"
            required
          />
        </FormField>
        <p v-if="error" role="alert" class="sign-in-error">{{ error }}</p>
        <ElButton
          type="primary"
          native-type="submit"
          :loading="busy"
          :disabled="busy"
          >Sign in</ElButton
        >
      </form>
    </section>
  </main>
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import { ElInput, ElButton } from "element-plus";
import FormField from "@workspace/vue/shared/form/FormField.vue";
import productIcon from "../../../client/electron/assets/icon.svg";
import { sessionRequest } from "./session";
const emit = defineEmits<{ authenticated: [] }>();
const productName =
  typeof __PRODUCT_NAME__ === "undefined" ? "Console" : __PRODUCT_NAME__;
const username = ref("admin"),
  password = ref(""),
  error = ref(""),
  busy = ref(false);
const usernameInput = ref<InstanceType<typeof ElInput>>(),
  passwordInput = ref<InstanceType<typeof ElInput>>();
const controller = new AbortController();
function authenticated() {
  username.value = "";
  password.value = "";
  emit("authenticated");
}
async function signIn() {
  if (busy.value) return;
  error.value = "";
  if (!username.value.trim() || !password.value) {
    error.value = "Enter your username and password.";
    return;
  }
  busy.value = true;
  try {
    const response = await sessionRequest("POST", controller.signal, {
      username: username.value.trim(),
      password: password.value,
    });
    if (controller.signal.aborted) return;
    if (response.status === 204) {
      authenticated();
      return;
    }
    error.value =
      response.status === 401
        ? "Incorrect username or password."
        : response.status === 429
          ? "Too many attempts. Try again shortly."
          : "Sign-in is unavailable. Try again.";
  } catch {
    if (!controller.signal.aborted)
      error.value = "Sign-in is unavailable. Try again.";
  } finally {
    password.value = "";
    busy.value = false;
    await nextTick();
    if (error.value) passwordInput.value?.focus();
  }
}
onMounted(async () => {
  document.title = `Sign in · ${productName} Console`;
  await nextTick();
  passwordInput.value?.focus();
});
onUnmounted(() => {
  controller.abort();
  username.value = "";
  password.value = "";
});
</script>
