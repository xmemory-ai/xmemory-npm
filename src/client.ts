/**
 * XmemoryClient — main entry point for the xmemory API.
 */

import { InstanceHandle } from "./instance.js";
import {
  type ApiError,
  type ClusterInfo,
  type CreateInstanceOptions,
  type GenerateSchemaOptions,
  type GenerateSchemaResult,
  type InstanceInfo,
  type InstanceSchemaInfo,
  type InternalRequestOptions,
  type RawApiResponse,
  type RequestOptions,
  type SchemaTypeValue,
  type XmemoryClientOptions,
  XmemoryAPIError,
  XmemoryHealthCheckError,
  buildInstanceSchema,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.xmemory.ai";
const DEFAULT_TIMEOUT_MS = 60_000;

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
    options?: RequestOptions,
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
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class XmemoryClient {
  private readonly _baseUrl: string;
  private readonly _timeoutMs: number;
  private readonly _token: string | undefined;

  readonly admin: AdminNamespace;

  constructor(options: XmemoryClientOptions = {}) {
    const env = typeof process !== "undefined" ? process.env : undefined;
    this._baseUrl = (options.url ?? env?.XMEM_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this._token = options.token ?? env?.XMEM_AUTH_TOKEN;
    this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.admin = this._buildAdmin();
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
    if (this._token) h["Authorization"] = `Bearer ${this._token}`;
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
      const msg =
        typeof payload === "object" && payload !== null && "message" in payload
          ? String((payload as { message: string }).message)
          : raw.slice(0, 200);
      throw new XmemoryAPIError(`HTTP ${res.status}: ${msg}`, res.status);
    }

    const response = payload as RawApiResponse;

    if (response.errors?.length) {
      const first: ApiError = response.errors[0];
      throw new XmemoryAPIError(`API error: ${first.message} (${first.code})`, res.status);
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
        return this._requestOne<InstanceInfo>("PUT", `/instances/${instanceId}/schema`, {
          body: { instance_schema: buildInstanceSchema(schemaText, schemaType) },
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
    };
  }
}

/** Convenience factory — creates a client with a health check. */
export async function xmemoryInstance(options: XmemoryClientOptions = {}): Promise<XmemoryClient> {
  return XmemoryClient.create(options);
}
