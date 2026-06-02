/**
 * Types, enums, and error classes for the xmemory API.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SchemaType = { YML: 0, JSON: 1 } as const;
export type SchemaTypeValue = (typeof SchemaType)[keyof typeof SchemaType];

export type ExtractionLogic = "fast" | "regular" | "deep";
export type ReadMode = "single-answer" | "raw-tables" | "xresponse";
export type WriteQueueStatus =
  | "queued"
  | "processing"
  // Two-phase pipeline in-progress states (server returns these when the
  // parallel-extraction path is enabled). All non-terminal — keep polling.
  | "extracting"
  | "extracted"
  | "applying"
  | "completed"
  | "failed"
  | "not_found";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class XmemoryAPIError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /**
     * Structured error code when the server returned one. For the
     * schema-evolution endpoints this is the `error_type` discriminator
     * (e.g. `"stale_proposal_version"`, `"destructive_confirmation_required"`).
     * Pattern match on this instead of parsing the message.
     */
    public readonly code?: string,
    /** Optional structured `details` payload attached to some errors. */
    public readonly details?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "XmemoryAPIError";
  }
}

export class XmemoryHealthCheckError extends XmemoryAPIError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "XmemoryHealthCheckError";
  }
}

// ---------------------------------------------------------------------------
// Public response interfaces
// ---------------------------------------------------------------------------

