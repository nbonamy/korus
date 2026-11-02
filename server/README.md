# Hosted server

`backend/` owns hosted ingestion, authentication and reporting APIs. `frontend/`
owns the private admin console. `deploy/` contains portable Docker services and
`scripts/` owns image packaging and end-to-end server checks. The mobile and Electron clients are independent of the hosted frontend.

The server uses shared `@workspace/core` contracts and canonical UI primitives,
product metadata and assets from the app repository. Those shared inputs must be
packaged or transferred explicitly when extracting this directory into another
repository. Private host configuration and credentials belong in operator tooling.

## Hosted daily collector

`server/backend/src/collector` is an independently bundled Node service. It imports the
closed shared telemetry contract and PostgreSQL client, never the desktop daemon,
provider runtimes or companion relay. Dependency/AST lint enforces both directions
of this boundary. Building the desktop does not start or configure this service.

Build with `npm run build -w @workspace/server-backend`. The explicit
`npm run migrate -w @workspace/server-backend` command applies versioned,
transactional migrations under an externally supplied migration role. Ingestion
does not perform DDL. `npm run start -w @workspace/server-backend --
serve <operator-config.json>` starts the listener only after its tables are accessible.
Both commands read `TELEMETRY_DATABASE_URL` at runtime; it is never compiled into a
bundle. The private operator JSON supplies `listenHost`, `listenPort` and an
optional list of exact `trustedProxies` IP addresses. Database roles, credentials,
listener/routing configuration and TLS termination belong outside Git. PostgreSQL
18 or later supplies the transaction deadline used by the connection pool.

The versioned ingestion route accepts only JSON with the shared closed schema.
Its byte cap applies before UTF-8 decoding or parsing, including chunked bodies.
Hourly reports are accepted for any historical UTC hour through the current hour.
Legacy daily reports retain their completed-day contract. There is no historical
upload cutoff: `install_days`, `usage_daily` and the minimal
`installs` registry have no age-based expiry. The registry preserves the reporting
bucket of the first successfully committed submission, even when an older reporting
date arrives later; it does not claim an installation date.

Each replacement uses one PostgreSQL connection and transaction. The unique parent
upsert locks the install/day before replacing a single hourly bucket. The stored
hour markers include empty activity reports. The first hourly report replaces
legacy daily contributions; later legacy writes cannot overwrite hourly data.
Daily metrics sum the known hourly contributions before aggregation. Optional
measured-turn counts and cost coverage distinguish partial subtotals from complete
totals; legacy reports infer coverage from their existing nullable measurements.
Missing hours or groups never erase measured contributions from other hours.
The same parent lock serializes concurrent processes as well as concurrent requests;
removed groups disappear, including replacement with empty usage. The registry
insert is in the same transaction. HTTP success follows commit. A lost
acknowledgement can be retried without incrementing counts; a failed transaction
preserves the prior snapshot. SQL stores typed columns, not rollup JSON blobs.

Admission uses the socket peer unless it exactly matches an operator-configured
proxy; only then is a single validated `X-Real-IP` trusted. Forwarding lists and
missing/invalid trusted-proxy addresses are rejected. Source limits are 60 requests
per rolling minute with a ten-request burst, independently of the thirty requests
per installation per rolling hour. Rate-limit maps each hold at most 4096 live
keyed hashes with a process-random key; only expired entries can be reclaimed.
Nothing exports or persists this state. There are at most twenty in-flight request
handlers and 128 connections, with bounded body, statement, lock and transaction
deadlines. A client-side query deadline also bounds lost database replies; failed
transactions discard their connection after bounded rollback. Limit responses have
a bounded `Retry-After`. Random UUIDs and anonymous rate limits do not authenticate
installations or establish trustworthy downloads.

The collector has no request/access logger. Application failures emit JSON lines
with a timestamp, service, operation, recognized error code and an authored cause
and description. Database lock deadlines, missing migrations, permission failures,
connection failures and listener conflicts remain distinguishable without printing
raw error messages, stacks, SQL, parameters, addresses, installation identifiers,
request headers or bodies. Unknown errors identify the failed operation with an
`unexpected_error` cause and bounded application filename/line positions when
available; full stack traces and host paths remain excluded. Expected
invalid/unauthorized requests are not logged.
HTTP failures retain generic responses; recoverable database errors do not terminate
the process. Database logging, reverse-proxy logs and upstream infrastructure are
separate operator boundaries:
they must also suppress addresses, identifiers, query parameters and bodies before
the production no-IP-retention promise is verified. A local test cannot establish
that deployment guarantee.

