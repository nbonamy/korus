# website

The public site: the static landing page, the privacy policy and the VitePress
user guide. `README.md` in this folder has the build, preview and publishing
notes. Follow the root [AGENTS.md](../AGENTS.md) as well.

## Rules

- **Write for users, in the present tense.** Describe what people can do and what
  they get, not how it is built. Document the current product only: no release
  planning notices, "coming in" labels, comparisons with other versions, history
  or acknowledged gaps. Version history belongs in release notes.
- **The guide and the engineering docs are separate.** The public guide is
  `docs/` here (VitePress, navigation Getting started, Providers, Workflows,
  Features, Reference, Troubleshooting). Internal notes stay in the repository's
  top-level `docs/` and are never published. Keep the sidebar in
  `docs/.vitepress/config.mts` in sync with the pages.
- **Product facts come from `core/src/product.json`.** The build expands the
  name, canonical URL and download links; do not hard-code them.
- **The privacy policy is authored in `privacy/index.html`.** Keep its contact
  links inside Cloudflare `email_off` comments. Any privacy or telemetry promise
  is published only after the release gate in the README is met, and with the
  matching Analytics guide.
- **Building does not publish.** Deployment (`deploy.sh`) is a separate approved
  Ship action.

## Verify

From the repository root: `npm run docs:check`, `npm run test:website`,
`npm run test:docs` and, for navigation changes, `npm run test:website:browser`.
Preview the built artifact (see the README) so both the landing page and the guide
render with product metadata.
