/**
 * XmemoryClient — main entry point for the xmemory API.
 */

import { InstanceHandle } from "./instance.js";
import {
  type ApiError,
  type ClusterInfo,
  type CreateInstanceOptions,
  type DryRunMigrationOptions,
  type DryRunResult,
  type EnhanceSchemaResult,
  type GenerateSchemaOptions,
  type GenerateSchemaResult,
  type GetMigrationOptions,
  type GetMigrationResult,
  type InstanceInfo,
  type InstanceSchemaInfo,
  type InternalRequestOptions,
  type ListMigrationsOptions,
  type ListMigrationsResult,
  type MigrationRecord,
  type RawApiResponse,
  type RequestOptions,
  type SchemaTypeValue,
  type UpdateInstanceSchemaOptions,
  type XmemoryClientOptions,
  XmemoryAPIError,
  XmemoryHealthCheckError,
  buildInstanceSchema,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.xmemory.ai";
const DEFAULT_TIMEOUT_MS = 60_000;

const ORANGE = "\x1b[38;5;208m";
const RESET = "\x1b[0m";

function deprecationWarning(message: string): void {
  console.warn(`${ORANGE}[xmemory] DEPRECATION: ${message}${RESET}`);
}

/**
 * Pull a structured error out of an error body. Handles the schema-evolution
 * shape (`{status: "error", error_type, error_message, details}`, where
 * `error_type` is the code) and the standard `{errors: [{code, message}]}`
 * envelope.
 */
function extractStructuredError(payload: unknown): {
  code?: string;
  message?: string;
  details?: Record<string, unknown> | null;
} {
  if (typeof payload !== "object" || payload === null) return {};
  const p = payload as Record<string, unknown>;
  if (p.status === "error" && typeof p.error_type === "string") {
    return {
      code: p.error_type,
      message: typeof p.error_message === "string" ? p.error_message : undefined,
      details: (p.details ?? null) as Record<string, unknown> | null,
    };
  }
  const errors = p.errors;
  if (Array.isArray(errors) && errors.length > 0 && typeof errors[0] === "object" && errors[0] !== null) {
    const first = errors[0] as Record<string, unknown>;
    return {
      code: typeof first.code === "string" ? first.code : undefined,
      message: typeof first.message === "string" ? first.message : undefined,
      details: (first.details ?? null) as Record<string, unknown> | null,
    };
  }
  return {};
}

/**
 * Parse the HTTP `Retry-After` response header into a number of seconds, or
 * `undefined` when the header is absent or unparseable. Supports both the
 * delta-seconds form (`Retry-After: 30`) and the HTTP-date form; HTTP-dates
 * are converted to a non-negative second offset from now.
 */
function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
}

// ---------------------------------------------------------------------------
// Admin namespace type (plain object, not a class)
// ---------------------------------------------------------------------------