The backend collector tests start disposable real `postgres:18.3-alpine`
containers with ephemeral loopback ports; Docker must be running. Repeat with
`npm run test -w @workspace/server-backend`. Setting
`TELEMETRY_COLLECTOR_EVIDENCE` to an untracked output file retains sanitized HTTP
status/count evidence. The workflow checks concurrent replacement across server
instances, rollback/connection loss, lost acknowledgements, exact limits, bounded
admission and retention of old accepted history. The executable build test also
proves operator-secret canaries do not enter the generated bundle.

## Private telemetry aggregates

The standalone bundle's `read <external-json-file>` mode is a separate process
using `telemetry_read`, never the ingestion pool or desktop runtime. Its runtime
JSON supplies `listenHost`, `listenPort`, `consoleOrigin` and `accessTokenFile`;
`TELEMETRY_DATABASE_URL` supplies the read-only database connection outside Git.
Startup checks schema readiness without DDL. Both executable modes share bounded
PostgreSQL timeouts, generic HTTP failures and the same privacy-safe diagnostics.

The private console uses a single `admin` operator account. Its password comes
from `BACKEND_ADMIN_PASSWORD` in an operator-managed, owner-only `.env` file
outside Git. Compose injects it only into the separate `auth` process, which has
no database credential or database network. Passwords must be at least 16
characters and at most 1,024 UTF-8 bytes; the process derives a salted scrypt hash
at startup. No operator credential is baked into images or browser assets.

The auth service keeps at most 128 opaque random sessions in memory for eight
hours. Cookies are host-only, HttpOnly, SameSite=Strict and Secure under HTTPS.
Logout revokes the session. Restarting auth invalidates all sessions; changing
the private `.env` password requires recreating the auth container. Login and logout require the exact configured Origin. Login has a
global ten-attempt/minute budget and at most two concurrent scrypt operations;
rate state contains no IP addresses. Errors never echo credentials or cookies.

The console uses Vue Router history routes. Authentication guards resolve the
server session before rendering login or protected reports; an unavailable
authentication service produces a retryable state. Login return paths are
limited to the console report routes. The proxy also enforces authentication on
direct report URLs.

The proxy checks sessions before serving console HTML or
`/v1/telemetry/metrics`. Unauthenticated HTML redirects to `/login`; metrics return
401 without a browser password challenge. The login document and its static
assets are public. The proxy injects a separate private service bearer on the
internal metrics hop, while the API virtual host remains anonymous ingestion
only. Database credentials and the service token never enter browser assets or
responses. Supply a distinct 32–256 character URL-safe random service token
through `TELEMETRY_READ_ACCESS_FILE` and the exact HTTPS console origin (scheme,
host and optional port, without trailing slash/path) through
`TELEMETRY_CONSOLE_ORIGIN`. Internal metrics callers may omit Origin; any supplied
Origin must exactly match. The explicit
`TELEMETRY_CONSOLE_ALLOW_LOOPBACK_HTTP=1` option accepts HTTP only for a loopback
console origin in isolated local tests; production leaves it unset or zero.

The read endpoint accepts inclusive `from`/`to` calendar days, an optional IANA
`timeZone` (UTC when omitted), canonical `provider`/`model` filters and a boolean
`groupServiceTiers` option. The console supplies the viewer browser timezone and
includes today by default, using reports received so far. It rejects
unknown/duplicate filters, future viewer days and ranges longer than 3,660 days
instead of clipping results. Older retained ranges remain available. Model choices
come from nonzero recorded usage within the selected date/provider scope,
independently of the selected model.
At most four aggregate statements execute concurrently; excess work receives 429
with a one-second Retry-After. Database lock/statement deadlines yield generic 503
responses. Responses are not cached and contain no installation-level records.

`core/src/telemetry-metrics.ts` is the browser-safe read contract. Cards use the
range's end day and global activity, independent of usage filters: cumulative
participating identities through that day, DAU, distinct trailing-seven WAU,
distinct trailing-30 MAU, and distinct calendar-month-to-date activity. Daily first
reports use the registry's first reported bucket. Empty-usage days contribute to
activity; multiple models cannot multiply it. Availability and last receipt time
are global so the console can show the latest received reporting day.

