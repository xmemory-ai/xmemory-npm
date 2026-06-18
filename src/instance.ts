/**
 * InstanceHandle — scoped data operations on a single xmemory instance.
 */

import type {
  ApplyPendingDecisionsResult,
  AsyncWriteResult,
  DecideSuggestionsResult,
  DecisionInput,
  ExtractOptions,
  ExtractResult,
  InstanceSchemaInfo,
  RawDescribeResult,
  ReadOptions,
  ReadResult,
  RequestOneFn,
  RequestOptions,
  ReviewSuggestionsResult,
  SuggestionRequestOptions,
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
    if (options?.scope != null) {
      // Serialize to the API's identity-ADT wire shape: each object is
      // `{type, key: {xuid}}` or `{type, key: {key: {...}}}`, plus `relations_scope`.
      body.scope = {
        objects: options.scope.objects.map((o) => ({
          type: o.type,
          key: o.xuid != null ? { xuid: o.xuid } : { key: o.key },
        })),
        relations_scope: options.scope.relationsScope ?? "no_relations",
      };
    }
    if (options?.traceId != null) body.trace_id = options.traceId;
    return this._requestOne<ReadResult>("POST", `/instances/${this.id}/read`, {
      body,
      timeoutMs: options?.timeoutMs,
    });
  }

  async write(text: string, options?: WriteOptions): Promise<WriteResult> {
    const body: Record<string, unknown> = {
      text,
      extraction_logic: options?.extractionLogic ?? "fast",
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
      extraction_logic: options?.extractionLogic ?? "fast",
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
      extraction_logic: options?.extractionLogic ?? "fast",
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

  // -- Schema evolution (suggestion engine) ---------------------------------

  /**
   * Return the current consolidated schema-improvement proposal (step 1).
   *
   * The result's `proposal.proposal_version` is the optimistic-concurrency
   * token you pass to `decideSuggestions` / `applyPendingDecisions`. When
   * `status === "evolution_in_progress"`, back off for `retry_after_seconds`
   * and retry instead of blocking on the in-flight migration.
   */
  async reviewSuggestions(options?: SuggestionRequestOptions): Promise<ReviewSuggestionsResult> {
    const body: Record<string, unknown> = {};
    if (options?.sessionId != null) body.session_id = options.sessionId;
    return this._requestOne<ReviewSuggestionsResult>("POST", `/instances/${this.id}/suggestions/review`, {
      body,
      timeoutMs: options?.timeoutMs,
    });
  }

  /**
   * Record accept/reject/defer decisions for proposal items, in bulk (step 2).
   *
   * `proposalVersion` must be the token from the latest `reviewSuggestions`; a
   * stale token throws `XmemoryAPIError` with `code === "stale_proposal_version"`.
   * The result's `next_proposal_version` can be passed straight to
   * `applyPendingDecisions`.
   */
  async decideSuggestions(
    proposalVersion: string,
    decisions: DecisionInput[],
    options?: SuggestionRequestOptions,
  ): Promise<DecideSuggestionsResult> {
    const body: Record<string, unknown> = { proposal_version: proposalVersion, decisions };
    if (options?.sessionId != null) body.session_id = options.sessionId;
    return this._requestOne<DecideSuggestionsResult>("POST", `/instances/${this.id}/suggestions/decide`, {
      body,
      timeoutMs: options?.timeoutMs,
    });
  }

  /**
   * Commit accepted decisions as a single migration (step 3).
   *
   * `status === "nothing_to_apply"` means no accepted items were left. A stale
   * `proposalVersion` or an unmet dependency throws `XmemoryAPIError`
   * (`code === "stale_proposal_version"` / `"dependency_closure_failed"`).
   */
  async applyPendingDecisions(
    proposalVersion: string,
    options?: SuggestionRequestOptions,
  ): Promise<ApplyPendingDecisionsResult> {
    const body: Record<string, unknown> = { proposal_version: proposalVersion };
    if (options?.sessionId != null) body.session_id = options.sessionId;
    return this._requestOne<ApplyPendingDecisionsResult>("POST", `/instances/${this.id}/suggestions/apply`, {
      body,
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
