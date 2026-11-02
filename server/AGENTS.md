# server

The hosted telemetry collector and the private admin console. They are deployed
and run independently of the desktop and mobile apps. `README.md` in this folder is
the reference; read it before changing the collector, its migrations, its
deployment or its privacy behavior. Follow the root [AGENTS.md](../AGENTS.md) as
well.

- `backend/`: the independently bundled Node collector (ingestion and read
  modes) on PostgreSQL.
- `frontend/`: the private Vue admin console.
- `deploy/`: portable Docker services.
- `scripts/` and `test/`: image packaging and the end-to-end server checks.

## Rules

- **Independent runtimes.** The collector imports only the closed shared telemetry
  contracts and its PostgreSQL client; it never imports the desktop daemon,
  providers or the companion relay, and none of those import it. The console
  imports no client code and consumes browser-safe aggregate contracts from
  `core`. `npm run lint:architecture` enforces both directions.
- **Privacy is a release gate.** The collector retains no IP addresses or report
  content, and it has no request logger. Do not add logging, headers or fields
  that could identify an installation or carry content. A local test cannot prove
  the production guarantee; say so in the handoff.
- **No DDL at runtime.** Migrations are explicit, versioned and run under an
  external role. Ingestion never creates or alters tables.
- **Secrets stay out of Git and bundles.** Database URLs and operator credentials
  are read at runtime from operator-managed files or environment; builds are
  tested for secret canaries.
- **Shared inputs are packaged explicitly.** The server uses `core` contracts and
  product metadata; keep that dependency list small and explicit so this folder
  can be extracted.

## Verify

- `npm run test -w @workspace/server-backend` (needs Docker, it starts disposable
  PostgreSQL containers) and `npm run test -w @workspace/server-frontend`.
- `npm run test:server:e2e` and `npm run test:server:infrastructure` for the
  console and deployment checks.
- Building or testing never authorizes publishing, activating an endpoint or
  deploying; those are separate approved Ship actions.
