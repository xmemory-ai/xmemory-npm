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
export type { SchemaTypeValue, ExtractionLogic, ReadMode, WriteQueueStatus } from "./types.js";

// Options
export type {
  XmemoryClientOptions,
  RequestOptions,
  ReadOptions,
  WriteOptions,
  ExtractOptions,
  CreateInstanceOptions,
  GenerateSchemaOptions,
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
