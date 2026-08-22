# listryx-api

Lists of anything — groceries, packing for a trip, clothes to buy — created from reusable
templates. This is the REST API; the Angular app lives in `listryx-ui`.

The one idea in the product is **friction reduction on list creation**. Some lists repeat close
to verbatim (the weekly grocery run), others repeat in structure but not content (packing for a
trip always needs the same categories, different items each time). Starting from a template and
editing the diff removes most of the friction either way. Everything else here is scaffolding
around that.

## Stack

- **NestJS 11** on **Node 24**, CommonJS. The one deliberate divergence from the sibling
  `planelyx-ocr`, which is ESM: Nest's DI reads constructor types out of
  `emitDecoratorMetadata`, and much of `@nestjs/*` still assumes CJS resolution.
- **PostgreSQL 17** through **Drizzle ORM** and `postgres-js`. Migrations are generated SQL,
  committed, and applied as their own step — never at boot.
- **zod** for every boundary: environment configuration, request bodies, query strings.
- **pino** via `nestjs-pino` for structured logs, **prom-client** via
  `@willsoto/nestjs-prometheus` for metrics, **Terminus** for `/health`.
- **Keycloak** as a JWT issuer, verified with `jose`. Realm `listryx`.
- **Vitest** with **Testcontainers**. Yarn 4 via Corepack.

## Prerequisites

| | |
|---|---|
| Node | 24+ (`corepack enable` supplies the pinned Yarn) |
| Docker | for the stack and the test container |
| `../../planelyx/auth` | the shared auth repo — `realms/listryx.json` and `themes/listryx` are mounted into the local Keycloak from there |

## Getting started

```bash
docker compose up -d
```

That is the whole thing. `compose.yaml` runs **PostgreSQL, Keycloak and the API on one network**,
applies the migrations as a one-shot before the API starts, and publishes:

| | |
|---|---|
| API | <http://127.0.0.1:8088> |
| Keycloak | <http://localhost:8089/auth/> — admin console `admin` / `admin` |
| PostgreSQL | `127.0.0.1:5434` |

Ports are chosen not to collide with the other stacks on this machine: planelyx-api holds 5432
and 8080, planelyx-ocr holds 5433 and 8084, planelyx's Keycloak 8081.

Running everything on one network is what lets the API resolve `postgres` and `keycloak` by name,
and what lets the monitoring stack scrape it by service name exactly as it does in production.

### Running the API from your IDE instead

```bash
cp .env.example .env
docker compose up -d postgres keycloak
yarn install
yarn db:migrate:dev       # applies drizzle/*.sql — the app will not do this for you
yarn dev                  # http://127.0.0.1:8088, with pretty logs
```

`.env.example` is already pointed at the published ports for this case.

### The issuer, and why the container needs two Keycloak URLs

A token minted for the browser says `iss=http://localhost:8089/auth/realms/listryx`, and the API
must accept exactly that string — `localhost` and all. But inside a container `localhost` is the
container itself, so the *keys* have to be fetched over the service network instead. That is what
`KEYCLOAK_JWKS_URI` is for, and why compose sets it to `http://keycloak:8080/...` while leaving
the issuer alone. Production solves the same problem the other way, by pointing `listryx.com` at
the host gateway so the public URL resolves from inside the container.

### Getting a token

```bash
curl -s -X POST 'http://localhost:8089/auth/realms/listryx/protocol/openid-connect/token' \
  -d grant_type=password -d client_id=listryx-ui \
  -d username=you -d password=... | jq -r .access_token
```

There is no seeded user — register through the UI. Nothing is provisioned on registration; a new
account starts with no lists and no templates, which is the correct empty state.

If you create a user through `kcadm.sh` instead, give it a first and last name. Keycloak's
declarative user profile marks both required, and without them the password grant fails with
`Account is not fully set up` rather than anything that names the missing field.

### The profile lives in Keycloak

There is no user table — the app only ever stores the `sub` as an owner id. `/api/me` therefore
reads and writes Keycloak rather than a row, through a service-account client (`listryx-api-admin`)
holding `view-users` and `manage-users` on `realm-management`. That is a *second* Keycloak
relationship, and the opposite direction from token verification: `KEYCLOAK_ISSUER_URI` is about
tokens the UI presents, while `KEYCLOAK_SERVER_URL` and `KEYCLOAK_ADMIN_CLIENT_*` are the API
calling Keycloak on its own behalf.

| variable | default | what |
|---|---|---|
| `KEYCLOAK_SERVER_URL` | `http://localhost:8089/auth` | Admin API base — compose points it at `http://keycloak:8080/auth` |
| `KEYCLOAK_REALM` | `listryx` | |
| `KEYCLOAK_ADMIN_CLIENT_ID` | `listryx-api-admin` | |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | `local-dev-secret` | **set this in production** |

