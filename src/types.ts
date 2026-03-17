/**
 * Types for the xmemory API.
 */

export const SchemaType = {
  YML: 0,
  JSON: 1,
} as const;

export type SchemaTypeValue = (typeof SchemaType)[keyof typeof SchemaType];

export interface CreateInstanceYMLRequest {
  yml_schema: string;
}

export interface CreateInstanceResponse {
  status: "ok" | "error";
  instance_id?: string | null;
  error_message?: string | null;
}

export type ExtractionLogic = "fast" | "regular" | "deep";

export interface WriteRequest {
  instance_id: string;
  text: string;
  extraction_logic?: ExtractionLogic;
}

export interface WriteResponse {
  status: "ok" | "error";
  error_message?: string | null;
}

export interface ReadRequest {
  instance_id: string;
  query: string;
  mode?: "single-answer" | "raw-tables" | "xresponse";
}

export interface ReaderResult {
  answer?: string;
  [key: string]: unknown;
}

export interface ReadResponse {
  status: "ok" | "error";
  reader_result?: ReaderResult | null;
  error_message?: string | null;
}

export interface AsyncWriteResponse {
  status: "ok" | "error";
  write_id?: string | null;
  error_message?: string | null;
}

export type WriteQueueStatus = "queued" | "processing" | "completed" | "failed" | "not_found";

export interface WriteStatusRequest {
  write_id: string;
}

export interface WriteStatusResponse {
  status: "ok" | "error";
  write_id: string;
  write_status: WriteQueueStatus;
  error_detail?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
}

export interface GetInstanceSchemaResponse {
  instance_id: string;
  schema_yaml: string;
}
