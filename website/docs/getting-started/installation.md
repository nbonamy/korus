---
description: Download and install the Korus desktop app.
---

# Installation

[Choose your platform](__PRODUCT_DOWNLOAD_URL__): **macOS Apple silicon**, **Windows x64**, or **Linux x64 / ARM64**. Computer Use and AppShots are macOS-only.

## Install on macOS

1. Open [Downloads](__PRODUCT_DOWNLOAD_URL__) and choose the macOS DMG for Apple silicon.
2. Open the DMG and double-click Korus. It installs in Applications and launches. If an installed copy needs replacing, confirm **Replace**; your chats and settings are kept.
3. If Korus asks you to use Finder, choose **Open Applications**, drag Korus there from the DMG, and approve the installation in Finder. Then open Korus from Applications.
4. The first-run screen checks your coding engines. Detected engines offer **Connect** and **Customize**. If one is missing, use **Install** and follow its setup flow; the refresh icon rechecks detection.
5. Choose how each engine should store its setup before connecting it. Follow the steps below, then open a repository.

## Install on Windows

Choose the **Windows x64 installer** from [Downloads](__PRODUCT_DOWNLOAD_URL__), run it, and launch Korus. The Windows build is unsigned, so Windows may display a security warning. Verify that the file came from the official GitHub release before proceeding. A ZIP is also provided for manual extraction.

## Install on Linux

Choose **x64** or **ARM64** to match your system, then select the **DEB**, **RPM**, or **ZIP** format from [Downloads](__PRODUCT_DOWNLOAD_URL__). Use your distribution's package manager for DEB or RPM files; extract the ZIP for a manual installation. Korus does not infer Linux architecture from your browser.

## Updates

Packaged macOS and installed Windows apps receive stable releases through the app's updater. Linux, portable Windows, and prereleases use manual downloads from GitHub Releases. Choose the build for your platform and architecture.

## Choose separate or existing provider setup

Korus uses your existing Codex and Claude Code setup by default, including their sign-in. To keep Korus chats separate, click **Customize** beneath the engine on the first-run screen and choose **Separate Korus chats**. Saved setup choices are preserved.

| Choice | Use it when |
| --- | --- |
| **Separate Korus chats** | You want Korus's chats and provider sign-in kept in a separate setup environment. |
| **Use existing setup** | You want Korus to use the provider environment already configured on this computer. |

This choice is independent for each engine. Selecting an existing setup or signing in to one engine does not configure or authenticate the others.

Follow the [provider setup overview](../providers/) before changing an existing setup. It explains skills and plugin sharing, the selected provider location, and what happens to Korus conversations when you switch locations later.

## Connect at least one engine

Korus does not include a separate model subscription. Connect a provider account with access to the engine you want to use.

A separate Claude Code installation is optional when Korus's bundled runtime is available. On macOS, Codex can use ChatGPT's runtime if there is no standalone CLI. These runtime choices do not replace provider sign-in or grant model access.

1. If your chosen engine already shows **Connected**, no sign-in is needed. Otherwise, select **Connect** and complete its authentication steps.
2. Confirm the engine is connected and enabled. The first-run **Continue** action becomes available when at least one installed engine is connected and enabled; additional engines are optional.
3. Select **Continue**.

Use the [provider guides](../providers/), including [Antigravity setup](../providers/#antigravity), for the engine you choose. A detected installation alone does not establish that its selected setup environment is signed in.

## Connect GitHub, or skip it

If GitHub CLI (`gh`) is authenticated to github.com on this computer, Korus detects that access. Choose **Connect GitHub** for faster direct access, or **Use GitHub CLI** to continue with your existing CLI sign-in. Without authenticated CLI access, choose **Skip for now** to start with a local folder. You can connect later in **Settings → Integrations**.

GitHub authorization is separate from your coding provider's account. You can run a local repository task without connecting GitHub.

## Open a working folder

In the empty workspace, choose **Existing folder or repository…** to open a checkout already on disk. The same start-work menu offers a new project, a GitHub repository, or a repository URL.

For a first task, choose a small local repository whose branch and existing changes you understand. Continue with the [quickstart](./quickstart).

## Development builds

Building from source uses the Node 26 reference toolchain. Follow the
[repository README](https://github.com/nbonamy/korus#development) for the pinned
Node version, npm setup, and development instructions. The packaged desktop app
includes its own Node runtime, so you do not need to install Node to use it.

Experimental source builds may expose behavior that differs from the desktop release. When reporting a problem, include the app version and whether you are using a release or a development build.

## Next step

Follow the [quickstart](./quickstart). If launch or authentication fails, start with [Troubleshooting](../troubleshooting/).
