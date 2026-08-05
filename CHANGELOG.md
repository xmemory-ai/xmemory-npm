# Changelog

All notable changes to the `xmemory` npm package are documented here.

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