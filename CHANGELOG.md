# Changelog

All notable changes to the `xmemory` npm package are documented here.

## 3.9.0

Identifies this client to the API, so traffic from it is no longer indistinguishable
from any other program calling the same endpoints.

### Added

- Every outbound request now sends an `X-Xmemory-Client` header naming the package and
  its release, followed by the host — on macOS under Node 24.5.0 this release sends
  `xmemory-node/3.9.0 (node v24.5.0; darwin)`. The parenthetical reports
  `process.version` and `process.platform`, and says `unknown` for either one a host
  leaves out, or reports as something this header should not carry. Every request
  is covered, including the health check `XmemoryClient.create()` runs before it hands
  back a client — the first request an application makes.
- Adding the header leaves every other header on the request untouched,
  `Authorization` and `User-Agent` among them. The one exception is the identity header
  itself: a pre-existing `X-Xmemory-Client`, in whatever capitalisation, is replaced rather
  than joined, so exactly one goes out.

### Notes

The identity travels in a dedicated header rather than in `User-Agent`. That field
belongs to the runtime, and in a browser `fetch` treats it as forbidden and drops it
silently, so it could never carry this reliably. Nothing else on the wire claims
`X-Xmemory-Client`.

Two different things can go wrong with a custom header, and they are worth keeping
apart:

- **A proxy that strips unknown `X-` headers** mis-buckets the call. The request still
  goes through and still carries the runtime's own `User-Agent`, so it is counted as a
  generic caller rather than as this SDK.
- **A browser preflights the call.** Browsers are not a supported target for this package
  and this release does not change that: it authenticates with a bearer API key, which a
  browser cannot hold safely, and the hosted API serves no CORS to browser origins, so a
  browser could not reach it before this release either. Nothing supported regresses here,
  which is why this is a minor release. If you run this SDK behind a gateway of your own
  that does serve CORS, note that `X-Xmemory-Client` is not a CORS-safelisted request
  header: it makes the request preflighted, and the gateway must name it in
  `Access-Control-Allow-Headers` or the actual request is never sent.

## 3.8.3

Request URLs are composed from the configured base rather than concatenated with
it. A base carrying a query string sent the API path into that query — a read
against `https://host?tenant=acme` requested `/` — and request parameters appended a
second `?`. A base path prefix, as a gateway deployment uses, keeps working.

### Fixed

- `url` may carry a path prefix and a query string. Both survive: the API path is
  appended to the prefix, and request parameters join the existing query.

## 3.8.2

The response envelope is read as own properties too. 3.8.1 fixed the fields inside
a result; the wrapper around them — `items`, `ids`, `errors` — was still read
through the prototype chain, so a polluted prototype could supply an `items` array
and an empty `200 {}` came back as a genuine result.

### Fixed

- `items`, `ids` and `errors` are read as own properties and required to be arrays.
  A response that carries none of them is an error, as it was before.

## 3.8.1

Response normalization no longer trusts inherited properties. A decoded response is
a plain object, so a field the server omitted is answered by `Object.prototype`, and
normalizing with `result.field ?? default` wrote that inherited value back as an own
property — where nothing downstream could tell it apart from something the server
sent. With a polluted prototype, a read could return fabricated sub-answers.

### Fixed

- `reader_results`, `trace_id` and `console_url` are read as own properties and
  type-checked before they are normalized. A server that omits them still gets the
  documented defaults (`[]`, `null`, `null`).

## 3.8.0

Adds a CommonJS build alongside the ESM one. The package was ESM-only with no
`exports` map, so a CommonJS consumer had no `require` condition to resolve:
under `moduleResolution: node16` a value import failed with TS1479 and a type
import in a `.d.ts` with TS1541. Only runtime worked, and only because Node
22.12 and later can `require()` an ES module.

### Added

- A CommonJS build at `dist/cjs` next to the ESM build at `dist/esm`, selected
  by an `exports` map: `import` resolves to ESM, `require` to CommonJS. Each
  ships its own declarations.