export interface ClusterInfo {
  readonly id: string;
  readonly org_id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface InstanceInfo {
  readonly id: string;
  readonly cluster_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly data_schema: Record<string, unknown> | null;
  // Schema-evolution fields — present only on `updateInstanceSchema` responses
  // when the call ran a (non-no-op) migration.
  readonly migration_id?: string | null;
  readonly prior_version?: number | null;
  readonly new_version?: number | null;
  readonly migration_warnings?: string[] | null;
}

export interface InstanceSchemaInfo {
  readonly data_schema: Record<string, unknown>;
}

export interface ReadResult {
  readonly trace_id: string | null;
  readonly reader_result: unknown;
}

export interface WriteResult {
  readonly write_id: string;
  readonly trace_id: string | null;
  readonly cleaned_objects: unknown;
  readonly diff_plan: unknown;
}

export interface AsyncWriteResult {
  readonly write_id: string;
}

export interface WriteStatusResult {
  readonly write_id: string;
  readonly write_status: WriteQueueStatus;
  readonly error_detail: string | null;
  readonly completed_at: string | null;
}

export interface ExtractResult {
  readonly trace_id: string | null;
  readonly objects_extracted: unknown;
}

export interface GenerateSchemaResult {
  readonly data_schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Schema evolution — migration ops (discriminated union on `op_type`)
//
// Field names are snake_case to match the wire format exactly, so a plan
// returned by `enhanceSchema` can be passed straight back into
// `updateInstanceSchema` / `dryRunMigration` with no transformation.
// ---------------------------------------------------------------------------

export type FieldType = "str" | "string" | "int" | "integer" | "float" | "bool" | "boolean";
export type OnDelete = "nullify" | "cascade";
export type CastStrategy = "safe_implicit" | "explicit_using" | "lossy";
export type DecisionKind = "accept" | "reject" | "defer";
export type MigrationSource = "direct" | "suggestion_engine";
export type DefaultValue = string | number | boolean | null;
export type EnumValues = Array<string | number | boolean> | null;

export interface FieldSpec {
  name: string;
  type: FieldType;
  required?: boolean;
  description?: string | null;
  default?: DefaultValue;
  enum?: EnumValues;
}

export interface AddObject {
  op_type: "add_object";
  name: string;
  description?: string | null;
  primary_key: string[];
  fields: FieldSpec[];
  should_backfill?: boolean;
}

export interface RemoveObject {
  op_type: "remove_object";
  name: string;
}

export interface RenameObject {
  op_type: "rename_object";
  old_name: string;
  new_name: string;
}

export interface ChangeObject {
  op_type: "change_object";
  name: string;
  new_primary_key?: string[] | null;
  new_description?: string | null;
}

export interface AddField {
  op_type: "add_field";
  object_name: string;
  field_name: string;
  field_type: FieldType;
  required?: boolean;
  description?: string | null;
  default?: DefaultValue;
  enum?: EnumValues;
  should_backfill?: boolean;
}

export interface RemoveField {
  op_type: "remove_field";
  object_name: string;
  field_name: string;
}

export interface RenameField {
  op_type: "rename_field";
  object_name: string;
  old_name: string;
  new_name: string;
}

export interface ChangeField {
  op_type: "change_field";
  object_name: string;
  field_name: string;
  new_type?: FieldType | null;
  new_required?: boolean | null;
  new_description?: string | null;
  new_default?: DefaultValue;
  new_enum?: EnumValues;
  clear_default?: boolean;
  clear_enum?: boolean;
  cast_strategy?: CastStrategy | null;
  using_expression?: string | null;
  confirm_data_loss?: boolean;
}

export interface AddRelation {
  op_type: "add_relation";
  name: string;
  description?: string | null;
  objects: Record<string, string>;
  keys?: Record<string, string[]> | null;
  on_delete?: Record<string, OnDelete> | null;
  should_backfill?: boolean;
}

export interface RemoveRelation {
  op_type: "remove_relation";
  name: string;
}

export interface RenameRelation {
  op_type: "rename_relation";
  old_name: string;
  new_name: string;
}

export interface ChangeRelation {
  op_type: "change_relation";
  name: string;
  new_keys?: Record<string, string[]> | null;
  new_on_delete?: Record<string, OnDelete> | null;
  new_description?: string | null;
}

export type MigrationOp =
  | AddObject
  | RemoveObject
  | RenameObject
  | ChangeObject
  | AddField
  | RemoveField
  | RenameField
  | ChangeField
  | AddRelation
  | RemoveRelation
  | RenameRelation
  | ChangeRelation;

export interface MigrationPlan {
  ops: MigrationOp[];
}

// ---------------------------------------------------------------------------
// Schema evolution — results
// ---------------------------------------------------------------------------

export interface EnhanceSchemaResult {
  readonly data_schema: Record<string, unknown>;
  readonly migration_plan: MigrationPlan | null;
  readonly summary: string | null;
  readonly warnings: Record<string, unknown>[];
  readonly repair_log: Record<string, unknown>[];
}

export interface PlanSummary {
  readonly count_by_op_type: Record<string, number>;
  readonly total: number;
}

export interface DryRunResult {
  readonly status: "ok";
  readonly instance_id: string;
  readonly current_version: number;
  readonly statements: string[];
  readonly warnings: string[];
  readonly plan_summary: PlanSummary;
  readonly requires_metadata_sync: boolean;
}

export interface MigrationRecord {
  readonly id: string;
  readonly applied_at: string;
  readonly source: MigrationSource;
  readonly decided_by: string | null;
  readonly prior_version: number;
  readonly new_version: number;
  readonly ops: Record<string, unknown>[];
  readonly ops_summary: PlanSummary;
  readonly notes: string | null;
  readonly yaml_before: string | null;
  readonly yaml_after: string | null;
}

export interface ListMigrationsResult {
  readonly status: "ok";
  readonly instance_id: string;
  readonly items: MigrationRecord[];
  readonly next_before_id: string | null;
  readonly has_more: boolean;
}

export interface GetMigrationResult {
  readonly status: "ok";
  readonly instance_id: string;
  readonly record: MigrationRecord;
}

// ---------------------------------------------------------------------------
// Schema evolution — suggestion engine
// ---------------------------------------------------------------------------

export interface ProposalItem {
  readonly item_fingerprint: string;
  /** Raw op dict (forward-compatible). Cast to `MigrationOp` when needed. */
  readonly op: Record<string, unknown>;
  readonly evidence_feedback_ids: string[];
  readonly evidence_query_samples: string[];
  readonly frequency: number;
  readonly depends_on: string[];
  readonly current_decision: string | null;
  readonly rationale: string;
}

export interface ConsolidatedProposal {
  readonly instance_id: string;
  readonly proposal_version: string;
  readonly schema_version: number;
  readonly items: ProposalItem[];
  readonly generated_at: string;
  readonly notes: string[];
}

export interface ReviewSuggestionsResult {
  readonly status: "ok" | "evolution_in_progress";
  readonly instance_id: string;
  readonly proposal: ConsolidatedProposal | null;
  readonly retry_after_seconds: number | null;
}

export interface DecisionInput {
  item_fingerprint: string;
  decision: DecisionKind;
  edits?: Record<string, unknown> | null;
}

export interface RecordedDecision {
  readonly item_fingerprint: string;
  readonly decision_id: string;
}

export interface DependencyWarning {
  readonly kind: string;
  readonly item_fingerprint: string;
  readonly related_fingerprints: string[];
  readonly related_summaries: string[];
  readonly guidance: string;
}

export interface DecideSuggestionsResult {
  readonly status: "ok";
  readonly instance_id: string;
  readonly decisions_recorded: RecordedDecision[];
  readonly warnings: DependencyWarning[];
  readonly next_proposal_version: string;
}

export interface ApplyPendingDecisionsResult {
  readonly status: "ok" | "nothing_to_apply";
  readonly instance_id: string;
  readonly migration_id: string | null;
  readonly prior_version: number;
  readonly new_version: number;
  readonly applied_items: string[];
  readonly summary: string;
  readonly warnings: string[];
  readonly notes: string[];
}

// ---------------------------------------------------------------------------
// Describe types
// ---------------------------------------------------------------------------

export interface ToolParameterDescription {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly required: boolean;
  readonly enum?: string[];
  readonly default?: string;
}

export interface ToolDescription {
  readonly name: string;
  readonly description: string;
  readonly when_to_use: string;
  readonly parameters: ToolParameterDescription[];
  readonly http_method: string;
  readonly http_path: string;
}

export interface RawDescribeResult {
  readonly instance_id: string;
  readonly instance_name: string;
  readonly schema_summary: string;
  readonly tools: ToolDescription[];
}

// ---------------------------------------------------------------------------
// Options interfaces
// ---------------------------------------------------------------------------

export interface XmemoryClientOptions {
  url?: string;
  apiKey?: string;
  /** @deprecated Use `apiKey` instead. Will be removed in a future release. */
  token?: string;
  timeoutMs?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
}

export interface ReadOptions {
  readMode?: ReadMode;
  traceId?: string;
  timeoutMs?: number;
}

export interface WriteOptions {
  extractionLogic?: ExtractionLogic;
  diffEngine?: boolean;
  timeoutMs?: number;
}

export interface ExtractOptions {
  extractionLogic?: ExtractionLogic;
  timeoutMs?: number;
}

export interface CreateInstanceOptions {
  description?: string;
  schemaDescription?: string;
  timeoutMs?: number;
}

export interface GenerateSchemaOptions {
  currentYmlSchema?: string;
  timeoutMs?: number;
}

export interface UpdateInstanceSchemaOptions {
  /** Serialized migration plan from `enhanceSchema`; required for non-additive changes. */
  migrationPlan?: MigrationPlan | Record<string, unknown>;
  /** Authorise ops that drop data (remove object/field, lossy type cast). */
  confirmDestructive?: boolean;
  timeoutMs?: number;
}

export interface DryRunMigrationOptions {
  migrationPlan?: MigrationPlan | Record<string, unknown>;
  confirmDestructive?: boolean;
  timeoutMs?: number;
}

export interface ListMigrationsOptions {
  limit?: number;
  beforeId?: string;
  includeYaml?: boolean;
  timeoutMs?: number;
}

export interface GetMigrationOptions {
  includeYaml?: boolean;
  timeoutMs?: number;
}

export interface SuggestionRequestOptions {
  /** Optional free-form session ID for end-to-end tracing. */
  sessionId?: string;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal types (not re-exported from index.ts)
// ---------------------------------------------------------------------------

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
  readonly resource_id?: string;
}

export interface RawApiResponse {
  readonly ids?: string[];
  readonly items?: unknown[];
  readonly errors?: ApiError[];
}

export interface InternalRequestOptions {
  body?: Record<string, unknown>;
  params?: Record<string, string | string[]>;
  timeoutMs?: number;
}

export type RequestOneFn = <T>(method: string, path: string, options?: InternalRequestOptions) => Promise<T>;
export type RequestListFn = <T>(method: string, path: string, options?: InternalRequestOptions) => Promise<T[]>;
export type RequestIdsFn = (method: string, path: string, options?: InternalRequestOptions) => Promise<string[]>;

export function buildInstanceSchema(
  schemaText: string,
  schemaType: SchemaTypeValue,
): Record<string, unknown> {
  if (schemaType === SchemaType.YML) {
    return { yml: { value: schemaText } };
  }
  return { json_schema: { value: schemaText } };
}
