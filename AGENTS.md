Expert TypeScript, NestJS and PostgreSQL. Strictly typed, minimal ceremony.

**Comments**

- Write almost none. No JSDoc blocks. Do not restate what the code says.
- A short `//` only where a decision would otherwise be re-litigated. Reasoning belongs in the
  README or the commit message.

**TypeScript**

- Strict; prefer inference. Never `any` — use `unknown` and narrow. The `no-unsafe-*` rules are
  errors on purpose.
- `interface` for object shapes. The response DTOs are the exception: `db.execute<T>()` needs the
  implicit index signature only a type alias has.

**Style**

- `yarn lint` and `yarn format:check` before committing.
- Blank line before `return`, and around `if`/`else`.

**Architecture**

- One module per feature (`lists/`, `templates/`, `insights/`) with its controller, service,
  repository and `dto.ts`. Cross-module reuse goes through an exported provider.
- Controllers route and validate. Services hold rules. Repositories hold SQL.
- Symbols as injection tokens for anything that is not a class.

**Ownership**

- `ownerId` is a parameter on every service and repository method, never ambient request state.
- Filter by owner in SQL, not after fetching.
- Someone else's row answers 404, not 403.

**Money**

- Decimal strings end to end; never `Number()` one. All arithmetic in PostgreSQL.

**Schema**

- The app never touches DDL. `drizzle-kit generate` writes SQL, it is reviewed as its own diff,
  and `yarn db:migrate` applies it before the app starts.
- Rename the generated file descriptively and update its `tag` in `drizzle/meta/_journal.json`.
- `list_item.normalized_text` is generated; its twin is `common/normalize.ts`. Change both or
  price series split.

**Logging**

- Structured JSON via `nestjs-pino`. No `console.log`. One event per write, from the `WriteEvent`
  union in `logging.ts`.

**Testing**

- Integration tests over real HTTP against a real PostgreSQL container. Only token verification
  is faked. Test names are sentences describing behaviour.