export interface AdminNamespace {
  listClusters(options?: RequestOptions & { ids?: string[] }): Promise<ClusterInfo[]>;
  getCluster(clusterId: string, options?: RequestOptions): Promise<ClusterInfo>;
  createInstance(
    clusterId: string,
    name: string,
    schemaText: string,
    schemaType: SchemaTypeValue,
    options?: CreateInstanceOptions,
  ): Promise<InstanceHandle>;
  listInstances(options?: RequestOptions & { ids?: string[] }): Promise<InstanceInfo[]>;
  getInstance(instanceId: string, options?: RequestOptions): Promise<InstanceInfo>;
  deleteInstance(instanceId: string, options?: RequestOptions): Promise<string[]>;
  getInstanceSchema(instanceId: string, options?: RequestOptions): Promise<InstanceSchemaInfo>;
  updateInstanceSchema(
    instanceId: string,
    schemaText: string,
    schemaType: SchemaTypeValue,
    options?: UpdateInstanceSchemaOptions,
  ): Promise<InstanceInfo>;
  updateInstanceMetadata(
    instanceId: string,
    name: string,
    description: string,
    options?: RequestOptions,
  ): Promise<InstanceInfo>;
  generateSchema(
    clusterId: string,
    schemaDescription: string,
    options?: GenerateSchemaOptions,
  ): Promise<GenerateSchemaResult>;
  enhanceSchema(
    clusterId: string,
    schemaDescription: string,
    currentYmlSchema: string,
    options?: RequestOptions,
  ): Promise<EnhanceSchemaResult>;
  dryRunMigration(
    instanceId: string,
    schemaText: string,
    schemaType: SchemaTypeValue,
    options?: DryRunMigrationOptions,
  ): Promise<DryRunResult>;
  listMigrations(instanceId: string, options?: ListMigrationsOptions): Promise<ListMigrationsResult>;
  getMigration(instanceId: string, migrationId: string, options?: GetMigrationOptions): Promise<MigrationRecord>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class XmemoryClient {
  private readonly _baseUrl: string;
  private readonly _timeoutMs: number;
  private readonly _apiKey: string | undefined;

  readonly admin: AdminNamespace;

  constructor(options: XmemoryClientOptions = {}) {
    const env = typeof process !== "undefined" ? process.env : undefined;
    this._baseUrl = (options.url ?? env?.XMEM_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this._apiKey = XmemoryClient._resolveApiKey(options, env);
    this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.admin = this._buildAdmin();
  }

  private static _resolveApiKey(
    options: XmemoryClientOptions,
    env: NodeJS.ProcessEnv | undefined,
  ): string | undefined {
    if (options.apiKey != null) return options.apiKey;
    if (options.token != null) {
      deprecationWarning(
        "The `token` constructor option is deprecated and will be removed soon. Use `apiKey` instead.",
      );
      return options.token;
    }
    if (env?.XMEM_API_KEY) return env.XMEM_API_KEY;
    if (env?.XMEM_AUTH_TOKEN) {
      deprecationWarning(
        "The `XMEM_AUTH_TOKEN` environment variable is deprecated and will be removed soon. Use `XMEM_API_KEY` instead.",
      );
      return env.XMEM_AUTH_TOKEN;
    }
    return undefined;
  }

  /** Factory that performs a health check before returning the client. */
  static async create(options: XmemoryClientOptions = {}): Promise<XmemoryClient> {
    const client = new XmemoryClient(options);
    await client.checkHealth();
    return client;
  }

  /** Return an InstanceHandle scoped to the given instance ID. */
  instance(instanceId: string): InstanceHandle {
    return new InstanceHandle(instanceId, this._requestOne.bind(this));
  }

  /** GET /healthz — throws XmemoryHealthCheckError on failure. */
  async checkHealth(): Promise<void> {
    const url = `${this._baseUrl}/healthz`;
    try {
      const res = await this._fetch(url, { method: "GET" }, this._timeoutMs);
      if (!res.ok) {
        throw new XmemoryHealthCheckError(`Health check failed: HTTP ${res.status} at ${url}`, res.status);
      }
    } catch (err) {
      if (err instanceof XmemoryHealthCheckError) throw err;
      throw new XmemoryHealthCheckError(
        `Health check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Private: HTTP layer
  // -----------------------------------------------------------------------

  private async _fetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private _headers(hasBody: boolean = false): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json",
    };
    if (hasBody) h["Content-Type"] = "application/json";
    if (this._apiKey) h["Authorization"] = `Bearer ${this._apiKey}`;
    return h;
  }

  /** Core request — returns the raw API wrapper `{ids, items, errors}`. */
  private async _request(
    method: string,
    path: string,
    options?: InternalRequestOptions,
  ): Promise<RawApiResponse> {
    let url = `${this._baseUrl}${path}`;

    if (options?.params) {
      const sp = new URLSearchParams();
      for (const [key, val] of Object.entries(options.params)) {
        if (Array.isArray(val)) {
          for (const v of val) sp.append(key, v);
        } else {
          sp.append(key, val);
        }
      }
      const qs = sp.toString();
      if (qs) url += `?${qs}`;
    }

    const timeoutMs = options?.timeoutMs ?? this._timeoutMs;
    const hasBody = !!(options?.body && method !== "GET");
    const init: RequestInit = { method, headers: this._headers(hasBody) };
    if (hasBody) {
      init.body = JSON.stringify(options!.body);
    }

    const res = await this._fetch(url, init, timeoutMs);
    const raw = await res.text();

    let payload: unknown;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new XmemoryAPIError(`Invalid JSON from server (${res.status}): ${raw.slice(0, 200)}`, res.status);
    }

    if (!res.ok) {
      const structured = extractStructuredError(payload);
      const msg =
        structured.message ??
        (typeof payload === "object" && payload !== null && "message" in payload
          ? String((payload as { message: string }).message)
          : raw.slice(0, 200));
      throw new XmemoryAPIError(
        `HTTP ${res.status}: ${msg}`,
        res.status,
        structured.code,
        structured.details,
        parseRetryAfter(res),
      );
    }

    const response = payload as RawApiResponse;

    if (response.errors?.length) {
      const first: ApiError = response.errors[0];
      throw new XmemoryAPIError(`API error: ${first.message} (${first.code})`, res.status, first.code);
    }

    return response;
  }

  private async _requestOne<T>(method: string, path: string, options?: InternalRequestOptions): Promise<T> {
    const response = await this._request(method, path, options);
    const items = response.items ?? [];
    if (items.length === 0) {
      throw new XmemoryAPIError(`Expected one item from ${method} ${path}, got none`);
    }
    if (items.length > 1) {
      throw new XmemoryAPIError(`Expected one item from ${method} ${path}, got ${items.length}`);
    }
    return items[0] as T;
  }

  private async _requestList<T>(method: string, path: string, options?: InternalRequestOptions): Promise<T[]> {
    const response = await this._request(method, path, options);
    return (response.items ?? []) as T[];
  }

  private async _requestIds(method: string, path: string, options?: InternalRequestOptions): Promise<string[]> {
    const response = await this._request(method, path, options);
    return response.ids ?? [];
  }

  // -----------------------------------------------------------------------
  // Private: build admin namespace
  // -----------------------------------------------------------------------

  private _buildAdmin(): AdminNamespace {
    return {
      listClusters: async (options?) => {
        const params = options?.ids ? { ids: options.ids } : undefined;
        return this._requestList<ClusterInfo>("GET", "/clusters", { params, timeoutMs: options?.timeoutMs });
      },

      getCluster: async (clusterId, options?) => {
        return this._requestOne<ClusterInfo>("GET", `/clusters/${clusterId}`, {
          timeoutMs: options?.timeoutMs,
        });
      },

      createInstance: async (clusterId, name, schemaText, schemaType, options?) => {
        const body: Record<string, unknown> = {
          name,
          instance_schema: buildInstanceSchema(schemaText, schemaType),
        };
        if (options?.description != null) body.description = options.description;
        if (options?.schemaDescription != null) body.schema_description = options.schemaDescription;
        const info = await this._requestOne<InstanceInfo>("POST", `/clusters/${clusterId}/instances`, {
          body,
          timeoutMs: options?.timeoutMs,
        });
        return this.instance(info.id);
      },

      listInstances: async (options?) => {
        const params = options?.ids ? { ids: options.ids } : undefined;
        return this._requestList<InstanceInfo>("GET", "/instances", { params, timeoutMs: options?.timeoutMs });
      },

      getInstance: async (instanceId, options?) => {
        return this._requestOne<InstanceInfo>("GET", `/instances/${instanceId}`, {
          timeoutMs: options?.timeoutMs,
        });
      },

      deleteInstance: async (instanceId, options?) => {
        return this._requestIds("DELETE", `/instances/${instanceId}`, {
          timeoutMs: options?.timeoutMs,
        });
      },

      getInstanceSchema: async (instanceId, options?) => {
        return this._requestOne<InstanceSchemaInfo>("GET", `/instances/${instanceId}/schema`, {
          timeoutMs: options?.timeoutMs,
        });
      },

      updateInstanceSchema: async (instanceId, schemaText, schemaType, options?) => {
        const body: Record<string, unknown> = {
          instance_schema: buildInstanceSchema(schemaText, schemaType),
        };
        if (options?.migrationPlan != null) body.migration_plan = options.migrationPlan;
        if (options?.confirmDestructive != null) body.confirm_destructive = options.confirmDestructive;
        return this._requestOne<InstanceInfo>("PUT", `/instances/${instanceId}/schema`, {
          body,
          timeoutMs: options?.timeoutMs,
        });
      },

      updateInstanceMetadata: async (instanceId, name, description, options?) => {
        return this._requestOne<InstanceInfo>("PUT", `/instances/${instanceId}`, {
          body: { name, description },
          timeoutMs: options?.timeoutMs,
        });
      },

      generateSchema: async (clusterId, schemaDescription, options?) => {
        const body: Record<string, unknown> = { schema_description: schemaDescription };
        if (options?.currentYmlSchema != null) body.current_yml_schema = options.currentYmlSchema;
        return this._requestOne<GenerateSchemaResult>(
          "POST",
          `/clusters/${clusterId}/instances/generate_schema`,
          { body, timeoutMs: options?.timeoutMs },
        );
      },

      enhanceSchema: async (clusterId, schemaDescription, currentYmlSchema, options?) => {
        return this._requestOne<EnhanceSchemaResult>(
          "POST",
          `/clusters/${clusterId}/instances/generate_schema`,
          {
            body: { schema_description: schemaDescription, current_yml_schema: currentYmlSchema },
            timeoutMs: options?.timeoutMs,
          },
        );
      },

      dryRunMigration: async (instanceId, schemaText, schemaType, options?) => {
        const body: Record<string, unknown> = {
          instance_schema: buildInstanceSchema(schemaText, schemaType),
        };
        if (options?.migrationPlan != null) body.migration_plan = options.migrationPlan;
        if (options?.confirmDestructive != null) body.confirm_destructive = options.confirmDestructive;
        return this._requestOne<DryRunResult>("POST", `/instances/${instanceId}/migrations/dry_run`, {
          body,
          timeoutMs: options?.timeoutMs,
        });
      },

      listMigrations: async (instanceId, options?) => {
        const params: Record<string, string> = {
          limit: String(options?.limit ?? 50),
          include_yaml: String(options?.includeYaml ?? false),
        };
        if (options?.beforeId != null) params.before_id = options.beforeId;
        return this._requestOne<ListMigrationsResult>("GET", `/instances/${instanceId}/migrations`, {
          params,
          timeoutMs: options?.timeoutMs,
        });
      },

      getMigration: async (instanceId, migrationId, options?) => {
        const result = await this._requestOne<GetMigrationResult>(
          "GET",
          `/instances/${instanceId}/migrations/${migrationId}`,
          { params: { include_yaml: String(options?.includeYaml ?? false) }, timeoutMs: options?.timeoutMs },
        );
        return result.record;
      },
    };
  }
}

/** Convenience factory — creates a client with a health check. */
export async function xmemoryInstance(options: XmemoryClientOptions = {}): Promise<XmemoryClient> {
  return XmemoryClient.create(options);
}
