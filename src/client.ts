/**
 * xmemory HTTP client for Node.js.
 */

import type {
  AsyncWriteResponse,
  CreateInstanceResponse,
  ExtractionLogic,
  ReadResponse,
  SchemaTypeValue,
  WriteResponse,
  WriteStatusResponse,
} from "./types.js";

export { SchemaType } from "./types.js";
export type {
  AsyncWriteResponse,
  CreateInstanceResponse,
  ExtractionLogic,
  ReadResponse,
  ReaderResult,
  SchemaTypeValue,
  WriteQueueStatus,
  WriteResponse,
  WriteStatusResponse,
} from "./types.js";

const DEFAULT_BASE_URL = "http://0.0.0.0:8000";
const DEFAULT_TIMEOUT_MS = 60_000;

export class XmemoryAPIError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "XmemoryAPIError";
  }
}

async function getEnv(name: string): Promise<string | undefined> {
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  return undefined;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: object,
  token: string | undefined,
  timeoutMs: number
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeoutMs,
  });
  const raw = await res.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new XmemoryAPIError(`Invalid JSON from server (${res.status})`, res.status);
  }
  if (typeof payload === "object" && payload !== null && (payload as { status?: string }).status === "error") {
    const err = payload as { error_message?: string; error?: string };
    const msg = err.error_message || err.error || String(payload);
    throw new XmemoryAPIError(`${path} failed: ${msg}`, res.status);
  }
  if (!res.ok) {
    throw new XmemoryAPIError(`HTTP ${res.status}: ${raw.slice(0, 200)}`, res.status);
  }
  return payload as T;
}

export interface XmemoryInstanceOptions {
  url?: string;
  token?: string;
  timeoutMs?: number;
}

export class XmemoryClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly token: string | undefined;
  instanceId: string | null = null;

  constructor(options: XmemoryInstanceOptions = {}) {
    this.baseUrl = options.url ?? "";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.token = options.token;
  }

  static async create(options: XmemoryInstanceOptions = {}): Promise<XmemoryClient> {
    const url = options.url ?? (await getEnv("XMEM_API_URL")) ?? DEFAULT_BASE_URL;
    const token = options.token ?? (await getEnv("XMEM_AUTH_TOKEN"));
    const client = new XmemoryClient({ ...options, url, token });
    await client.checkHealth();
    return client;
  }

  private async checkHealth(): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/healthz`;
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      timeoutMs: this.timeoutMs,
    });
    if (!res.ok) {
      throw new XmemoryAPIError(
        `Health check failed: ${res.status} at ${url}`,
        res.status
      );
    }
  }

  private requireInstanceId(op: string): string {
    if (!this.instanceId) {
      throw new XmemoryAPIError(`instance_id is required for ${op}() but none was provided or saved.`);
    }
    return this.instanceId;
  }

  async createInstance(schemaText: string, schemaType: SchemaTypeValue, timeoutMs?: number): Promise<boolean> {
    const path = "/instance/create";
    const body = schemaType === 0 ? { yml_schema: schemaText } : { json_schema: schemaText };
    const response = await postJson<CreateInstanceResponse>(
      this.baseUrl,
      path,
      body,
      this.token,
      timeoutMs ?? this.timeoutMs
    );
    if (response.status === "ok" && response.instance_id) {
      this.instanceId = response.instance_id;
    }
    return response.status === "ok";
  }

  async write(
    text: string,
    options?: { timeoutMs?: number; extractionLogic?: ExtractionLogic; diff_engine?: boolean }
  ): Promise<WriteResponse> {
    const iid = this.requireInstanceId("write");
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    return postJson<WriteResponse>(
      this.baseUrl,
      "/write",
      {
        instance_id: iid,
        text,
        extraction_logic: options?.extractionLogic ?? "deep",
        use_diff_engine: options?.diff_engine,
      },
      this.token,
      timeoutMs
    );
  }

  async writeAsync(
    text: string,
    options?: {
      timeoutMs?: number;
      extractionLogic?: ExtractionLogic;
      diff_engine?: boolean;
    }
  ): Promise<AsyncWriteResponse> {
    const iid = this.requireInstanceId("writeAsync");
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const body: Record<string, unknown> = {
      instance_id: iid,
      text,
      extraction_logic: options?.extractionLogic ?? "deep",
      use_diff_engine: options?.diff_engine,
    };
    return postJson<AsyncWriteResponse>(
      this.baseUrl,
      "/write_async",
      body,
      this.token,
      timeoutMs
    );
  }

  async writeStatus(writeId: string, options?: { timeoutMs?: number }): Promise<WriteStatusResponse> {
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    return postJson<WriteStatusResponse>(
      this.baseUrl,
      "/write_status",
      { write_id: writeId },
      this.token,
      timeoutMs
    );
  }

  async read(query: string, options?: { timeoutMs?: number }): Promise<ReadResponse> {
    const iid = this.requireInstanceId("read");
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const response = await postJson<ReadResponse & { read_id?: string | null }>(
      this.baseUrl,
      "/read",
      {
        instance_id: iid,
        query,
        mode: "single-answer",
      },
      this.token,
      timeoutMs
    );
    return response;
  }

  get instance_id(): string | null {
    return this.instanceId;
  }
}

/**
 * Create an xmemory client.
 */
export async function xmemoryInstance(options: XmemoryInstanceOptions = {}): Promise<XmemoryClient> {
  return XmemoryClient.create(options);
}
