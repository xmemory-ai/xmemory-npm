/**
 * InstanceHandle — scoped data operations on a single xmemory instance.
 */

import type {
  AsyncWriteResult,
  ExtractOptions,
  ExtractResult,
  InstanceSchemaInfo,
  RawDescribeResult,
  ReadOptions,
  ReadResult,
  RequestOneFn,
  RequestOptions,
  ToolDescription,
  ToolParameterDescription,
  WriteOptions,
  WriteResult,
  WriteStatusResult,
} from "./types.js";

const DEFAULT_DESCRIBE_TTL_MS = 300_000; // 5 minutes

export class DescribeResult {
  readonly instanceId: string;
  readonly instanceName: string;
  readonly schemaSummary: string;
  readonly tools: readonly ToolDescription[];

  constructor(raw: RawDescribeResult) {
    this.instanceId = raw.instance_id;
    this.instanceName = raw.instance_name;
    this.schemaSummary = raw.schema_summary;
    this.tools = raw.tools;
  }

  /**
   * Plain-text representation suitable for injecting into an LLM system prompt.
   *
   * By default, tools are presented as method calls (matching the SDK).
   * Set `includeHttp` to `true` to also show HTTP method and path for
   * raw REST callers.
   */
  asText(options?: { includeHttp?: boolean }): string {
    const includeHttp = options?.includeHttp ?? false;
    const lines: string[] = [];
    lines.push(`Instance: ${this.instanceName} (${this.instanceId})`);
    if (this.schemaSummary) {
      lines.push(`\n${this.schemaSummary}`);
    }
    lines.push("\nAvailable tools:\n");
    for (const tool of this.tools) {
      const paramsSig = tool.parameters
        .map((p) => p.name + (p.required ? "" : "?"))
        .join(", ");
      lines.push(`## ${tool.name}(${paramsSig})`);
      lines.push(tool.description);
      lines.push(`When to use: ${tool.when_to_use}`);
      if (includeHttp) {
        lines.push(`HTTP: ${tool.http_method} ${tool.http_path}`);
      }
      if (tool.parameters.length > 0) {
        lines.push("Parameters:");
        for (const p of tool.parameters) {
          const req = p.required ? "required" : "optional";
          lines.push(`  - ${p.name} (${p.type}, ${req}): ${p.description}`);
          if (p.enum) {
            lines.push(`    Allowed values: ${p.enum.join(", ")}`);
          }
          if (p.default != null) {
            lines.push(`    Default: ${p.default}`);
          }
        }
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  /** Tool definitions in the Anthropic tool-use format. */
  asAnthropicTools(): Record<string, unknown>[] {
    return this.tools.map((tool) => {
      const { properties, required } = buildJsonSchemaProps(tool.parameters);
      return {
        name: tool.name,
        description: `${tool.description}\n\nWhen to use: ${tool.when_to_use}`,
        input_schema: { type: "object", properties, required },
      };
    });
  }

  /** Tool definitions in the OpenAI function-calling format. */
  asOpenaiTools(): Record<string, unknown>[] {
    return this.tools.map((tool) => {
      const { properties, required } = buildJsonSchemaProps(tool.parameters);
      return {
        type: "function",
        function: {
          name: tool.name,
          description: `${tool.description}\n\nWhen to use: ${tool.when_to_use}`,
          parameters: { type: "object", properties, required },
        },
      };
    });
  }
}

function buildJsonSchemaProps(params: readonly ToolParameterDescription[]): {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
} {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const p of params) {
    const prop: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.enum) prop.enum = p.enum;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  return { properties, required };
}

export class InstanceHandle {
  readonly id: string;
  private readonly _requestOne: RequestOneFn;
  private _describeCache: DescribeResult | null = null;
  private _describeCacheAt = 0;
  private _describeTtlMs = DEFAULT_DESCRIBE_TTL_MS;

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

  /**
   * Return agent-facing tool descriptions enriched with the instance schema.
   *
   * Results are cached locally with a TTL (default 5 min).
   * Call `clearDescribeCache()` to force a refresh.
   */
  async describe(options?: RequestOptions): Promise<DescribeResult> {
    const now = Date.now();
    if (this._describeCache && now - this._describeCacheAt < this._describeTtlMs) {
      return this._describeCache;
    }
    const raw = await this._requestOne<RawDescribeResult>("GET", `/instances/${this.id}/describe`, {
      timeoutMs: options?.timeoutMs,
    });
    const result = new DescribeResult(raw);
    this._describeCache = result;
    this._describeCacheAt = now;
    return result;
  }

  /** Clear the cached describe result so the next `describe()` call fetches fresh data. */
  clearDescribeCache(): void {
    this._describeCache = null;
    this._describeCacheAt = 0;
  }
}