### Changed

- `main`, `module` and `types` point into the new directories. The import path
  and the API are unchanged.

## 3.7.0

Adds scoped writes. A write was previously all-or-nothing about what it could
touch: the extractor saw only the text, and whatever it produced was reconciled
against the whole instance — so a note about someone the instance already knows
could just as easily land as a second, near-identical record. A scope names the
records the write is about, which both tells the extractor what to fold the new
information into and confines the result to those records.

### Added

- `scope` on `WriteOptions`, so `write` and `writeAsync` can take a `WriteScope`
  of concrete existing objects. Their current values are shown to the extractor
  so the write updates them instead of creating duplicates, and the write is
  then confined to the scope: it may only modify or delete the scoped objects
  and create new objects and relations anchored to them. Anything else fails the
  write. The confinement is checked against the resulting plan rather than
  requested of the extractor, so it holds however the extraction turned out.
- `WriteScope`. It carries only `objects` — unlike `ReadScope` there is no
  relation policy, because the relations among the scoped objects always
  accompany the hint.
### Notes

A scope names its objects by user-defined primary key, so only types that
declare one can be scoped. That is deliberate: it keeps a scope expressed in the
same identity the rest of your schema uses, rather than in server-generated ids.

Scope applies to text writes only, and the type system says so: the
`WriteMutation[]` overload takes `RequestOptions`, so passing a scope alongside
structured mutations does not compile. Everything else stays a server-side
decision and surfaces as an `XmemoryAPIError` — including the extraction logic a
scope may be used with and the cap on how many objects one scope may name, both
of which are deployment configuration this client should not be second-guessing
or silently working around.

One thing worth knowing before granting it: a scoped write additionally requires
**read** permission on the instance. The scoped records' current field values
ride the extraction prompt, so a scope is not merely a restriction — it is also
a read of those rows, and a write-only caller is refused it.

## 3.6.0

Surfaces the console link the API has always sent with every data operation and this
client dropped.

### Added

- `console_url` on `ReadResult`, `WriteResult`, `AsyncWriteResult`, `WriteStatusResult`
  and `ExtractResult` — the deep link to that operation's trace in the xmemory console.
  `AsyncWriteResult` gains `trace_id` in the same pass: the fire-and-forget path this
  client recommends for writes was the one with no way to point at what it did.

### Notes

The link is per operation, not per record, and it is `null` when the server has no
console configured. The wire omits the field entirely in that case, so each method
normalizes the absence — a caller comparing against `null` would otherwise be reading
`undefined` on exactly the deployments that have no link.

Why it matters beyond convenience: the one instruction xmemory ships about how an agent
should talk about recalled data asks it to name the record an answer rests on and link
the read that produced it. Through this client that was not followable without
rebuilding the URL from a trace id and a hostname the library never disclosed.

## 3.5.0

Adds the connect instructions for an instance — how to reach the same memory from
another agent surface — which the API, the MCP tools and `xmemcli instance setup`
already served and the SDKs did not.

### Added

- `admin.getSetupInstructions(instanceId)` and `instance.setupInstructions()`. On both
  because the MCP instance connection serves the same tool, so a caller holding an
  instance handle should not have to reach through `admin`.
- `format: SetupFormat.PROJECT` additionally returns the files a customer commits so a
  whole team gets an instance without each person running the steps by hand. Read
  `format` on the result: a server older than that parameter ignores it and still
  answers 200, so asking is not the same as receiving.
- New exports: `AgentSetupResult`, `AgentSetupSurface`, `AgentSetupStep`, `ProjectSetup`,
  `ProjectFragment`, `SetupFormat`, `StepKind`, `FragmentMerge`, and their value types.

### Notes

Nothing returned carries a credential: the steps tell a reader to sign in themselves,
out of band, so an instance id remains an identifier rather than a key.

