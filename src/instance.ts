/**
 * InstanceHandle — scoped data operations on a single xmemory instance.
 */

import type {
  AsyncWriteResult,
  ExtractOptions,
  ExtractResult,
  InstanceSchemaInfo,
  ReadOptions,
  ReadResult,
  RequestOneFn,
  RequestOptions,
  WriteOptions,
  WriteResult,
  WriteStatusResult,
} from "./types.js";

export class InstanceHandle {
  readonly id: string;
  private readonly _requestOne: RequestOneFn;

  constructor(id: string, requestOne: RequestOneFn) {
    this.id = id;
    this._requestOne = requestOne;
  }

  async read(query: string, options?: ReadOptions): Promise<ReadResult> {
    const body: Record<string, unknown> = {
      query,
      mode: options?.readMode ?? "single-answer",
    };
    if (options?.traceId != null) body.trace_id = options.traceId;
    return this._requestOne<ReadResult>("POST", `/instances/${this.id}/read`, {
      body,
      timeoutMs: options?.timeoutMs,
    });
  }

  async write(text: string, options?: WriteOptions): Promise<WriteResult> {
    const body: Record<string, unknown> = {
      text,
      extraction_logic: options?.extractionLogic ?? "deep",
    };
    if (options?.diffEngine != null) body.diff_engine = options.diffEngine;
    return this._requestOne<WriteResult>("POST", `/instances/${this.id}/write`, {
      body,
      timeoutMs: options?.timeoutMs,
    });
  }

  async writeAsync(text: string, options?: WriteOptions): Promise<AsyncWriteResult> {
    const body: Record<string, unknown> = {
      text,
      extraction_logic: options?.extractionLogic ?? "deep",
    };
    if (options?.diffEngine != null) body.diff_engine = options.diffEngine;
    return this._requestOne<AsyncWriteResult>("POST", `/instances/${this.id}/write_async`, {
      body,
      timeoutMs: options?.timeoutMs,
    });
  }

  async writeStatus(writeId: string, options?: RequestOptions): Promise<WriteStatusResult> {
    return this._requestOne<WriteStatusResult>("POST", `/instances/${this.id}/write_status`, {
      body: { write_id: writeId },
      timeoutMs: options?.timeoutMs,
    });
  }

  async extract(text: string, options?: ExtractOptions): Promise<ExtractResult> {
    const body: Record<string, unknown> = {
      text,
      extraction_logic: options?.extractionLogic ?? "deep",
    };
    return this._requestOne<ExtractResult>("POST", `/instances/${this.id}/extract`, {
      body,
      timeoutMs: options?.timeoutMs,
    });
  }

  async getSchema(options?: RequestOptions): Promise<InstanceSchemaInfo> {
    return this._requestOne<InstanceSchemaInfo>("GET", `/instances/${this.id}/schema`, {
      timeoutMs: options?.timeoutMs,
    });
  }
}