`username` is read-only: the realm does not enable `editUsername`, so Keycloak would reject a
change. Changing an email clears its verified flag, so editing cannot promote an unverified
address to a verified one.

The realm export that grants all this lives outside this repo, in
`planelyx/auth/realms/listryx.json` — the same file compose mounts into the Keycloak container.

## The data model

```
list_template        id, owner_id, name, created_at
list_template_item   template_id, text, default_quantity, sort_order

list                 id, owner_id, name, status, template_id, created_at, closed_at
list_item            list_id, text, normalized_text, quantity, unit_price, checked, sort_order
```

Decisions embedded there, in case they look arbitrary later:

- **`list_item.text` is free text, with no product catalog.** A packing list item is "passport",
  not a SKU. There is no canonicalization problem to solve because there is nothing to reconcile
  against.
- **No `type` or `category` on `list`.** Tempting for filtering, but nothing in the app behaves
  differently per type. A free-text tag is a cheap addition later if the list of lists ever gets
  long enough to need one.
- **`list.template_id` is nullable and `ON DELETE SET NULL`.** It records provenance only.
  Deleting a template must never delete the lists made from it — the copy already happened, and
  those lists are the record of a real trip.
- **`normalized_text` is a generated column** (`lower(btrim(text))`). It is the identity behind
  price history, and generating it in the database means it cannot drift from the text it came
  from: editing an item's text moves its price observation to the new series in the same
  statement, with no application code involved.
- **Totals are never stored.** `subtotal` is `COALESCE(quantity, 1) × unit_price`, computed by
  PostgreSQL on read. A stored total is a cache that goes wrong.
- **`sort_order` on both item tables**, so drag-to-reorder is trivial and whatever order you set
  once — aisle order for groceries, packing categories for a trip — survives reuse.

## API

Everything is under `/api` and requires a bearer token. `/health` and `/metrics` sit outside the
prefix, deliberately: nginx proxies `/api/` and nothing else, so their placement is what keeps
them reachable from the Docker network and off the public internet.

```
GET    /api/templates                       ?page=&size=
POST   /api/templates                       { name, items: [{ text, defaultQuantity? }] }
GET    /api/templates/{id}
PUT    /api/templates/{id}                  replaces the name and the whole item set
DELETE /api/templates/{id}

GET    /api/lists                           ?status=open|closed&page=&size=
POST   /api/lists                           { name, templateId? }
GET    /api/lists/{id}
PATCH  /api/lists/{id}                      { name }
POST   /api/lists/{id}/close
POST   /api/lists/{id}/reopen
DELETE /api/lists/{id}
POST   /api/lists/{id}/save-as-template     { name, templateId? }

POST   /api/lists/{id}/items                { text, quantity?, unitPrice? }
PATCH  /api/lists/{id}/items/{itemId}       { text?, quantity?, unitPrice?, checked? }
DELETE /api/lists/{id}/items/{itemId}
PUT    /api/lists/{id}/items/order          { itemIds: [...] }

GET    /api/insights/items
GET    /api/insights/item-prices            ?text=leite
GET    /api/insights/list-totals            ?from=&to=

GET    /api/me
PUT    /api/me                              { firstName, lastName, email }
```