Advisory values tolerate what this release has not heard of: `AgentSetupSurface.surface`
is a plain `string`, and `AgentSetupStep.kind`, `ProjectFragment.merge` and `format` are
widened so a value added to the server later is still typed. A `kind` you do not
recognise is not executable.

An omitted `format` stays `undefined` rather than defaulting to `AGENT`: that is the
signal a server predates the project rendering. This differs deliberately from the Python
client, which applies the default in its model — there is no runtime normalization point
here, and inventing one would report a format the server never claimed.

## 3.4.0

Surfaces the agent-facing instance metadata the API already returns: what a
memory is *for*, the standing preference set for how agents should use it, and
the advisory hints that seed a connect flow.

Nothing here is required. Older versions keep working against the same server —
they simply do not see these fields.

### Added

- `DescribeResult.purpose`, `.ownerInstructions` and `.usageBrief` (and the
  matching snake_case fields on `RawDescribeResult`). `asText()` now includes
  the first two — the purpose under the instance line, the standing preference
  above the schema summary so a long schema cannot bury it. Each is labelled with
  where it came from rather than as this library's own words, because anyone
  holding edit permission on an instance can set either one, so a label naming an
  author would claim something no response can verify. `usageBrief` is exposed as
  a property but deliberately left out of `asText()`, because it restates the
  schema summary already in there.
- Agent metadata on `InstanceInfo`: `agent_surfaces`,
  `agent_default_binding_tier`, `agent_engagement_hints`,
  `agent_owner_instructions` and `agent_owner_instructions_epoch`. Typed as
  plain strings rather than narrow unions so a value added to the server after
  this release is read rather than making the instance unreadable.
- `admin.patchInstanceMetadata(instanceId, options)` — `PATCH /instances/{id}`.
  Every option is independent: omit one and the stored value is untouched, pass
  `null` to clear it. This is the only call that accepts `agentSurfaces`,
  `agentDefaultBindingTier` and `agentEngagementHints`.
- `AgentSurface` and `BindingTier` constants (with `AgentSurfaceValue` /
  `BindingTierValue` types) for the accepted hint values. Plain strings are
  accepted wherever a constant is, so a newer server can be driven without
  waiting for a release here.
- `admin.updateInstanceMetadata` gained an options object with
  `agentOwnerInstructions` and `expectedOwnerInstructionsEpoch`. Pass the epoch
  from the response you composed your edit from and a save that raced someone
  else's edit is refused rather than overwriting it.
- `UpdateInstanceMetadataOptions` and `PatchInstanceMetadataOptions` are
  exported.

## 3.3.0

Structured writes: `write` and `writeAsync` now also accept a
`WriteMutation[]` — an ordered list of deterministic, LLM-free
create/update/delete mutations of objects and relations — instead of free
text. Mutations are wire-shaped (`{ object_mutation: { object_type, create |
update | delete } }` / `{ relation_mutation: ... }`) and sent untransformed;
exactly one op per mutation is enforced at compile time, and a `null` value
inside a mutation's `values` clears that field. Text writes are unchanged on
the wire.

Requires a server with structured-writes support (`structured_mutations` on
`/write` and `/write_async`); older servers reject the new request field.

### Added

- `write(mutations, options?)` / `writeAsync(mutations, options?)` overloads
  (an empty mutations array throws).
- Exported mutation types: `WriteMutation`, `ObjectMutationBody`,
  `ObjectCreatePayload`, `ObjectUpdatePayload`, `ObjectDeletePayload`,
  `RelationMutationBody`, `RelationCreatePayload`, `RelationUpdatePayload`,
  `RelationDeletePayload`, `RelationEndpoint`.

## 3.2.2

### Fixed

- `write` / `writeAsync`: the `diffEngine` option was sent on the wire as
  `diff_engine`, but the server only accepts `use_diff_engine` and rejects
  unknown fields — so setting `diffEngine` failed the request with a validation
  error. It is now sent as `use_diff_engine`. Requests that leave `diffEngine`
  unset are unaffected (the key was and is omitted).