The single statement in `server/backend/src/collector/metrics.sql` supplies every API
section from one committed snapshot. All counts and decimal costs are exact
strings, including sums beyond JavaScript's safe integer range. Known token
subtotals include measured and unmeasured turn counts; input plus output totals
retain every known contribution. Legacy reports infer measured turns from their
nullable token fields. Cache share and its non-cache-read remainder use only
matched input/cache-read pairs from the same hourly or legacy daily report, with
zero denominators returning null.
That remainder can include cache creation; it is not a fresh-input pricing claim.
Hourly usage, activity and first-report buckets are assigned to viewer days by
their UTC hour start, including across daylight-saving changes. Legacy date-only
reports and first-report records retain their original date; no hour is inferred.
Fractional-offset zones use the hour-start day because finer timing is unavailable.
Weekly buckets start Monday in the viewer calendar and include only selected days.
Token charts stack known input and output contributions, matching the known token
total even when coverage is partial. Known cost subtotals sum without repricing;
explicit cost coverage preserves partial estimates through hourly and daily
aggregation. All-unknown and empty buckets have null cost,
with explicit complete/partial/unavailable/empty coverage. Missing spend is never
zero. Usage model rows are ordered by provider/model/tier and expose aggregates only.
Sparse model-day series retain the same grouping and weighted timing arithmetic
for model usage trends and performance comparisons; absent timing samples remain
unavailable.

The executable seed is
`server/backend/src/collector/__tests__/fixtures/metrics-seed.sql`. Apply it only to a
migrated disposable database. The owner workflow prepares the exact API SQL with
`PREPARE dashboard_example(date,date,text,text,boolean,text) AS <metrics.sql>`, then executes
`EXECUTE dashboard_example('2026-10-18','2026-10-24',NULL,NULL,false,'UTC')`. Expected global
cards are 6 participating identities, DAU 3, WAU 4, MAU 5 and calendar-month actives
4. Known input plus output totals 700 tokens, measured cache share is 0.55, and known cost is
1.5 USD with two unknown groups. The 2020 seed contributes another 1,100 tokens.
Run `TELEMETRY_METRICS_EVIDENCE=<external-evidence-file> npm run test -w
@workspace/server-backend -- src/collector/__tests__/metrics.spec.ts` to record repeatable
aggregate JSON while verifying SQL/API parity, private access, corrections,
unknowns, exact large integers and bounded database failure against real Postgres.

Build the portable private console with `npm run build:console`. The static
artifact is `server/frontend/dist`; supply its absolute directory privately through
`TELEMETRY_CONSOLE_DIRECTORY`. API/console hosts, exact console origin, trusted
edge configuration and viewer credentials remain external proxy inputs. The
browser uses the console's protected same-origin `/v1/telemetry/metrics` route;
there is no API host, service token or database credential to configure in a
browser bundle. No Vite environment prefix or dotenv directory is enabled for
this entry point. `npm run build:server` builds both hosted workspaces. The local browser app
has its own build command.

## Telemetry container operations

`server/deploy/compose.yaml` runs a separate collector, private PostgreSQL
18 database, migration/grant jobs, read-only metrics process, backup worker and minimal routing proxy. No
service joins the companion relay. Only the proxy publishes a port, bound to an
operator-supplied private interface behind an HTTPS edge. Database and collector
networks are internal; the proxy has no database-network membership. PostgreSQL
uses a project-scoped named volume mounted at its versioned data-directory parent.
Restart policies, memory/CPU/process limits and health gates bound the stack.
The collector handles database restarts; Compose also restarts it after explicit
database restart operations. Health failures require operator monitoring; Compose
restart policies alone do not restart a running unhealthy process.

Build the image with `node server/scripts/package.mjs <local-image-tag>`. Its
temporary Docker context contains only the standalone bundle, runtime adapter and
Dockerfile. The checkout, dependency tree, environment files and operator inputs
are not sent to Docker. Node, PostgreSQL and nginx base images are digest pinned;
review supported versions/security updates before deployment. The collector image
runs without root, capabilities or a writable root filesystem. No credentials,
external routes, TLS material or operator configuration are image layers.