`/api/me` is the signed-in user's own profile and has no `/api/users/{id}` counterpart on
purpose: the id always comes from the token's `sub`, the same claim every other resource is
scoped by, so there is no id a caller could substitute. See [The profile lives in
Keycloak](#the-profile-lives-in-keycloak).

Close and reopen are sub-resources rather than a field on `PATCH`, matching the house convention
for state transitions — and keeping them out of reach of a rename form that serializes the whole
object back.

Every item write answers with the **whole list**, not the item. Checking something changes the
list's `checkedTotal`; adding something changes the total and the counts. Returning the item
alone would leave the client recomputing money it does not own the arithmetic for, or firing a
second request on every tap.

`POST /api/lists` with a `templateId` copies every template item server-side in one transaction,
so the client never reads a template and re-posts its items one at a time. That round trip is
the friction the whole feature exists to remove.

### Prices and trends

Items carry an optional `unitPrice`. This is the one addition beyond the original design, and it
stays inside that design's spirit: **no product catalog, no canonicalization**. A price series is
keyed on the normalized item text and nothing more, so `leite` and `Leite ` are one series while
`leite integral` stays a different one. That is the honest ceiling of free-text matching, and it
is correct rather than a limitation.

There is no price-history table. Every point is derived from `list_item` joined to `list`,
because the list *is* the record of when you shopped — a separate table would be a second copy
of the same facts, free to disagree with the first. An observation is dated by
`COALESCE(closed_at, created_at)`: the day the trip happened, not the day the list was drafted.
Open lists count, since a price typed in at the shelf is a real observation.

Creating a list from a template prefills each item's price from the most recent observation for
that text, resolved for the whole template in one query. The template stores no price of its own,
so one written in March never quotes March's prices in December.

## Migrations

The ORM never generates or alters the schema at runtime. There is no `synchronize`, no `push`,
and no DDL at boot.

```bash
yarn db:generate      # drizzle-kit diffs src/database/schema.ts into drizzle/*.sql
yarn db:migrate:dev   # applies it locally
```

Rename the generated file to something descriptive and update its `tag` in
`drizzle/meta/_journal.json` to match — `0000_create_lists_and_templates.sql`, not
`0000_misty_lady_deathstrike.sql`.

In production the deploy runs `node dist/database/migrate.js` as a one-shot
`docker compose run --rm api` **before** `up -d`, and aborts the whole deploy if it fails, so a
bad migration never reaches a running container. Migrations ship inside the image precisely so
they are never applied from a laptop.

This buys the same thing it buys in Planelyx: migrations reviewable as their own diff, rollback
that does not require guessing what an ORM would have done, and one explicit ordered history —
instead of a schema that is an emergent side effect of whichever entity definitions happened to
exist when the app last started.

## Observability

The `monitoring` repo scrapes `api:8080/metrics` over the shared network and Alloy ships the
container's stdout to Loki. Two things here exist for its benefit and are easy to break:
`compose.yaml` pins the project name to `listryx`, because that string becomes the `project`
label Alloy keys on; and `LOG_PRETTY` stays `false` in the container, because pretty-printed
lines are not JSON and the `level` label silently stops being parsed.

- **Logs**: structured JSON on stdout. Alloy tails the container and ships to Loki, so there is
  no app-side shipping code. `/health` and `/metrics` are excluded from request logging — they
  are polled every few seconds and would bury every real request.
- Every write emits one event from the fixed vocabulary in `src/logging.ts`, so a Loki query for
  `event="list.created"` finds all of them rather than most of them.
- **Metrics**: the default HTTP and process metrics, plus `listryx_lists_created_total` and
  `listryx_templates_saved_total`, both labelled by `source`. The first one is the number worth
  having: the ratio of template-created to scratch-created lists is a direct read on whether
  templates are actually used, which is the bet this project makes.
- **Health**: `/health` does a real `SELECT 1` rather than a pool-state read. A pool can hold
  handles to a server that stopped answering, and a health check that passes in that state is
  worse than none.

## Scripts

| command | does |
|---|---|
| `yarn dev` | watch-mode server |
| `yarn build` / `yarn start` | compile to `dist/`, run it |
| `yarn typecheck` | `tsc --noEmit` over source and config files |
| `yarn lint` / `yarn format` | ESLint (zero warnings) / Prettier |
| `yarn test` | Vitest against a real PostgreSQL container |
| `yarn db:generate` / `yarn db:migrate` | generate and apply migrations |

## Testing

Integration tests run the whole application over real HTTP against a real PostgreSQL container,
migrated with the committed SQL — so every run also tests the migrations, including the generated
`normalized_text` column that no amount of in-memory faking would exercise.

Only the token verification is replaced: `src/test-app.fixture.ts` swaps `JwtGuard` for one that
reads the owner from a header. Standing up Keycloak to mint a signature would test `jose`, not
this codebase. Every other layer — routing, pipes, the exception filter, the SQL — is the real
one.

## Docker

Multi-stage with named targets; CI builds `--target prod`. Non-root user, `EXPOSE 8080`, and a
`HEALTHCHECK` baked into the image rather than declared in Compose, so `docker run` gets it too
and the deploy's `up -d --wait` has something to gate on. Migrations are a separate step, so
first boot is fast and the start period stays short.

## Project structure

```
src/
  main.ts                 bootstrap: global prefix, CORS, shutdown hooks
  app.module.ts
  config.ts               the zod schema for the environment
  config.module.ts        parsed once, global, handed out by token
  logging.ts              pino options, redact list, the write-event vocabulary
  database/
    schema.ts             the four tables
    db.ts                 the postgres-js pool and the Drizzle client
    migrate.ts            the standalone migration runner
    database.module.ts
  common/                 api error shape and filter, page envelope, zod pipe, decimals
  auth/                   JWT guard, @CurrentUser()
  lists/                  the core loop, plus create-from-template and save-as-template
  templates/
  insights/               price history and list totals — no tables of its own
  me/                     the signed-in user's profile, held by Keycloak rather than a table
  health/  metrics/
drizzle/                  generated SQL, applied explicitly, shipped in the image
```