## 3.2.1

Documentation-only release: removes `402 TRIAL_ENDED` from the documented error
contract. The server no longer emits it — trials were removed end-to-end — so
`402 Payment Required` now means `QUOTA_EXCEEDED` only. No API or behavior
change: `XmemoryAPIError.code` was always a passthrough of whatever the server
sent, so nothing in the client ever special-cased `TRIAL_ENDED`. Callers still
branch on `code`, not the bare status. (The 3.1.0 note below stands as a record
of the old contract.)

## 3.2.0

Surfaces per-sub-query answers from the reader's question decomposition. When
the server splits a composite query (several independent questions in one
`read`) into sub-queries, the response now carries one answer per sub-query
alongside the existing combined answer. Purely additive — existing callers that
only read `reader_result` are unaffected.

### Added

- `ReadResult.reader_results` — an array of `TaggedReaderResult`, one entry per
  sub-query the server decomposed the query into (so a single-intent query
  decomposes to one entry). `reader_result` stays the combined back-compat value
  (for `single-answer` mode, a labelled multi-part string). Always an array — a
  server without question decomposition (or with it disabled) omits the field on
  the wire and the client normalizes it to `[]`, so it is empty regardless of
  how many questions the query held.
- `TaggedReaderResult` — carries `sub_query` (the sub-question), `reader_result`
  (its answer, in the requested read mode), and `error` (a user-safe message set
  when that one sub-query could not be answered while the others still were;
  `null` otherwise). Exported from the package root.

## 3.1.1

Documentation-only release: rebrands the package name casing from `Xmemory` to
`xmemory` across the README and `AGENTS.md`. No API or behavior changes.

## 3.1.0

Surfaces the HTTP `Retry-After` response header and documents the new accounts
error contract. This release is purely additive — existing callers are
unaffected.

### Added

- `XmemoryAPIError.retryAfter` — the `Retry-After` response header, parsed into
  a number of seconds, when the server sent one (e.g. on `429 RATE_LIMITED`, or
  a resettable `402 QUOTA_EXCEEDED`). Both the delta-seconds and HTTP-date forms
  are accepted. Surfaced only; the client does **not** retry on its own.

### Changed (backwards-compatible)

- The structured-error extractor now passes `details` through for the
  `{"errors":[{"code","message","details"}]}` envelope too (previously only the
  schema-evolution error shape carried `details`). This makes `XmemoryAPIError.details`
  available for the accounts errors below.
- Documented the new accounts error contract in the README and on
  `XmemoryAPIError.code`/`.details`: **branch on `code`, not the bare HTTP
  status.** HTTP `402` is overloaded — `QUOTA_EXCEEDED` (plan/usage allowance
  exhausted; non-retryable; `details.kind` is
  `daily_quota_exceeded`|`monthly_quota_exceeded` with `retry_after_seconds`)
  vs `TRIAL_ENDED` (trial over / subscription lapsed; non-retryable). HTTP `429`
  `RATE_LIMITED` is the genuine, retryable velocity limit (honour `retryAfter`).

## 3.0.0

Replaces the legacy `cleaned_objects` echo on the write response with the new
`changes` summary. **Breaking:** `WriteResult.cleaned_objects` is removed.

### Added

- `WriteResult.changes` — the write response's summary of what the write did,
  grouped into `created` / `updated` / `deleted`.

### Removed

- `WriteResult.cleaned_objects` — superseded by `changes`. The server still
  returns the field to direct/SDK callers, but it is no longer typed or
  surfaced; read `changes` instead.
- `"regular"` from the `ExtractionLogic` type — the server no longer supports
  the regular extraction mode. `ExtractionLogic` is now `"fast" | "deep"`, and
  `extractionLogic` continues to default to `"fast"`.

## 2.3.1

### Added

- `DescribeResult.about` — the describe endpoint's first-party-positioning
  string is now parsed and exposed, and surfaced in `asText()`. Defaults to
  `""` when an older server omits it.