Copy `server/deploy/operator.env.example` to an operator-managed location
outside Git and replace every placeholder. Select a unique Compose project name,
an unused private container subnet, and distinct collector/metrics/auth/proxy addresses within
it. Reserve all four addresses for this stack. Supply distinct random database-role
passwords as newline-terminated secret files, the server-only console password
in the private operator environment, the reviewed console build directory, and a
trusted-edge nginx include. Keep their
parent directory owner-only. Compose file-backed secrets retain host permissions:
make the mounted files readable by their receiving container UID without opening
the parent directory to other host users. The backup directory must be writable
by the PostgreSQL image UID/GID (70:70), mode 0700, and reside on protected storage.
Do not store these inputs, resolved Compose output, archives or inventories in Git.
Resolved Compose output contains the runtime console password and must not be
printed into shared logs.
Ordinary Compose file secrets are bind mounts, not an encrypted secret store.

Use `docker compose --env-file <external-env-file> -p <isolated-project> -f
server/deploy/compose.yaml config` to review the resolved deployment
privately, then `up -d --wait` with the same options. Startup waits for database
readiness, applies versioned migrations under `telemetry_migrate`, then grants only
required table operations before admitting HTTP. Ingestion cannot create schema,
delete active days, change registry history or read migration state. The backup
role has SELECT only; the dashboard role has SELECT only on data tables.
The migration role has no cluster/role creation or superuser capability. Bootstrap
roles run only for a new data volume: replacing a password file does not rotate a
database role password. Perform role credential rotation privately and coordinate
all consumers. Schema upgrades require rerunning migrations and grants explicitly
with the new image before restarting ingestion; `up` reruns completed jobs.

The proxy accepts only the ingestion route on the configured API host and serves
the separate console host behind server-side session authentication. This is an
internal HTTP hop, never a public cleartext listener. The external HTTPS edge must
preserve the virtual host and securely convey client addresses. Its private nginx
include must trust only the actual TLS-edge peer ranges using `set_real_ip_from`,
`real_ip_header` and an appropriate `real_ip_recursive` setting; never trust all
peers. An empty include is suitable only when the proxy receives the source
connection directly. The proxy replaces forwarding headers and strips cookies,
authorization and user-agent before ingestion. The collector trusts only this
stack's explicit proxy address. The read service shares the private database and
frontend networks under a separate SELECT-only role; its console route keeps
server-side viewer authentication. The ingestion proxy rejects every other API
route.

The collector, metrics, auth and migration containers retain application diagnostics
through Docker's local logging driver, rotating three files of up to 5 MB per
service. Nonblocking delivery uses a bounded buffer; records may be dropped under
output pressure. Inspect them with `docker compose` using the same private operator
inputs and project name, followed by `logs --tail 100 collector metrics auth migrate`.
These records cover individual application failures and lifecycle events, without
periodic request summaries. PostgreSQL, nginx and backup/grant infrastructure logs
remain disabled. There are no access logs, request caches or disk-buffered ingestion
bodies. PostgreSQL statement/parameter/connection logs and extensions are disabled;
nginx access/error logging is disabled globally. Health checks use
configuration/readiness only and produce no request records. The database and
backups intentionally contain installation UUIDs and numeric rollups, never source
addresses or conversation content. Monitor health/exit state, backup freshness and
disk capacity alongside application diagnostics. Set `TELEMETRY_LOGGING_EVIDENCE`
to an external JSON file when running `node --test server/scripts/stack.test.mjs`
to retain the sanitized records from its real database-failure probe.
Do not enable packet capture, debug logs, SQL audit extensions or request tracing
on this route in production.

Before Ship, privately verify the effective database configuration, HTTPS edge,
upstream CDN/WAF/security/access logs, crash/support collectors and their backups.
They must retain no source addresses, headers, request bodies, URL identifiers or
queries for this telemetry path. Confirm direct collector/database ports are
unreachable and the private console cannot bypass authentication. Verify Docker
capacity, image provenance, filesystem permissions, TLS, routing and restore
monitoring in that environment. Local containers prove only the supplied stack;
production no-IP-storage verification remains a separate Ship precondition.

The backup worker makes consistent custom-format `pg_dump` archives daily and
checks seven-day expiry hourly, including when dumps fail. A copy expires at
604800 seconds; the sweep removes it on the next hourly check. Dumps have a
ten-minute wall deadline and bounded database queries. Only successful dumps are
atomically published, with private file permissions; stale partial dumps expire
as well. Health becomes unhealthy if rotation or successful backup is overdue.
Archive timestamps describe backup creation, never a data-retention cutoff:
accepted daily rollups and the installation registry stay indefinitely in primary
storage and every complete backup. All replicas, snapshots and off-host archive
copies must apply the same seven-day expiry, including while this worker is down.
Operator monitoring must catch a stopped worker or failed deletion. No script
truncates live history. These daily logical backups have up to one day of data
loss; they do not provide continuous WAL recovery.

