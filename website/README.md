# Korus website

This contains the static landing page and VitePress documentation for [meetkorus.dev](https://meetkorus.dev).

## Local preview

```bash
npm run docs:build
node website/build.mjs
npx vite dist/website --host 127.0.0.1 --port 4173 --strictPort
```

Then open <http://127.0.0.1:4173>.

Product metadata comes from `core/src/product.json`. The landing-page build
expands the product name, canonical URL, and GitHub download links; VitePress reads the
same definition and sends `__PRODUCT_DOWNLOAD_URL__` guide links to the platform chooser. Preview
the built artifact so the name and documentation are both available.

## Documentation

The public user guide lives in `website/docs/` and uses VitePress with a
customized default theme. The navigation follows Getting started, Providers,
Workflows, Features, Reference, and Troubleshooting. Internal engineering notes
stay in the repository's top-level `docs/` directory and are not published.

Describe product behavior directly in the public guide. Do not add release
planning notices, upcoming-version labels, or comparisons between `main` and
the published app. Keep release status and version history in release notes.

Run from the repository root:

```bash
npm run docs:dev
```

Open the `/docs/` URL reported by VitePress. Edit the Markdown pages and keep
the sidebar in `website/docs/.vitepress/config.mts` in sync. Search uses the
local page index and requires no hosted search service. The theme reuses the
landing page's public assets and supplies light and dark tokens.

Build, check, and preview the complete static website:

```bash
npm run test:docs
npm run docs:check
npx vite dist/website --host 127.0.0.1 --port 4173 --strictPort
```

Visit <http://127.0.0.1:4173/docs/>. `test:docs` builds the site and checks the
generated links, anchors, asset paths, and exclusion of authoring files.
`npm run docs:preview` previews just the VitePress production output after
`npm run docs:build`.

Use a file extension on raw HTML card links so direct loads work on the static
host. Keep VitePress's dead-link checking enabled. The site uses `/docs/` as
its base path and standard `.html` page URLs, so nginx needs no SPA rewrite
for documentation routes.

## Product preview

The visual identity uses warm off-white, charcoal, and restrained slate-blue
accents. Films keep charcoal title cards and the same quiet accent palette;
green and red communicate success and defects. Shared film branding comes
from `videos/product.mjs`, including the closing URL from product metadata.

All Korus marks use the exact geometry in `electron/assets/icon.svg`. The
website and Vue branding PNGs share a rounded web presentation; desktop icons
remain full-square. Composite the canonical vector into thumbnails, the social
card, and the channel banner rather than asking image generation to redraw it.
Re-export the films after updating their shared `website/assets/app-icon.png`.

The hero leads with three visitor problems—parallel work, reliable results,
and big ideas—each answered by a self-hosted product film: Delegation, Code
Review, and Mission. Quick Chat and Visualize films sit in the feature cards.
Activity view, Automations, and Background runtime show real screenshots from
`assets/screens/`, captured from the running app with neutral demo data (a
sample storefront team, no private repository names or account details).
Refresh them with the `korus-live-preview` skill when those surfaces change,
and bump the `?v=` query on the image URLs. Computer Use and the choice of
agents stay text-only until a faithful capture exists.

The Activity view capture focuses on the sidebar so its priorities remain
readable. It uses isolated Storefront demo agents, including a pending question,
an unread result, and a running task; no private workspace or account data is shown.

The simulator card uses `assets/screens/simulator.svg`: an illustration of the
simulator pane with an embedded, unaltered capture of iOS Settings. The surrounding
device frame and controls are illustrative; this is not a full app screenshot.

The hero previews the selected film muted and without controls, then advances
to the next tab when it ends. Only the selected film loads; the others stay off
the network until chosen. With reduced motion, the hero shows posters and plays
nothing until asked. **Watch with sound** restarts the current film with sound,
captions, and native controls, and it then stays on that film. Without
JavaScript, the link opens the MP4 directly.

Feature-card films open from their rendered poster frame. No MP4 is requested
until the visitor clicks; native controls provide seeking and fullscreen. Only one
film plays at a time across the page. The films use the approved Calm American
narration and pacing. Feature-card playback starts muted with captions on;
visitors can unmute using the native controls or use the understated Captions
on/off text link below each player. Sound, volume, and caption choices apply to
the feature-card players until the page reloads. Captions sit near the bottom of
the video; native controls may adjust their placement. Captions are separate
WebVTT tracks and also available through the native player's menu. Subtitle
files are loaded only when the visitor opens a film. Cover links also open the
MP4 directly without JavaScript. These are animated walkthroughs, not live
recordings.

Before building or deploying from a fresh checkout, render all five films:

```bash
npm ci --prefix videos/remotion
npm run render --prefix videos/remotion -- --all
```

The exporter uses existing approved takes without synthesizing speech; see
**Calm American five-film exports** below when preparing new narration. The build
uses the approved narrated MP4s, VTTs, and timing manifest from
`videos/local/narrated/` (override with `APP_NARRATED_FILMS`) plus the
ignored poster outputs in `videos/assets/`. Missing assets stop the build with
an actionable error; it never falls back to silent videos. MP4s, VTTs, and posters are copied into
`dist/website/media/` using content-hashed filenames to avoid stale caches.
Do not commit these rebuildable outputs; deployments upload them with the rest
of the static artifact. YouTube uploads are independent of the website.

Keep visuals free of private repository names, messages, and account details.
The page positions Korus as a team of coding agents it orchestrates. Lead with
the problems visitors recognize, explain the value without becoming a release
changelog, and promise only what the shipped product does.

Run the static-site checks with:

```bash
npm run test:website
```

The header keeps **Docs** visible beside the download button at all screen
widths. Its responsive browser regression test uses Chromium:

```bash
npx playwright install chromium
npm run test:website:browser
```

## Remotion films

`videos/remotion/` is the rendering project for the five widescreen films and
Quick Chat Shorts. Each film has a source composition; the five widescreen
films also have narrated compositions using approved Calm American takes.

```bash
npm ci --prefix videos/remotion
npm run studio --prefix videos/remotion
npm run render --prefix videos/remotion -- --all
```

Studio reports its local preview URL. It uses the same HTML, CSS, and shared
controllers as the editable browser viewers, with Remotion supplying the
frame clock and audio. Frames are mapped directly to measured narration
timing, including the approved pauses; no intermediate video is stretched.

The batch writes narrated MP4s, optional WebVTT captions, and the review player
to `videos/local/narrated/`, posters to `videos/assets/`, and the silent
Shorts MP4 to `videos/assets/project-shorts.mp4`. These paths are the website’s
existing media contract. Open the review player with:

```bash
npx vite videos/local/narrated --host 127.0.0.1 --port 4190 --strictPort
```

Export just one narrated film, or silent source films for draft voice work:

```bash
npm run render --prefix videos/remotion -- review-film
npm run render --prefix videos/remotion -- --all --silent
```

FFmpeg is required for audio preparation; Remotion manages its headless
browser. Source compositions work without narration. Narrated exports require
approved WAVs and matching provenance/alignment files; stale copy or missing
takes stop the export rather than substituting a voice. Studio loads cached
narrated compositions when those approved takes are present.

Prepared markup, styles, normalized audio, manifests, and temporary bundles
stay ignored under `videos/local/remotion/`. Editing film source does not
require copying it into the rendering project. Do not commit generated media.

## Mission product film

`videos/mission-film.html` is an editable 48-second HTML/CSS/JavaScript illustration of a Mission moving from prompt through Requirements, Tickets, Implementation, Review, and Ship. After the PR action, it cuts to a clear promotional handoff showing the pull request ready for review, then returns to the closing title. The Mission scenes follow the desktop app's three-pane layout and current light-theme tokens. The cloud-agent feature and PR shown are an illustrative scenario, not a claim that cloud-agent support has shipped or a recording of a live run.

Preview the films from the repository root with `python3 -m http.server 4174 --directory .`, then open <http://127.0.0.1:4174/videos/mission-film.html>. The pages have play, pause, restart, and scrub controls. To export a silent, caption-led 1600×900 MP4 and poster image with Remotion, run:

```bash
npm run render --prefix videos/remotion -- mission-film --silent
```

The render writes `videos/assets/mission-film.mp4` and
`videos/assets/mission-film-poster.png`. These rebuildable outputs are ignored
by Git. Thumbnails remain tracked source artwork, and the films reuse the
website’s Korus icon. The shared choreography drives both the browser preview
and Remotion composition.

## Draft voice-over review

The five widescreen films have first-person narration scripts in
`videos/narration.json`. Each line has a start and end window tied to the existing
animation. macOS speech is only a temporary voice for reviewing copy and pacing;
it is not used for the website's selected Calm American narration.

After rendering the silent originals, generate all narrated drafts:

```bash
node videos/render-narration.mjs
npx vite videos/local/voiceover-drafts --host 127.0.0.1 --port 4187 --strictPort
```

Open <http://127.0.0.1:4187> for a five-film review player with clickable timed
scripts and a **CC · Captions** toggle. Captions start off and your choice stays
active when switching films; they are separate VTT tracks, not burned into the
video. Narrated MP4s, captions, and the generated review
page go into the ignored `videos/local/voiceover-drafts/` folder. Original video frames and
silent exports remain unchanged. The exporter rejects speech that overruns its
window instead of cutting it off or speeding it up.

To revise one film, edit its copy/timing and run
`node videos/render-narration.mjs delegation-film`. An optional second argument
sets the output directory; `APP_FILM_VOICE` overrides the default Samantha voice.
The focused exporter check is `node --test videos/narration.test.mjs` on macOS
with FFmpeg installed. Final narration will replace these draft voices only
after the scripts have been reviewed.

### Local AI voice comparison

The Delegation comparison uses full BF16 Qwen3-TTS 1.7B on Apple Silicon through
MLX, conditioned on the two approved synthetic male audition samples. Model and
library versions are pinned in `videos/local-voices.json` and
`videos/requirements-voice.txt`.

```bash
uv venv --python 3.12 .app-dev/video-tts
uv pip install --python .app-dev/video-tts/bin/python -r videos/requirements-voice.txt
.app-dev/video-tts/bin/python videos/generate-local-narration.py
.app-dev/video-tts/bin/python videos/check-local-narration.py
node videos/render-voice-comparison.mjs
npx vite videos/local/voice-comparison --host 127.0.0.1 --port 4189 --strictPort
```

Keep the approved `ming-american-male-raw.wav` and `ming-british-male-raw.wav`
references in `videos/local/voice-references/`, or pass `--references`.
Missing references fail explicitly; the generator never substitutes a descriptive
prompt. Each film is generated in one uninterrupted reference-conditioned call.
Never synthesize individual sentences independently: the same voice prompt and
seed did not preserve speaker identity in the rejected Ming exports. Ming's full
paragraph attempts also repeated or dropped copy, so those are not used.

The checker independently transcribes the entire take, rejects missing/repeated
words, aligns each caption to recognized word timestamps, and screens reference
and adjacent-line speaker similarity using [Resemblyzer](https://github.com/resemble-ai/Resemblyzer).
The 0.8 similarity floor is a local diagnostic screen, not a perceptual guarantee;
listen before publishing. SHA-256 provenance prevents stale checks from certifying
new audio. Both generation and checking run locally after model downloads.
Use `--voice american-male` or `--voice british-male`, optionally `--seed 43`, to
retry a whole take. Never retry only one line with a new speaker sample.
Focused checks: `node --test videos/narration.test.mjs` and
`.app-dev/video-tts/bin/python videos/narration-alignment.test.py`.

Both films use the same script and choreography, with visual timing aligned to
each take. The paced edit inserts silence between lines from the same approved
take, without regenerating lines or trimming natural breaths. A pitch-preserving
tempo adjustment makes speech 4% slower, with pauses approximately 10% longer
than the previous 40–41-second edit. Visuals and captions follow the adjusted timing; the final
screen is retained. To adjust pacing,
rerun only `node videos/render-voice-comparison.mjs`, not voice generation.
The assembler rejects stale
alignment, failed voice checks, and extreme timing outliers. All generated WAVs, provenance
JSON, MP4s, captions, and the comparison page stay in the ignored `videos/local/voice-comparison/` folder. Model caches and
the ignored virtual environment stay outside tracked source. The originals and
the macOS drafts are untouched; the two-voice comparison is not deployed.
Use Vite for the reviewer: its byte-range responses allow immediate video seeking;
Python's basic HTTP server can reset seeks to zero even after buffering the file.

### Calm American five-film exports

Calm American is the selected voice for all five widescreen films. Generate and
check one continuous take per film using the same approved reference, then use
the shared pacing pipeline (0.96× speech tempo, approved pause settings):

```bash
for film in mission-film review-film delegation-film project-film visualize-film; do
  .app-dev/video-tts/bin/python videos/generate-local-narration.py "$film" --voice american-male --output "videos/local/narrated/$film" || break
  .app-dev/video-tts/bin/python videos/check-local-narration.py --voice american-male --output "videos/local/narrated/$film" || break
done
npm run render --prefix videos/remotion -- --all
npx vite videos/local/narrated --host 127.0.0.1 --port 4190 --strictPort
```

To preserve an already approved take, copy its `narration.wav`, `narration.json`,
and `narration-aligned.json` into that film's `american-male` subfolder instead
of regenerating it. The batch validates every film's script, voice, model,
audio hash, and consistency check before rendering. MP4s, optional VTT captions,
and the five-film review page are generated in `videos/local/narrated/`.
Re-rendering pacing does not invoke speech synthesis. These files are local
exports; producing them does not deploy or publish them.

All working media stays inside the repository folder but outside Git:
`videos/local/narrated/` holds the approved takes and final exports,
`voice-references/` holds the approved audition WAVs, `voice-comparison/`
and `voiceover-drafts/` hold earlier iterations, and `exports/` holds standalone
deliverables. Paths are relative to `videos/local/`. Preserve the approved WAVs,
their provenance/alignment JSON, and the reference WAVs when clearing rebuildable
MP4s: re-rendering preserves the approved voice; synthesizing it again may not.

## Automatic code review product film

`videos/review-film.html` is an illustrative 56-second walkthrough of automatic
code review: find issues, fix qualifying findings, and verify the changes in a
fresh round. Switching models is optional; this example uses Claude to review
Codex's work for an adversarial perspective. The user enables automatic
remediation for critical, high, and medium findings and allows up to three
rounds. A cleared conversation marks each independent reviewer thread. Findings,
severity, fix progress, and verification results appear in the Review pane;
the conversation contains brief agent updates, not duplicate finding cards.
A fresh reviewer verifies the result, returns the report to the original
conversation, and closes. The example finishes after two rounds with
local commits disabled. It is a scripted promotion, not a captured live review
or the Mission Review stage. Preview it at
<http://127.0.0.1:4174/videos/review-film.html> and export its ignored MP4 and poster:

```bash
npm run render --prefix videos/remotion -- review-film --silent
```

For a standalone narrated export, generate and validate one Calm American take,
then apply the same speech and pause settings as the other films:

```bash
.app-dev/video-tts/bin/python videos/generate-local-narration.py review-film --voice american-male --output videos/local/review-automatic/review-film
.app-dev/video-tts/bin/python videos/check-local-narration.py --voice american-male --output videos/local/review-automatic/review-film
node videos/render-review-film.mjs
npx vite videos/local/review-automatic --host 127.0.0.1 --port 4190 --strictPort
```

The narrated MP4, optional VTT captions, and review page stay ignored under
`videos/local/review-automatic/`. Narration may extend the silent film's timing.
Use that review page for the visible **CC · Captions** control; the editable
`videos/review-film.html` animation viewer is silent and has no subtitle track.
To include an approved standalone take in the website, copy its `narration.wav`,
`narration.json`, and `narration-aligned.json` from
`videos/local/review-automatic/review-film/american-male/` into
`videos/local/narrated/review-film/american-male/`, then run
`npm run render --prefix videos/remotion -- --all`. This regenerates the website's
five-film manifest and exports without synthesizing new speech. Deploy through
the website workflow below. The tracked thumbnail is
`videos/assets/review-film-thumbnail.png`.

## Worktree delegation product film

`videos/delegation-film.html` is a separate, illustrative 46-second film: a feature conversation leads to typing and submitting `/delegate` in the current agent's composer, handoff preparation, visible worktree provisioning, follow-up work with the delegated agent, and a merge with worktree cleanup that closes the delegated agent. The original agent and conversation remain available. Preview it at <http://127.0.0.1:4174/videos/delegation-film.html> and export its ignored MP4 and poster with:

```bash
npm run render --prefix videos/remotion -- delegation-film --silent
```

## Quick Chat to project product film

`videos/project-film.html` is a separate, illustrative 43-second film: discuss an app idea in Quick Chat, explicitly ask Korus to create a project, see the folder/agent/handoff setup, then open the new project agent while the original Quick Chat remains. The project folder is not shown as a Git repository or worktree. Preview it at <http://127.0.0.1:4174/videos/project-film.html> and export its ignored MP4 and poster with:

```bash
npm run render --prefix videos/remotion -- project-film --silent
```

The source thumbnail is `videos/assets/project-film-thumbnail.png`.

`videos/project-shorts.html` reframes the same story as an editable 40-second 9:16 vertical cut for TikTok and YouTube Shorts. It uses larger mobile-readable captions and a focused app close-up; the explicit create request and retained Quick Chat remain visible. Preview it at <http://127.0.0.1:4174/videos/project-shorts.html> and export the ignored 1080×1920 MP4 and poster with:

```bash
npm run render --prefix videos/remotion -- project-shorts --silent
```

## Visualize and annotations product film

`videos/visualize-film.html` is an editable 31-second, 16:9 illustration of the shipped Visualize flow: enter `/visualize`, choose a suggested diagram, watch it populate and zoom on the Excalidraw canvas, annotate one shape, submit the annotation without extra composer text, and see just that part of the diagram refined. It is a scripted promotion, not a recording of a live run. Preview it at <http://127.0.0.1:4174/videos/visualize-film.html> and export the ignored 1600×900 MP4 and poster with:

```bash
npm run render --prefix videos/remotion -- visualize-film --silent
```

The source thumbnail is `videos/assets/visualize-film-thumbnail.png`.

## Deploy

### Manual downloads

The header and hero detect the visitor's desktop OS without external scripts.
All platforms remain accessible: macOS Apple silicon, Windows x64 (unsigned),
and Linux x64 / ARM64 with DEB, RPM, and ZIP choices. Browser OS detection does
not infer CPU architecture; Linux always opens the explicit choices. Mobile,
ChromeOS, and unknown browsers open all downloads. The chooser also works
without JavaScript.

Public download URLs use `/releases/latest/download/<filename>` so they follow
GitHub's latest stable release without a version pin or website redeployment.
The build queries the public latest-release API and verifies asset names,
completed uploads, canonical URLs, and download responses before exposing links.
Missing formats link to `/releases/latest`; if no stable release exists, all
platforms fall back to `/releases`. API failures other than that missing-release
case stop the build rather than silently publishing incomplete download choices.

Prereleases remain accessible on GitHub but never replace stable download
targets. Stable promotion belongs to the release workflow, not the website.

The website-owned asset mapping in `downloads.mjs` follows the release contract:
`<slug>-macos-arm64.dmg`, `<slug>-win32-x64-setup.exe`,
`<slug>-win32-x64.zip`, and `<slug>-linux-{x64,arm64}.{deb,rpm,zip}`.
The macOS updater ZIP is not offered as a manual installer.
`npm run test:website` covers publication/link safeguards; browser checks cover
OS shortcuts, explicit architecture choices, and responsive layout.

### Website upload

The deploy helper first builds the landing page and generated documentation into
`dist/website/`, then streams that artifact over SSH, provisions the Let’s Encrypt
certificate if this is the first deploy, and installs the matching nginx site on `joshua`:

```bash
./website/deploy.sh
```

Override `APP_WEBSITE_HOST`, `APP_WEBSITE_ROOT`, or `APP_NGINX_CONFIG` when needed. The remote account must be able to run `sudo install`, `sudo nginx -t`, and `sudo systemctl reload nginx`.

The domain and storage root come from `core/src/product.json`; nginx templates
are rendered outside the public artifact. Joshua serves the website, downloads,
and releases from `/var/www/korus/{site,downloads,releases}`. Certificate renewal
uses `/var/www/korus/site` as its webroot.

Deployment verifies the GitHub release-page fallback as well as direct assets
before making server changes. It uploads only the website; it neither publishes
desktop releases nor changes their prerelease/stable status.

Keep the existing `/desktop/releases/darwin/arm64/RELEASES.json` feed and
`/desktop/downloads/korus-macos-arm64.dmg` installer unchanged. Their nginx
aliases and storage directories remain separate from the website. Any bridge
update requires a separately approved stable release; do not redirect the JSON
feed to `update.electronjs.org`, which uses a different format.
