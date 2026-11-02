import {
  createRouter,
  createWebHistory,
  type RouterHistory,
  type RouteLocationNormalized,
} from "vue-router";
import Dashboard from "./Dashboard.vue";
import SignIn from "./SignIn.vue";
import { consolePages } from "./console-pages";
import type { ConsoleSession } from "./console-session";

export function loginDestination(
  route: Pick<RouteLocationNormalized, "query" | "hash">,
): string {
  const target = route.query.redirect ?? route.hash.replace(/^#/, "");
  return typeof target === "string" &&
    consolePages.some((page) => `/${page.id}` === target)
    ? target
    : "/overview";
}
export function createConsoleRouter(
  session: ConsoleSession,
  history: RouterHistory = createWebHistory(),
) {
  const router = createRouter({
    history,
    routes: [
      {
        path: "/",
        redirect: (to) => ({ path: loginDestination(to), hash: "" }),
      },
      { path: "/login", name: "login", component: SignIn },
      ...consolePages.map((page) => ({
        path: `/${page.id}`,
        name: page.id,
        component: Dashboard,
        props: { page: page.id },
        meta: { requiresAuth: true },
      })),
      { path: "/:pathMatch(.*)*", redirect: "/overview" },
    ],
  });
  router.beforeEach(async (to) => {
    const status = await session.check();
    if (status === "authenticated" && to.name === "login")
      return { path: loginDestination(to), replace: true };
    if (status === "anonymous" && to.meta.requiresAuth)
      return { name: "login", query: { redirect: to.path }, replace: true };
    return true;
  });
  return router;
}
