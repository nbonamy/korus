---
description: Use the agent's in-app browser for research and local previews.
---

# Browser

Each agent can use an in-app browser alongside its conversation for research and local verification. It has its own browsing session; it does not inherit your Chrome tabs, cookies, or extensions.

## Open a page

Select an agent, then open **Browser** from the workspace's **+** menu or press **⌘B** on macOS. Enter an HTTP or HTTPS URL in the address bar and press Enter. Back, forward, and reload controls work like a normal browser.

The address bar also accepts search text. Entering words such as `Vue accessibility guide` opens a Google search; recognizable addresses, including `localhost` with a port, navigate directly. This searches the web, not text within the current page.

You can also ask the agent to open a page:

```text
Open https://example.com in your in-app browser and summarize the
installation instructions.
```

For a local preview, ask the agent to start the project's development server and open the URL it reports. If the page cannot load, check that the server is still running and that the URL and port are reachable from the desktop browser.

## Save and reopen bookmarks

Use the star in the address bar to bookmark the current page, give it a recognizable name, and choose **Save**. Use **Bookmarks** in the browser toolbar to search saved names or URLs and reopen a page in the current agent's browser.

The bookmark list offers edit and delete actions. Editing changes the saved name; deleting removes the bookmark, not the page or project. Clicking the filled star also removes the current page's bookmark.

Bookmarks are saved across restarts and support HTTP and HTTPS pages without credentials embedded in the URL. They save an address, not the page contents or a running development server.

## Verify a workflow

Give the agent a concrete scenario to exercise:

```text
Start the development server and open it in your in-app browser.
Open Settings, change the display name, save, reload, and confirm
the new name persists. Report any console errors.
```

Agents can inspect the DOM, click controls, type, scroll, capture screenshots, and read console logs. Ask what was observed when the result depends on browser behavior.

## Check sizes and send visual feedback

Open the browser's **…** menu for:

- **Show device toolbar**: choose Responsive, Custom, Phone, Tablet, or Desktop dimensions. Set width and height or rotate the viewport to check a layout.
- **Zoom**: adjust page zoom or reset it to 100%.
- **Screenshot** and **Screenshot area**: copy a page capture or a dragged region to the clipboard.

Device dimensions help check responsive layout. Use a real device when the result depends on that device's browser, input, or hardware behavior.

Choose **Annotate page** to mark an element or area and add a comment. Collect the changes you want, then use the annotation send button. Korus sends the page URL, targets, and feedback to the agent as a request to inspect the rendered page and address those annotations.

## Keep context with the agent

Browser work belongs to the agent's workspace and can continue while another agent is selected. Select the same agent when returning to its preview or annotations.

## External browser work

Use Chrome when the task needs your existing Chrome login, tabs, or extensions:

1. Open **Settings → Plugins**.
2. Choose the **Chrome** control in the **Codex** section. It opens the Codex plugin manager; complete the Chrome plugin setup there.
3. Return to Korus and check the Chrome status. Start a new Codex agent if an existing session does not discover the newly enabled plugin.
4. Explicitly name Chrome and the page you want the agent to use.

```text
Use Chrome and my existing signed-in project tab to inspect the dashboard.
```

Chrome is a Codex plugin, separate from Korus's provider-neutral in-app browser. Opening a URL with **Open in external browser** uses your system browser; it does not enable agent control of that browser.

See [Computer Use](./computer-use) for native application interactions.