## 2.3.0

Adds **scoped reads**. This release is purely additive — existing methods are
unchanged and older callers keep working.

### Added — instance (`xm.instance(id)`)

- `read(query, options?)` now accepts an optional `scope` that restricts the
  read to a set of concrete objects. Each `ScopeObject` is identified by its
  `type` (PascalCase class name / snake_case table name) plus its user-defined
  primary `key`. `relationsScope` controls relation traversal —
  `"no_relations"` (default, objects only) or `"all_relations"` (also exposes
  the relations among the in-scope objects).

### Added — types (exported from `xmemory`)

- `ReadScope`, `ScopeObject`, and `RelationsScope`.

## 2.2.1

### Fixed

- `WriteQueueStatus` now includes the two-phase write-pipeline statuses
  `extracting`, `extracted`, and `applying`, which the server returns when the
  parallel-extraction pipeline is enabled. They are non-terminal (in-progress)
  states — keep polling until `completed` / `failed`.

## 2.2.0

Adds the **schema-evolution** surface. This release is purely additive —
existing methods are unchanged and older callers keep working.

### Added — admin (`xm.admin`)

- `enhanceSchema(clusterId, schemaDescription, currentYmlSchema, options?)` →
  `EnhanceSchemaResult`. Evolves an existing schema and returns an
  executor-ready `migration_plan`.
- `dryRunMigration(instanceId, schemaText, schemaType, options?)` → `DryRunResult`.
  Previews the planned DDL without applying it.
- `listMigrations(instanceId, options?)` → `ListMigrationsResult`.
- `getMigration(instanceId, migrationId, options?)` → `MigrationRecord`.

### Added — instance (`xm.instance(id)`)

- `reviewSuggestions(options?)` → `ReviewSuggestionsResult` (the rolling proposal).
- `decideSuggestions(proposalVersion, decisions, options?)` → `DecideSuggestionsResult`.
- `applyPendingDecisions(proposalVersion, options?)` → `ApplyPendingDecisionsResult`.

### Changed (backwards-compatible)

- `updateInstanceSchema(...)` accepts an options bag with `migrationPlan` and
  `confirmDestructive`. Calls without them keep the legacy additive-only
  behaviour. The returned `InstanceInfo` now also carries `migration_id`,
  `prior_version`, `new_version`, and `migration_warnings` when a migration ran.
- `XmemoryAPIError` gained `code` (structured error code, e.g.
  `stale_proposal_version`) and `details`. Existing `status` usage is unchanged.

### Added — types (exported from `xmemory`)

- Migration ops (discriminated union on `op_type`): `MigrationPlan`,
  `MigrationOp`, `FieldSpec`, `AddObject`, `RemoveObject`, `RenameObject`,
  `ChangeObject`, `AddField`, `RemoveField`, `RenameField`, `ChangeField`,
  `AddRelation`, `RemoveRelation`, `RenameRelation`, `ChangeRelation`, plus
  `FieldType`, `OnDelete`, `CastStrategy`, `DecisionKind`, `MigrationSource`.
- Results: `EnhanceSchemaResult`, `DryRunResult`, `PlanSummary`,
  `MigrationRecord`, `ListMigrationsResult`, `GetMigrationResult`,
  `ConsolidatedProposal`, `ProposalItem`, `ReviewSuggestionsResult`,
  `DecisionInput`, `RecordedDecision`, `DependencyWarning`,
  `DecideSuggestionsResult`, `ApplyPendingDecisionsResult`.
- Options: `UpdateInstanceSchemaOptions`, `DryRunMigrationOptions`,
  `ListMigrationsOptions`, `GetMigrationOptions`, `SuggestionRequestOptions`.

See `examples/suggestionEngineFlow.ts` and `examples/directRename.ts`, and the
[TypeScript guide](https://xmemory.ai/typescript/) /
[API reference](https://xmemory.ai/api/#schema-evolution).