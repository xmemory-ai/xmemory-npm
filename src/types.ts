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