Run `docker compose ... run --rm backup once` for an on-demand archive and
`docker compose ... run --rm backup rotate` for immediate expiry. Restore only a
trusted archive from the same service: PostgreSQL restore can execute SQL authored
by the source database owner. Create a separate empty recovery database owned by
`telemetry_migrate`, then run `docker compose ... run --rm -e
PGDATABASE=<recovery-database> restore <archive-name>`. The restore refuses the
primary database and nonempty destinations, restores in one transaction with
original owners/ACLs omitted, and never changes the primary snapshot. Validate
counts/aggregates and oldest retained days before any separately authorized
recovery cutover. Reapply grants before serving a recovered database; restoration
must not resurrect expired backup copies in other storage.

`node --test server/scripts/stack.test.mjs` builds the real isolated image and
exercises the disposable Compose stack, role denials, HTTP through nginx,
restart/recreation persistence, exact expiry boundaries, failed dumps and isolated
restore including old history. It removes its containers, networks and volumes.
Set `TELEMETRY_STACK_EVIDENCE` to an untracked output file for sanitized results.

The same workflow connects an isolated desktop-owned profile through the real
settings/activity RPC, SQLite ledger and `TelemetryUploadService` to that stack.
Its local fault receiver forwards canonical bytes and discards an acknowledgement
after commit. Restart and repeated window notifications must preserve one logical
day; the private console checks the resulting counts and a complete replacement.
Time, desktop lifecycle notifications and provider observations are scripted. Provider
normalization remains covered by the Claude/Codex ledger fixtures, not by live
provider calls. Set `TELEMETRY_PROFILE_EVIDENCE` to an external JSON file and
`TELEMETRY_DASHBOARD_EVIDENCE` to an external screenshot directory to retain this
evidence. These artifacts contain synthetic installation IDs and local payloads;
keep them out of deployment images and Git.

## Telemetry Ship handoff

Local validation does not authorize production activation. The operator must
review the intended image and console build, supply the external inputs in
`operator.env.example`, and complete these checks before enabling delivery:

- Confirm supported Docker/Compose and pinned image availability, an unused
  private subnet, memory/CPU/process capacity and durable disk capacity for
  indefinitely retained history. Set monitoring for disk growth, health failures,
  overdue backups/rotation and failed restore drills.
- Supply separate least-privilege credentials, private console authentication and
  the internal read-service token outside Git. Verify unauthenticated console
  requests reveal no metrics, anonymous writes cannot read, and database/read
  services cannot be reached directly from the public network.
- Verify HTTPS routing and exact console-origin rules using privately supplied
  host configuration. Desktop releases embed the `APP_TELEMETRY_ENDPOINT` build
  secret as a public default; keep it absent until activation is approved. A runtime
  value overrides the bundled endpoint, and an explicitly blank value disables it.
  The console build uses a relative authenticated route and contains no operator credential.
- Inspect effective collector, PostgreSQL, proxy, TLS edge and every upstream
  CDN/WAF/security/access/crash-support logging path, including external copies
  and backups. Prove the telemetry route retains no connection IP, request
  headers, identifier-bearing URL/query or body. Local no-log assertions do not
  establish this production fact. Resolve any mismatch before publishing the
  no-IP-storage promise or releasing an enabled endpoint.
- Verify seven-day expiry for every backup/replica copy, including worker
  downtime, and perform an isolated restore with old retained history. Live
  rollups and the minimal installation registry have no age-based cleanup.
- Publish and verify the approved privacy policy and Analytics guidance before
  a released app can offer active sharing. Recheck onboarding, first-upgrade and
  Settings policy links against that published version. Coordinate the separately
  approved endpoint activation and signed app release. An unset choice remains off
  until the desktop notice enables sharing after one foreground minute, the user
  closes it, or the General settings toggle enables it. Saved opt-outs stay off.

Record production privacy verification, deployment, policy publication, signed app
release and actual public availability as separate delivery evidence. A local
unsigned build, synthetic provider fixture or disposable-container trace proves
none of those facts. Shipping requires explicit authorization for each action.
