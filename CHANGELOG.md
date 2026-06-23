# Changelog

All notable changes to the `xmemory` npm package are documented here.

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