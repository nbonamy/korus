import { defineConfig } from "vitepress";
import { fileURLToPath } from "node:url";
import product from "../../../core/src/product.json";

export default defineConfig({
  lang: "en-US",
  title: product.name,
  description: `Set up your coding agents, coordinate work, and review the results in ${product.name}.`,
  base: "/docs/",
  markdown: {
    config(md) {
      md.core.ruler.before("normalize", "product-download", (state) => {
        state.src = state.src
          .replaceAll(
            "__PRODUCT_DOWNLOAD_URL__",
            `${product.websiteUrl}/#download`,
          )
          .replaceAll(
            "__PRODUCT_COMPANION_APP_STORE_URL__",
            product.companionAppStoreUrl,
          );
      });
    },
  },
  // These assets are already owned by the public landing page.
  vite: { publicDir: fileURLToPath(new URL("../../assets", import.meta.url)) },
  head: [["link", { rel: "icon", href: "/docs/app-icon.png?v=mark-2" }]],
  themeConfig: {
    logo: { src: "/app-icon.png?v=mark-2", alt: "" },
    siteTitle: `${product.name} Docs`,
    nav: [
      { text: "Website", link: product.websiteUrl },
      { text: "Install", link: "/getting-started/installation" },
      {
        text: "Download",
        link: `${product.websiteUrl}/#download`,
      },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    sidebar: [
      { items: [{ text: `${product.name} documentation`, link: "/" }] },
      {
        text: "Getting started",
        items: [
          { text: "Quickstart", link: "/getting-started/quickstart" },
          { text: "Core concepts", link: "/getting-started/core-concepts" },
          { text: "Installation", link: "/getting-started/installation" },
          { text: "Your first task", link: "/getting-started/first-task" },
        ],
      },
      {
        text: "Providers",
        collapsed: false,
        items: [
          { text: "Provider guides", link: "/providers/" },
          { text: "Codex", link: "/providers/codex" },
          { text: "Claude Code", link: "/providers/claude-code" },
          { text: "Antigravity", link: "/providers/#antigravity" },
        ],
      },
      {
        text: "Workflows",
        collapsed: false,
        items: [
          { text: "Parallel agents", link: "/workflows/parallel-agents" },
          { text: "Worktrees", link: "/workflows/worktrees" },
          { text: "Missions", link: "/workflows/missions" },
          { text: "Code review", link: "/workflows/code-review" },
        ],
      },
      {
        text: "Features",
        collapsed: false,
        items: [
          { text: "Conversations", link: "/features/conversations" },
          { text: "Workspace & diffs", link: "/features/workspace" },
          { text: "Browser", link: "/features/browser" },
          { text: "Visualize", link: "/features/visualize" },
          { text: "Automations", link: "/features/automations" },
          { text: "Computer Use", link: "/features/computer-use" },
        ],
      },
      {
        text: "Reference",
        collapsed: false,
        items: [
          { text: "Keyboard shortcuts", link: "/reference/keyboard-shortcuts" },
          {
            text: "Agent collaboration",
            link: "/reference/agent-collaboration",
          },
        ],
      },
      {
        text: "Troubleshooting",
        collapsed: false,
        items: [
          { text: "Troubleshooting", link: "/troubleshooting/" },
          { text: "Frequently asked questions", link: "/troubleshooting/faq" },
        ],
      },
    ],
    docFooter: { prev: "Previous", next: "Next" },
  },
});
