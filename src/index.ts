/**
 * xmemory — TypeScript client for the xmemory API.
 */

// Client
export { XmemoryClient, xmemoryInstance } from "./client.js";
export type { AdminNamespace } from "./client.js";

// Instance handle
export { DescribeResult, InstanceHandle } from "./instance.js";

// Error classes
export { XmemoryAPIError, XmemoryHealthCheckError } from "./types.js";

// Enums
export { SchemaType } from "./types.js";
export type {
  SchemaTypeValue,
  ExtractionLogic,
  ReadMode,
  WriteQueueStatus,
  FieldType,
  OnDelete,
  CastStrategy,
  DecisionKind,
  MigrationSource,
} from "./types.js";

// Options
export type {
  XmemoryClientOptions,
  RequestOptions,
  ReadOptions,
  WriteOptions,
  ExtractOptions,
  CreateInstanceOptions,
  GenerateSchemaOptions,
  UpdateInstanceSchemaOptions,
  DryRunMigrationOptions,
  ListMigrationsOptions,
  GetMigrationOptions,
  SuggestionRequestOptions,
} from "./types.js";

// Response models
export type {
  ClusterInfo,
  InstanceInfo,
  InstanceSchemaInfo,
  ReadResult,
  WriteResult,
  AsyncWriteResult,
  WriteStatusResult,
  ExtractResult,
  GenerateSchemaResult,
  ToolDescription,
  ToolParameterDescription,
  RawDescribeResult,
} from "./types.js";

// Schema evolution — migration ops
export type {
  MigrationPlan,
  MigrationOp,
  FieldSpec,
  AddObject,
  RemoveObject,
  RenameObject,
  ChangeObject,
  AddField,
  RemoveField,
  RenameField,
  ChangeField,
  AddRelation,
  RemoveRelation,
  RenameRelation,
  ChangeRelation,
  DefaultValue,
  EnumValues,
} from "./types.js";

// Schema evolution — results
export type {
  EnhanceSchemaResult,
  PlanSummary,
  DryRunResult,
  MigrationRecord,
  ListMigrationsResult,
  GetMigrationResult,
  ConsolidatedProposal,
  ProposalItem,
  ReviewSuggestionsResult,
  DecisionInput,
  RecordedDecision,
  DependencyWarning,
  DecideSuggestionsResult,
  ApplyPendingDecisionsResult,
} from "./types.js";
