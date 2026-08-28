import { readFileSync } from "node:fs";

import {
  AgentSurface,
  BindingTier,
  XmemoryClient,
  XmemoryAPIError,
  XmemoryHealthCheckError,
  SetupFormat,
  StepKind,
  FragmentMerge,
  type StepKindValue,
  InstanceHandle,
  xmemoryInstance,
  SchemaType,
  type WriteMutation,
} from "./src/index.js";
import { CLIENT_HEADER, buildClientIdentity, withClientHeader } from "./src/client.js";
import { VERSION } from "./src/version.js";

const errors: string[] = [];

function check(name: string, ok: boolean) {
  if (!ok) errors.push(name);
}

// Core exports exist
check("XmemoryClient", typeof XmemoryClient === "function");
check("XmemoryAPIError", typeof XmemoryAPIError === "function");
check("XmemoryHealthCheckError", typeof XmemoryHealthCheckError === "function");
check("InstanceHandle", typeof InstanceHandle === "function");
check("xmemoryInstance", typeof xmemoryInstance === "function");

// SchemaType enum
check("SchemaType.YML === 0", SchemaType.YML === 0);
check("SchemaType.JSON === 1", SchemaType.JSON === 1);

// Client is constructable (no health check)
const client = new XmemoryClient({ url: "http://localhost:9999", apiKey: "test" });
check("client instanceof XmemoryClient", client instanceof XmemoryClient);

// admin namespace has expected methods
check("admin.listClusters", typeof client.admin.listClusters === "function");
check("admin.getCluster", typeof client.admin.getCluster === "function");
check("admin.createInstance", typeof client.admin.createInstance === "function");
check("admin.listInstances", typeof client.admin.listInstances === "function");
check("admin.getInstance", typeof client.admin.getInstance === "function");
check("admin.deleteInstance", typeof client.admin.deleteInstance === "function");
check("admin.getInstanceSchema", typeof client.admin.getInstanceSchema === "function");
check("admin.updateInstanceSchema", typeof client.admin.updateInstanceSchema === "function");
check("admin.updateInstanceMetadata", typeof client.admin.updateInstanceMetadata === "function");
check("admin.patchInstanceMetadata", typeof client.admin.patchInstanceMetadata === "function");
check("admin.getSetupInstructions", typeof client.admin.getSetupInstructions === "function");
check("instance.setupInstructions", typeof client.instance("i").setupInstructions === "function");
check("admin.generateSchema", typeof client.admin.generateSchema === "function");

// instance() returns InstanceHandle with correct id
const inst = client.instance("test-id");
check("inst instanceof InstanceHandle", inst instanceof InstanceHandle);
check("inst.id === 'test-id'", inst.id === "test-id");

// InstanceHandle has expected methods
check("inst.read", typeof inst.read === "function");
check("inst.write", typeof inst.write === "function");
check("inst.writeAsync", typeof inst.writeAsync === "function");
check("inst.writeStatus", typeof inst.writeStatus === "function");
check("inst.extract", typeof inst.extract === "function");
check("inst.getSchema", typeof inst.getSchema === "function");

// Error classes
try {
  throw new XmemoryAPIError("test", 400);
} catch (e) {
  check("XmemoryAPIError instanceof", e instanceof XmemoryAPIError);
  check("XmemoryAPIError instanceof Error", e instanceof Error);
  check("XmemoryAPIError.status", (e as XmemoryAPIError).status === 400);
}

try {
  throw new XmemoryHealthCheckError("health", 503);
} catch (e) {
  check("XmemoryHealthCheckError instanceof XmemoryAPIError", e instanceof XmemoryAPIError);
  check("XmemoryHealthCheckError instanceof XmemoryHealthCheckError", e instanceof XmemoryHealthCheckError);
}

// ---------------------------------------------------------------------------
// Mock-fetch helper
// ---------------------------------------------------------------------------

type FetchFn = typeof globalThis.fetch;

function mockFetch(
  handler: (
    url: string,
    init?: RequestInit,
  ) => { status: number; body: unknown; headers?: Record<string, string> },
): FetchFn {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const { status, body, headers } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    });
  }) as FetchFn;
}

// ---------------------------------------------------------------------------
// Test: Content-Type header only set when body is present
// ---------------------------------------------------------------------------

{
  let capturedHeaders: Record<string, string> = {};

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((url, init) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    if (url.endsWith("/healthz")) return { status: 200, body: {} };
    return { status: 200, body: { items: [{ id: "1" }] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });

  // GET request — should NOT have Content-Type
  await c.admin.listClusters();
  check("GET: no Content-Type header", capturedHeaders["Content-Type"] === undefined);
  check("GET: has Accept header", capturedHeaders["Accept"] === "application/json");

  // POST request with body — should have Content-Type
  const inst = c.instance("test-inst");
  await inst.write("hello");
  check("POST: has Content-Type header", capturedHeaders["Content-Type"] === "application/json");

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: _requestOne throws when server returns multiple items
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => {
    return { status: 200, body: { items: [{ id: "1" }, { id: "2" }, { id: "3" }] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  let threwOnMultiple = false;
  let errorMsg = "";
  try {
    await c.admin.getCluster("some-cluster");
  } catch (e) {
    if (e instanceof XmemoryAPIError) {
      threwOnMultiple = true;
      errorMsg = e.message;
    }
  }
  check("_requestOne throws on multiple items", threwOnMultiple);
  check("_requestOne error mentions count", errorMsg.includes("got 3"));

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: diffEngine option is sent as the use_diff_engine wire key
// ---------------------------------------------------------------------------

{
  let capturedBody: Record<string, unknown> = {};

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((_url, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return { status: 200, body: { items: [{ write_id: "w1", trace_id: "t1" }] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const inst = c.instance("test-inst");

  await inst.write("hello", { diffEngine: true });
  check("write: diffEngine sent as use_diff_engine", capturedBody["use_diff_engine"] === true);
  check("write: no diff_engine wire key", !("diff_engine" in capturedBody));

  await inst.writeAsync("hello", { diffEngine: false });
  check("writeAsync: diffEngine sent as use_diff_engine", capturedBody["use_diff_engine"] === false);
  check("writeAsync: no diff_engine wire key", !("diff_engine" in capturedBody));

  await inst.write("hello");
  check("write: use_diff_engine omitted when diffEngine unset", !("use_diff_engine" in capturedBody));

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: structured writes — WriteMutation[] goes to the wire untransformed
// ---------------------------------------------------------------------------

{
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return { status: 200, body: { items: [{ write_id: "w1", trace_id: "t1" }] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const inst = c.instance("test-inst");

  // The typed one-of unions compile-check here (tsc is half of `npm test`).
  const mutations: WriteMutation[] = [
    {
      object_mutation: {
        object_type: "person",
        create: { key: { email: "a@x.io" }, values: { name: "Alice" } },
      },
    },
    {
      relation_mutation: {
        relation_type: "works_at",
        delete: { endpoints: [{ object_name: "person", key: { email: "a@x.io" } }], allow_bulk_delete: true },
      },
    },
  ];

  await inst.write(mutations);
  check("structured write: hits /write", capturedUrl.endsWith("/instances/test-inst/write"));
  check(
    "structured write: mutations untransformed",
    JSON.stringify(capturedBody.structured_mutations) === JSON.stringify(mutations),
  );
  check("structured write: no text key", !("text" in capturedBody));
  check("structured write: no extraction_logic key", !("extraction_logic" in capturedBody));

  await inst.writeAsync([
    { object_mutation: { object_type: "person", update: { key: { xuid: "x-1" }, values: { role: null } } } },
  ]);
  check("structured writeAsync: hits /write_async", capturedUrl.endsWith("/instances/test-inst/write_async"));
  check(
    "structured writeAsync: null field-clear survives",
    JSON.stringify(capturedBody.structured_mutations).includes('"role":null'),
  );

  await inst.write("plain text");
  check("text write: no structured_mutations key", !("structured_mutations" in capturedBody));

  let threwOnEmpty = false;
  try {
    await inst.write([]);
  } catch {
    threwOnEmpty = true;
  }
  check("structured write: empty array throws", threwOnEmpty);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: _requestOne throws when server returns zero items
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => {
    return { status: 200, body: { items: [] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  let threwOnNone = false;
  try {
    await c.admin.getCluster("some-cluster");
  } catch (e) {
    if (e instanceof XmemoryAPIError) threwOnNone = true;
  }
  check("_requestOne throws on zero items", threwOnNone);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: _requestOne succeeds with exactly one item
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => {
    return { status: 200, body: { items: [{ id: "cluster-1", name: "test" }] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const result = await c.admin.getCluster("cluster-1");
  check("_requestOne returns item on exactly one", (result as any).id === "cluster-1");

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: decomposed read surfaces per-sub-query results
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 200,
    body: {
      items: [
        {
          trace_id: "r-1",
          reader_result: "combined answer",
          reader_results: [
            { sub_query: "Who is Bob?", reader_result: "An engineer", error: null },
            { sub_query: "Who is Ann?", reader_result: "", error: "no data" },
          ],
        },
      ],
    },
  }));

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const res = await c.instance("inst-1").read("Who are Bob and Ann?");
  check("decomposed read keeps combined reader_result", res.reader_result === "combined answer");
  check("decomposed read exposes two sub-queries", res.reader_results.length === 2);
  check("sub-query is tagged", res.reader_results[0].sub_query === "Who is Bob?");
  check("sub-query answer surfaces", res.reader_results[0].reader_result === "An engineer");
  check("per-sub-query error surfaces", res.reader_results[1].error === "no data");

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: server omits reader_results => client normalizes to []
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 200,
    body: { items: [{ trace_id: "r-1", reader_result: "An engineer" }] },
  }));

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const res = await c.instance("inst-1").read("Who is Bob?");
  check("undecomposed read reader_result surfaces", res.reader_result === "An engineer");
  check(
    "undecomposed read normalizes reader_results to an empty array",
    Array.isArray(res.reader_results) && res.reader_results.length === 0,
  );

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: every data operation surfaces its console link
//
// The API has always sent `console_url`; this client dropped it, so pointing at what
// a call did meant rebuilding the URL from a trace id and a hostname the library
// never disclosed.
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  const link = "https://console.xmemory.ai/write/w-1";
  globalThis.fetch = mockFetch(() => ({
    status: 200,
    body: {
      items: [
        {
          write_id: "w-1",
          trace_id: "t-1",
          console_url: link,
          write_status: "completed",
          reader_result: "An engineer",
          objects_extracted: { objects: [] },
        },
      ],
    },
  }));

  const inst = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" }).instance("inst-1");
  check("read carries its console link", (await inst.read("Who is Bob?")).console_url === link);
  check("write carries its console link", (await inst.write("Bob is an engineer.")).console_url === link);
  check("async write carries its console link", (await inst.writeAsync("Bob.")).console_url === link);
  check("async write carries its trace id", (await inst.writeAsync("Bob.")).trace_id === "t-1");
  check("write status carries its console link", (await inst.writeStatus("w-1")).console_url === link);
  check("extract carries its console link", (await inst.extract("Bob is an engineer.")).console_url === link);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: no console configured => the link normalizes to null, not undefined
//
// The server omits the field rather than sending null, so a caller comparing against
// null would otherwise read undefined on exactly the deployments that have no link.
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 200,
    body: { items: [{ write_id: "w-1", reader_result: "An engineer", objects_extracted: { objects: [] } }] },
  }));

  const inst = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" }).instance("inst-1");
  check("read reports no link as null", (await inst.read("Who is Bob?")).console_url === null);
  check("write reports no link as null", (await inst.write("Bob.")).console_url === null);
  check("async write reports no link as null", (await inst.writeAsync("Bob.")).console_url === null);
  check("async write reports no trace id as null", (await inst.writeAsync("Bob.")).trace_id === null);
  check("write status reports no link as null", (await inst.writeStatus("w-1")).console_url === null);
  check("extract reports no link as null", (await inst.extract("Bob.")).console_url === null);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: RawApiResponse with missing fields (optional ids/items/errors)
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => {
    // Server returns empty object — no ids, items, or errors fields
    return { status: 200, body: {} };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });

  // _requestList should return empty array when items is undefined
  const list = await c.admin.listClusters();
  check("optional items: listClusters returns []", Array.isArray(list) && list.length === 0);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: API error in response.errors is surfaced
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => {
    return {
      status: 200,
      body: { errors: [{ code: "INVALID", message: "bad request" }] },
    };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  let threwApiError = false;
  let apiErrorMsg = "";
  try {
    await c.admin.listClusters();
  } catch (e) {
    if (e instanceof XmemoryAPIError) {
      threwApiError = true;
      apiErrorMsg = e.message;
    }
  }
  check("API errors array triggers throw", threwApiError);
  check("API error message included", apiErrorMsg.includes("bad request"));

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: `token` constructor option is deprecated — warns in orange, still works
// ---------------------------------------------------------------------------

function captureWarnings<T>(fn: () => T): { warnings: string[]; result: T } {
  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  try {
    const result = fn();
    return { warnings, result };
  } finally {
    console.warn = origWarn;
  }
}

const ORANGE_ANSI = "\x1b[38;5;208m";

{
  const { warnings } = captureWarnings(
    () => new XmemoryClient({ url: "http://localhost:1", token: "legacy" }),
  );
  check("token option: emits exactly one warning", warnings.length === 1);
  check("token option: warning mentions deprecation", warnings[0].toLowerCase().includes("deprecat"));
  check("token option: warning mentions `apiKey`", warnings[0].includes("apiKey"));
  check("token option: warning uses orange ANSI color", warnings[0].includes(ORANGE_ANSI));
}

// ---------------------------------------------------------------------------
// Test: `apiKey` constructor option — no warning, sent as Bearer
// ---------------------------------------------------------------------------

{
  const { warnings } = captureWarnings(
    () => new XmemoryClient({ url: "http://localhost:1", apiKey: "modern" }),
  );
  check("apiKey option: no deprecation warning", warnings.length === 0);

  let capturedAuth = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((_url, init) => {
    capturedAuth = ((init?.headers ?? {}) as Record<string, string>)["Authorization"] ?? "";
    return { status: 200, body: { items: [] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "modern" });
  await c.admin.listClusters();
  check("apiKey option: sent as Bearer token", capturedAuth === "Bearer modern");

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: `apiKey` takes precedence over deprecated `token`
// ---------------------------------------------------------------------------

{
  const { warnings } = captureWarnings(
    () => new XmemoryClient({ url: "http://localhost:1", apiKey: "new", token: "old" }),
  );
  check("apiKey wins over token: no warning", warnings.length === 0);

  let capturedAuth = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((_url, init) => {
    capturedAuth = ((init?.headers ?? {}) as Record<string, string>)["Authorization"] ?? "";
    return { status: 200, body: { items: [] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "new", token: "old" });
  await c.admin.listClusters();
  check("apiKey wins over token: uses apiKey value", capturedAuth === "Bearer new");

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: env var `XMEM_AUTH_TOKEN` is deprecated; `XMEM_API_KEY` is the new name
// ---------------------------------------------------------------------------

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    original[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

{
  const { warnings } = captureWarnings(() =>
    withEnv(
      { XMEM_API_KEY: undefined, XMEM_AUTH_TOKEN: "legacy-env" },
      () => new XmemoryClient({ url: "http://localhost:1" }),
    ),
  );
  check("XMEM_AUTH_TOKEN: emits one deprecation warning", warnings.length === 1);
  check(
    "XMEM_AUTH_TOKEN: warning mentions XMEM_API_KEY",
    warnings[0].includes("XMEM_API_KEY"),
  );
  check("XMEM_AUTH_TOKEN: warning uses orange ANSI color", warnings[0].includes(ORANGE_ANSI));
}

{
  const { warnings } = captureWarnings(() =>
    withEnv(
      { XMEM_API_KEY: "new-env", XMEM_AUTH_TOKEN: undefined },
      () => new XmemoryClient({ url: "http://localhost:1" }),
    ),
  );
  check("XMEM_API_KEY: no deprecation warning", warnings.length === 0);
}

{
  // Both env vars set: API_KEY wins, no warning.
  const { warnings } = captureWarnings(() =>
    withEnv(
      { XMEM_API_KEY: "new-env", XMEM_AUTH_TOKEN: "legacy-env" },
      () => new XmemoryClient({ url: "http://localhost:1" }),
    ),
  );
  check("XMEM_API_KEY beats XMEM_AUTH_TOKEN: no warning", warnings.length === 0);

  let capturedAuth = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((_url, init) => {
    capturedAuth = ((init?.headers ?? {}) as Record<string, string>)["Authorization"] ?? "";
    return { status: 200, body: { items: [] } };
  });
  await withEnv(
    { XMEM_API_KEY: "new-env", XMEM_AUTH_TOKEN: "legacy-env" },
    async () => {
      const c = new XmemoryClient({ url: "http://localhost:1" });
      await c.admin.listClusters();
    },
  );
  check("XMEM_API_KEY beats XMEM_AUTH_TOKEN: uses new value", capturedAuth === "Bearer new-env");
  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Schema evolution — method presence
// ---------------------------------------------------------------------------

check("admin.enhanceSchema", typeof client.admin.enhanceSchema === "function");
check("admin.dryRunMigration", typeof client.admin.dryRunMigration === "function");
check("admin.listMigrations", typeof client.admin.listMigrations === "function");
check("admin.getMigration", typeof client.admin.getMigration === "function");
check("inst.reviewSuggestions", typeof inst.reviewSuggestions === "function");
check("inst.decideSuggestions", typeof inst.decideSuggestions === "function");
check("inst.applyPendingDecisions", typeof inst.applyPendingDecisions === "function");

// ---------------------------------------------------------------------------
// Schema evolution — request-body mapping (camelCase opts -> snake_case wire)
// ---------------------------------------------------------------------------

{
  let captured: { url: string; body: Record<string, unknown> | null } = { url: "", body: null };
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch((url, init) => {
    captured = { url, body: init?.body ? JSON.parse(init.body as string) : null };
    return { status: 200, body: { items: [{ id: "i", cluster_id: "c", name: "n", description: null }] } };
  });
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  await c.admin.updateInstanceSchema("inst-1", "objects: {}", SchemaType.YML, {
    migrationPlan: { ops: [{ op_type: "remove_field", object_name: "P", field_name: "x" }] },
    confirmDestructive: true,
  });
  const body = captured.body ?? {};
  check("updateInstanceSchema sends migration_plan", "migration_plan" in body);
  check("updateInstanceSchema sends confirm_destructive=true", body.confirm_destructive === true);
  check(
    "updateInstanceSchema plan keeps snake_case op",
    JSON.stringify(body.migration_plan).includes("remove_field"),
  );
  globalThis.fetch = orig;
}

// ---------------------------------------------------------------------------
// Schema evolution — enhanceSchema passes through the migration plan
// ---------------------------------------------------------------------------

{
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 200,
    body: {
      items: [
        {
          data_schema: { objects: {} },
          migration_plan: { ops: [{ op_type: "rename_field", object_name: "P", old_name: "a", new_name: "b" }] },
          summary: "rename a to b",
          warnings: [],
          repair_log: [],
        },
      ],
    },
  }));
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const result = await c.admin.enhanceSchema("cluster-1", "rename a to b", "objects:\n  P: {}");
  check("enhanceSchema returns migration_plan", result.migration_plan !== null);
  check("enhanceSchema op type preserved", result.migration_plan?.ops[0]?.op_type === "rename_field");
  check("enhanceSchema summary", result.summary === "rename a to b");
  globalThis.fetch = orig;
}

// ---------------------------------------------------------------------------
// Schema evolution — listMigrations query params + getMigration unwraps record
// ---------------------------------------------------------------------------

{
  const record = {
    id: "mig-1",
    applied_at: "2026-06-01T12:00:00Z",
    source: "suggestion_engine",
    decided_by: null,
    prior_version: 3,
    new_version: 4,
    ops: [],
    ops_summary: { count_by_op_type: {}, total: 0 },
    notes: null,
    yaml_before: null,
    yaml_after: null,
  };
  let listUrl = "";
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch((url) => {
    listUrl = url;
    if (url.includes("/migrations/mig-1")) {
      return { status: 200, body: { items: [{ status: "ok", instance_id: "inst-1", record }] } };
    }
    return {
      status: 200,
      body: { items: [{ status: "ok", instance_id: "inst-1", items: [record], next_before_id: null, has_more: false }] },
    };
  });
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const listed = await c.admin.listMigrations("inst-1", { limit: 10, includeYaml: false });
  check("listMigrations returns items", listed.items.length === 1);
  check("listMigrations limit param", listUrl.includes("limit=10"));
  check("listMigrations include_yaml param", listUrl.includes("include_yaml=false"));
  const got = await c.admin.getMigration("inst-1", "mig-1");
  check("getMigration unwraps record", got.id === "mig-1" && got.new_version === 4);
  globalThis.fetch = orig;
}

// ---------------------------------------------------------------------------
// Schema evolution — decideSuggestions body + structured error code
// ---------------------------------------------------------------------------

{
  let body: Record<string, unknown> | null = null;
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch((_url, init) => {
    body = init?.body ? JSON.parse(init.body as string) : null;
    return {
      status: 200,
      body: {
        items: [
          { status: "ok", instance_id: "inst-1", decisions_recorded: [], warnings: [], next_proposal_version: "v2" },
        ],
      },
    };
  });
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const decided = await c.instance("inst-1").decideSuggestions("v1", [
    { item_fingerprint: "fp1", decision: "accept" },
  ]);
  check("decideSuggestions next_proposal_version", decided.next_proposal_version === "v2");
  check("decideSuggestions sends proposal_version", (body ?? {}).proposal_version === "v1");
  globalThis.fetch = orig;
}

{
  // Structured schema-evolution error: error_type surfaces as `code`.
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 409,
    body: {
      status: "error",
      error_type: "stale_proposal_version",
      error_message: "Proposal version is stale.",
      details: { current: "xyz" },
    },
  }));
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  try {
    await c.instance("inst-1").applyPendingDecisions("old-token");
    check("applyPendingDecisions throws on stale token", false);
  } catch (e) {
    check("applyPendingDecisions throws XmemoryAPIError", e instanceof XmemoryAPIError);
    check("error code is stale_proposal_version", (e as XmemoryAPIError).code === "stale_proposal_version");
    check("error status is 409", (e as XmemoryAPIError).status === 409);
    check(
      "error details preserved",
      JSON.stringify((e as XmemoryAPIError).details) === JSON.stringify({ current: "xyz" }),
    );
  }
  globalThis.fetch = orig;
}

// ---------------------------------------------------------------------------
// Accounts error contract — discriminate on `code`, not the bare HTTP status.
// ---------------------------------------------------------------------------

{
  // 402 QUOTA_EXCEEDED — non-retryable quota exhaustion. details carries
  // kind + retry_after_seconds, and the transport surfaces the HTTP
  // Retry-After header as `retryAfter`.
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 402,
    headers: { "Retry-After": "3600" },
    body: {
      errors: [
        {
          code: "QUOTA_EXCEEDED",
          message: "Daily token quota exhausted.",
          details: { kind: "daily_quota_exceeded", retry_after_seconds: 3600 },
        },
      ],
    },
  }));
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  try {
    await c.instance("inst-1").read("anything");
    check("QUOTA_EXCEEDED throws", false);
  } catch (e) {
    const err = e as XmemoryAPIError;
    check("QUOTA_EXCEEDED throws XmemoryAPIError", e instanceof XmemoryAPIError);
    check("QUOTA_EXCEEDED status is 402", err.status === 402);
    check("QUOTA_EXCEEDED code surfaces", err.code === "QUOTA_EXCEEDED");
    const details = err.details as { kind?: string; retry_after_seconds?: number } | null;
    check("QUOTA_EXCEEDED details.kind surfaces", details?.kind === "daily_quota_exceeded");
    check(
      "QUOTA_EXCEEDED details.retry_after_seconds surfaces",
      details?.retry_after_seconds === 3600,
    );
    check("QUOTA_EXCEEDED retryAfter from header", err.retryAfter === 3600);
  }
  globalThis.fetch = orig;
}

{
  // 402 with no details and no Retry-After header — the code still surfaces,
  // which is what callers branch on.
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 402,
    body: { errors: [{ code: "QUOTA_EXCEEDED", message: "Quota exhausted." }] },
  }));
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  try {
    await c.instance("inst-1").write("note");
    check("bare 402 throws", false);
  } catch (e) {
    const err = e as XmemoryAPIError;
    check("bare 402 throws XmemoryAPIError", e instanceof XmemoryAPIError);
    check("bare 402 status is 402", err.status === 402);
    check("bare 402 code surfaces", err.code === "QUOTA_EXCEEDED");
    check("bare 402 no Retry-After -> retryAfter undefined", err.retryAfter === undefined);
  }
  globalThis.fetch = orig;
}

{
  // 429 RATE_LIMITED — genuine velocity limit, retryable with backoff. The
  // Retry-After header is surfaced as `retryAfter`.
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 429,
    headers: { "Retry-After": "30" },
    body: { errors: [{ code: "RATE_LIMITED", message: "Too many requests." }] },
  }));
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  try {
    await c.instance("inst-1").read("anything");
    check("RATE_LIMITED throws", false);
  } catch (e) {
    const err = e as XmemoryAPIError;
    check("RATE_LIMITED throws XmemoryAPIError", e instanceof XmemoryAPIError);
    check("RATE_LIMITED status is 429", err.status === 429);
    check("RATE_LIMITED code surfaces", err.code === "RATE_LIMITED");
    check("RATE_LIMITED retryAfter from header", err.retryAfter === 30);
  }
  globalThis.fetch = orig;
}

{
  // Retry-After in the HTTP-date form (RFC 7231) is converted to a
  // non-negative number of seconds from now, not left as a raw string.
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 402,
    headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
    body: { errors: [{ code: "QUOTA_EXCEEDED", message: "Daily token quota exhausted." }] },
  }));
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  try {
    await c.instance("inst-1").read("anything");
    check("Retry-After HTTP-date throws", false);
  } catch (e) {
    const err = e as XmemoryAPIError;
    check("Retry-After HTTP-date: retryAfter is a number", typeof err.retryAfter === "number");
    check(
      "Retry-After HTTP-date: retryAfter is finite and >= 0",
      Number.isFinite(err.retryAfter) && (err.retryAfter as number) >= 0,
    );
  }
  globalThis.fetch = orig;
}

{
  // A Retry-After that is neither delta-seconds nor a valid HTTP-date leaves
  // retryAfter undefined rather than NaN or a bogus number.
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 402,
    headers: { "Retry-After": "not-a-date" },
    body: { errors: [{ code: "QUOTA_EXCEEDED", message: "Daily token quota exhausted." }] },
  }));
  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  try {
    await c.instance("inst-1").read("anything");
    check("Retry-After unparseable throws", false);
  } catch (e) {
    const err = e as XmemoryAPIError;
    check("Retry-After unparseable: retryAfter is undefined", err.retryAfter === undefined);
  }
  globalThis.fetch = orig;
}

// ---------------------------------------------------------------------------
// Test: describe() surfaces the first-party `about` field
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((url) => {
    if (url.endsWith("/describe")) {
      return {
        status: 200,
        body: {
          items: [
            {
              instance_id: "test-inst",
              instance_name: "Test Instance",
              about: "xmemory is a first-party memory store.",
              schema_summary: "",
              tools: [],
            },
          ],
        },
      };
    }
    return { status: 200, body: { items: [] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const result = await c.instance("test-inst").describe();
  check("describe: about parsed", result.about === "xmemory is a first-party memory store.");
  check("describe: about in asText", result.asText().includes("xmemory is a first-party memory store."));

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: describe() about defaults to "" when an older server omits it
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => {
    return {
      status: 200,
      body: { items: [{ instance_id: "i", instance_name: "n", schema_summary: "", tools: [] }] },
    };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const result = await c.instance("i").describe();
  check("describe: about defaults to empty when absent", result.about === "");

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: agent-facing instance metadata
// ---------------------------------------------------------------------------

const INSTANCE_ITEM = { id: "i", cluster_id: "c", name: "n", description: null, data_schema: null };

/** Run `fn` against a stub that records the last request, and return that request. */
async function captureRequest(
  fn: (c: XmemoryClient) => Promise<unknown>,
  item: Record<string, unknown> = INSTANCE_ITEM,
  url = "http://localhost:1",
): Promise<{ method: string; body: Record<string, unknown>; url: string }> {
  const origFetch = globalThis.fetch;
  let captured = { method: "", body: {} as Record<string, unknown>, url: "" };
  globalThis.fetch = mockFetch((requestUrl, init) => {
    captured = {
      method: init?.method ?? "",
      body: init?.body ? JSON.parse(init.body as string) : {},
      url: String(requestUrl),
    };
    return { status: 200, body: { items: [item] } };
  });
  try {
    await fn(new XmemoryClient({ url, apiKey: "t" }));
  } finally {
    globalThis.fetch = origFetch;
  }
  return captured;
}

{
  // The wipe this whole design exists to prevent: the endpoint clears any field it
  // is sent, so a rename that also serialized agent_owner_instructions would erase
  // an owner's standing rule as a side effect of changing the name.
  const req = await captureRequest((c) => c.admin.updateInstanceMetadata("i", "new-name", "new-desc"));
  check(
    "rename does not touch the owner instructions",
    JSON.stringify(req.body) === JSON.stringify({ name: "new-name", description: "new-desc" }),
  );
  check("rename uses PUT", req.method === "PUT");
}

{
  const req = await captureRequest((c) =>
    c.admin.updateInstanceMetadata("i", "n", "d", { agentOwnerInstructions: null }),
  );
  check("owner instructions cleared only when passed explicitly", req.body.agent_owner_instructions === null);
}

{
  const req = await captureRequest((c) =>
    c.admin.updateInstanceMetadata("i", "n", "d", {
      agentOwnerInstructions: "Prefer updating an existing record.",
      expectedOwnerInstructionsEpoch: 7,
    }),
  );
  check("update sends the instructions", req.body.agent_owner_instructions === "Prefer updating an existing record.");
  check("update sends the epoch guard", req.body.expected_owner_instructions_epoch === 7);
}

{
  const req = await captureRequest((c) => c.admin.patchInstanceMetadata("i", { name: "renamed" }));
  check("patch uses PATCH", req.method === "PATCH");
  check("patch sends only the named fields", JSON.stringify(req.body) === JSON.stringify({ name: "renamed" }));
}

{
  const req = await captureRequest((c) =>
    c.admin.patchInstanceMetadata("i", {
      agentSurfaces: [AgentSurface.CLAUDE_CODE, AgentSurface.CODEX],
      agentDefaultBindingTier: BindingTier.AUTOLOAD,
      agentEngagementHints: ["a convention is learned or corrected"],
    }),
  );
  check(
    "patch serializes the agent hints as wire strings",
    JSON.stringify(req.body) ===
      JSON.stringify({
        agent_surfaces: ["claude_code", "codex"],
        agent_default_binding_tier: "autoload",
        agent_engagement_hints: ["a convention is learned or corrected"],
      }),
  );
}

{
  // A server newer than this release can be driven without waiting for a constant.
  const req = await captureRequest((c) =>
    c.admin.patchInstanceMetadata("i", { agentSurfaces: ["some_future_surface"] }),
  );
  check(
    "patch accepts plain strings for the hints",
    JSON.stringify(req.body) === JSON.stringify({ agent_surfaces: ["some_future_surface"] }),
  );
}

{
  // Omit-vs-clear is the whole contract: an explicit null must reach the wire.
  const req = await captureRequest((c) =>
    c.admin.patchInstanceMetadata("i", { agentOwnerInstructions: null, agentSurfaces: null }),
  );
  check(
    "patch clears fields with an explicit null",
    JSON.stringify(req.body) === JSON.stringify({ agent_surfaces: null, agent_owner_instructions: null }),
  );
}

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 200,
    body: {
      items: [
        {
          ...INSTANCE_ITEM,
          agent_surfaces: ["claude_code"],
          agent_default_binding_tier: "autoload",
          agent_engagement_hints: ["a convention is learned"],
          agent_owner_instructions: "Prefer updating an existing record.",
          agent_owner_instructions_epoch: 4,
        },
      ],
    },
  }));
  const info = await new XmemoryClient({ url: "http://localhost:1", apiKey: "t" }).admin.getInstance("i");
  globalThis.fetch = origFetch;

  check("InstanceInfo reads agent_surfaces", JSON.stringify(info.agent_surfaces) === JSON.stringify(["claude_code"]));
  check("InstanceInfo reads the binding tier", info.agent_default_binding_tier === "autoload");
  check(
    "InstanceInfo reads the engagement hints",
    JSON.stringify(info.agent_engagement_hints) === JSON.stringify(["a convention is learned"]),
  );
  check("InstanceInfo reads the owner instructions", info.agent_owner_instructions === "Prefer updating an existing record.");
  check("InstanceInfo reads the epoch", info.agent_owner_instructions_epoch === 4);
}

// ---------------------------------------------------------------------------
// Test: describe surfaces the owner-settable fields
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 200,
    body: {
      items: [
        {
          instance_id: "i",
          instance_name: "Team Knowledge",
          about: "xmemory is a first-party memory store.",
          schema_summary: "DevConvention(slug, rule)",
          tools: [],
          purpose: "shared dev conventions",
          owner_instructions: "Prefer updating an existing record over creating a near-duplicate.",
          usage_brief: "Read at session start; write when a convention changes.",
        },
      ],
    },
  }));

  const result = await new XmemoryClient({ url: "http://localhost:1", apiKey: "t" }).instance("i").describe();
  globalThis.fetch = origFetch;

  check("describe: purpose", result.purpose === "shared dev conventions");
  check("describe: ownerInstructions", result.ownerInstructions === "Prefer updating an existing record over creating a near-duplicate.");
  check("describe: usageBrief", result.usageBrief === "Read at session start; write when a convention changes.");

  const text = result.asText();
  check("asText includes the purpose", text.includes("shared dev conventions"));
  check("asText includes the standing preference", text.includes("Prefer updating an existing record over creating a near-duplicate."));
  // Left out on purpose: it restates the schema summary that is already there.
  check("asText omits the usage brief", !text.includes("Read at session start"));
  // The standing preference comes before the schema, so a long schema cannot bury it.
  check(
    "asText puts the standing preference before the schema",
    text.indexOf("Prefer updating an existing record") < text.indexOf("DevConvention"),
  );
  // Both are labelled by provenance. Asserting an author would claim something no
  // response can verify — anyone with edit permission on the instance sets these.
  check("asText labels the purpose by provenance", text.includes("set by someone with edit access to this memory"));
  check(
    "asText labels the standing preference by provenance",
    text.includes("not an instruction from xmemory or from the person you are talking to now"),
  );
  check("asText claims no authorship", !text.includes("owner"));
}

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => ({
    status: 200,
    body: { items: [{ instance_id: "i", instance_name: "n", schema_summary: "", tools: [] }] },
  }));

  const result = await new XmemoryClient({ url: "http://localhost:1", apiKey: "t" }).instance("i").describe();
  globalThis.fetch = origFetch;

  check("describe: purpose defaults to null", result.purpose === null);
  check("describe: ownerInstructions defaults to null", result.ownerInstructions === null);
  check("describe: usageBrief defaults to null", result.usageBrief === null);
  check("asText renders no empty purpose heading", !result.asText().includes("Purpose"));
  check("asText renders no empty provenance label", !result.asText().includes("edit access"));
}


// ---------------------------------------------------------------------------
// Test: connect instructions — the query, the parse, and what survives a newer server
// ---------------------------------------------------------------------------

{
  let capturedUrl = "";
  // A server older than the `format` parameter omits the field entirely rather than
  // echoing a value. Toggled so the omission is actually exercised: a mock that always
  // echoes "agent" makes the assertion below pass without the client doing anything.
  let echoFormat = true;
  let echoProject = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((url) => {
    capturedUrl = url;
    if (url.endsWith("/healthz")) return { status: 200, body: {} };
    return {
      status: 200,
      body: {
        items: [
          {
            instance_id: "i1",
            instance_name: "Sprint tracker",
            install_page_url: "https://xmemory.ai/install",
            // A surface this release has never heard of, plus a field from a newer
            // server: neither may break the parse, or an additive server change
            // becomes a breaking client change.
            surfaces: [
              {
                surface: "some_future_client",
                label: "Future",
                steps: [{ description: "Install it.", command: "x install", kind: "shell" }],
                human_steps: ["Approve each command when the agent asks to run it."],
              },
            ],
            paste_to_agent: "Connect xmemory instance i1",
            ...(echoProject
              ? {
                  format: "project",
                  project: {
                    fragments: [
                      { path: ".mcp.json", purpose: "point the team at it", merge: "merge_json", content: "{}" },
                    ],
                    manual_steps: ["Each teammate signs in once."],
                  },
                }
              : echoFormat
                ? { format: "agent" }
                : {}),
            unknown_field_from_a_newer_server: true,
          },
        ],
      },
    };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });

  const setup = await c.admin.getSetupInstructions("i1");
  check("setup: asks for the agent format by default", capturedUrl.includes("format=agent"));
  check("setup: parses the payload", setup.instance_name === "Sprint tracker");
  check("setup: unknown surface survives", setup.surfaces[0]!.surface === "some_future_client");
  check("setup: step kind is readable", setup.surfaces[0]!.steps[0]!.kind === StepKind.SHELL);
  // Consent, not decoration: a caller that drops these hides what a person must do.
  check("setup: human steps are carried", setup.surfaces[0]!.human_steps.length === 1);

  // An honoured project response, so the PROJECT contract is bound rather than only the
  // query string: a server could receive the parameter and still return the agent shape.
  echoProject = true;
  const project = await c.admin.getSetupInstructions("i1", { format: SetupFormat.PROJECT });
  check("setup: project format reaches the query", capturedUrl.includes("format=project"));
  check("setup: honoured project reports its format", project.format === SetupFormat.PROJECT);
  check("setup: project carries fragments", project.project?.fragments.length === 1);
  check("setup: fragment merge is readable", project.project?.fragments[0]!.merge === FragmentMerge.MERGE_JSON);
  check("setup: fragment names its path", project.project?.fragments[0]!.path === ".mcp.json");
  // Not a leftover: a surface with no committable channel is not one that was forgotten.
  check("setup: project carries manual steps", (project.project?.manual_steps.length ?? 0) === 1);
  echoProject = false;

  // A server older than the parameter ignores it, answers 200, and names no format.
  // `undefined` is therefore the signal "this server predates the project rendering" —
  // which is exactly what a caller needs, and why the field is optional rather than
  // defaulted to AGENT. Note this diverges from the Python client, whose model applies
  // the AGENT default; there is no runtime normalization point here, and inventing one
  // would report a format the server never claimed.
  echoFormat = false;
  const stale = await c.admin.getSetupInstructions("i1", { format: SetupFormat.PROJECT });
  check("setup: an older server names no format", stale.format === undefined);
  check("setup: and offers no project payload", stale.project == null);
  echoFormat = true;

  // Advisory values a newer server may send. There is no runtime validation here, so
  // what this pins is that the *types* admit them: the Python client rejected the whole
  // payload over exactly this before review caught it.
  const unknownKind: StepKindValue | (string & {}) | null | undefined =
    setup.surfaces[0]!.steps[0]!.kind;
  check("setup: an unknown kind is still typed", unknownKind === StepKind.SHELL);

  const viaHandle = await c.instance("i1").setupInstructions();
  check("setup: reachable from an instance handle", viaHandle.instance_id === "i1");

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: scoped writes — the WriteScope wire shape, both identity forms
// ---------------------------------------------------------------------------

{
  let capturedBody: Record<string, unknown> = {};

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((_url, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return { status: 200, body: { items: [{ write_id: "w1", trace_id: "t1" }] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  const inst = c.instance("test-inst");

  await inst.write("After her promotion she is a surgeon.", {
    scope: { objects: [{ type: "Person", key: { name: "Alice Johnson" } }] },
  });
  check(
    "scoped write: primary-key identity nests as key.key",
    JSON.stringify(capturedBody["scope"]) ===
      JSON.stringify({ objects: [{ type: "Person", key: { key: { name: "Alice Johnson" } } }] }),
  );
  // WriteScope carries no relation policy: the relations among the scoped
  // objects always accompany the extraction hint.
  check(
    "scoped write: no relations_scope key",
    !("relations_scope" in (capturedBody["scope"] as Record<string, unknown>)),
  );

  await inst.writeAsync("She moved to the London office.", {
    scope: { objects: [{ type: "Person", key: { name: "Bob Lee" } }] },
  });
  check(
    "scoped writeAsync: primary-key identity nests as key.key",
    JSON.stringify(capturedBody["scope"]) ===
      JSON.stringify({ objects: [{ type: "Person", key: { key: { name: "Bob Lee" } } }] }),
  );

  await inst.write("Bob is an engineer.");
  check("unscoped write: no scope wire key", !("scope" in capturedBody));

  // Reads and writes share one serializer, so the identity shape cannot drift.
  await inst.read("What does she do?", {
    scope: { objects: [{ type: "Person", key: { name: "Alice Johnson" } }] },
  });
  check(
    "scoped read: primary-key identity nests as key.key",
    JSON.stringify((capturedBody["scope"] as Record<string, unknown>)["objects"]) ===
      JSON.stringify([{ type: "Person", key: { key: { name: "Alice Johnson" } } }]),
  );

  // The overload types keep `scope` off the mutations form; this pins the
  // runtime guard for a caller who reached the implementation signature anyway.
  let structuredThrew = false;
  try {
    await (inst.write as (i: unknown, o: unknown) => Promise<unknown>)(
      [{ object_mutation: { object_type: "person", delete: { key: { name: "Alice" } } } }],
      { scope: { objects: [{ type: "Person", key: { name: "Alice" } }] } },
    );
  } catch {
    structuredThrew = true;
  }
  check("scope with structured mutations throws", structuredThrew);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Request URLs are composed from the configured base

{
  // Concatenation put the API path inside the query of a base that carried one,
  // and a plain `new URL(path, base)` drops a base path prefix. Both shapes are
  // real: a gateway mounts the API under a prefix, a tenant router uses a query.
  const cases: [string, string][] = [
    ["https://api.example.com", "https://api.example.com/instances/inst-1/read"],
    ["https://api.example.com/", "https://api.example.com/instances/inst-1/read"],
    ["https://gw.example.com/xmemory", "https://gw.example.com/xmemory/instances/inst-1/read"],
    ["https://api.example.com?tenant=acme", "https://api.example.com/instances/inst-1/read?tenant=acme"],
  ];
  for (const [base, expected] of cases) {
    const req = await captureRequest(
      (c) => c.instance("inst-1").read("q"),
      { reader_result: "x", reader_results: [] },
      base,
    );
    check(`request url for base ${base}`, req.url === expected);
  }

  // Request parameters join whatever the base already carries, rather than
  // appending a second `?`.
  const withParams = await captureRequest(
    (c) => c.admin.listInstances({ ids: ["a", "b"] }),
    INSTANCE_ITEM,
    "https://api.example.com?tenant=acme",
  );
  const parsed = new URL(withParams.url);
  check("base query survives request params", parsed.searchParams.get("tenant") === "acme");
  check("request params are added", parsed.searchParams.getAll("ids").join(",") === "a,b");
  check("no second question mark", withParams.url.split("?").length === 2);
}

// Test: every outbound request carries the client header, merged with
// whatever headers the caller already built rather than replacing them
// ---------------------------------------------------------------------------

// The API reads the client name from the token before the first "/" and the release from the three
// dot-separated numbers that follow it, each at most three digits. The whole value is matched, not
// just that prefix: a truncated or garbled tail passes a prefix check while carrying nothing the
// header claims to carry. This is deliberately stricter than what the API tolerates — it pins what
// this client emits, so a release whose version the API could not read a number out of (a
// prerelease suffix, say) fails here rather than going out unattributed.
const IDENTITY_SHAPE = /^xmemory-node\/\d{1,3}\.\d{1,3}\.\d{1,3} \(node [^\s;()]+; [^\s;()]+\)$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

function checkClientHeader(label: string, identity: string | undefined): void {
  check(`client header: ${label} — whole value is in the shape the API parses`, IDENTITY_SHAPE.test(identity ?? ""));
  check(`client header: ${label} — carries the package version`, (identity ?? "").startsWith(`xmemory-node/${VERSION} `));
  check(`client header: ${label} — printable ASCII only`, PRINTABLE_ASCII.test(identity ?? ""));
}

// ---------------------------------------------------------------------------
// Test: host details the header cannot safely carry are replaced, not interpolated
// ---------------------------------------------------------------------------

{
  const identity = (host: { version?: unknown; platform?: unknown } | undefined) => buildClientIdentity(VERSION, host);
  const real = { version: "v24.5.0", platform: "darwin" };

  check("client header: real host details are carried through", identity(real) === `xmemory-node/${VERSION} (node v24.5.0; darwin)`);
  // Passed a version other than this package's, so a hardcoded literal in the builder shows up.
  check("client header: the version it is given is the version it reports", buildClientIdentity("9.8.7", real) === "xmemory-node/9.8.7 (node v24.5.0; darwin)");
  for (const version of ["v24.5.0", "v24.5.0-rc.1", "v25.0.0-nightly202601011234567890"]) {
    check(`client header: the real version shape "${version}" is carried, not replaced`, identity({ version, platform: "linux" }).includes(`(node ${version}; linux)`));
  }
  for (const platform of ["aix", "android", "darwin", "freebsd", "linux", "openbsd", "sunos", "win32"]) {
    check(`client header: the real platform "${platform}" is carried, not replaced`, identity({ version: "v24.5.0", platform }).endsWith(`; ${platform})`));
  }
  check("client header: absent host falls back", identity(undefined) === `xmemory-node/${VERSION} (node unknown; unknown)`);
  check("client header: partial host falls back", identity({}) === `xmemory-node/${VERSION} (node unknown; unknown)`);
  for (const [label, bad] of [
    ["empty string", ""],
    ["non-string", 24],
    ["non-ASCII", "dárwin"],
    ["embedded newline", "darwin\nX: y"],
    ["embedded space", "dar win"],
    ["embedded semicolon", "dar;win"],
    ["embedded closing parenthesis", "dar)win"],
    ["embedded opening parenthesis", "dar(win"],
    ["far too long to belong in a header", "d".repeat(300)],
  ] as [string, unknown][]) {
    const value = identity({ version: bad, platform: bad });
    check(`client header: ${label} host detail is replaced`, value === `xmemory-node/${VERSION} (node unknown; unknown)`);
    check(`client header: ${label} still yields a parsable header`, IDENTITY_SHAPE.test(value));
  }
}

{
  let capturedHeaders: Record<string, string> = {};
  let capturedSignal: AbortSignal | null | undefined;

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((_url, init) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    capturedSignal = init?.signal;
    return { status: 200, body: { items: [{ id: "1" }] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  await c.admin.listClusters();
  checkClientHeader("on a _request()-routed call", capturedHeaders[CLIENT_HEADER]);
  // Recomputed from this process rather than compared against the module's own constant, so a
  // client built from the wrong host object — reporting "unknown" on a host that has the details —
  // shows up here instead of passing the shape checks above.
  check(
    "client header: reports this host's details",
    capturedHeaders[CLIENT_HEADER] === buildClientIdentity(VERSION, process),
  );
  check("client header: the request carries an abort signal", capturedSignal instanceof AbortSignal);
  check("client header: Authorization survives the merge", capturedHeaders["Authorization"] === "Bearer t");
  check("client header: Accept survives the merge", capturedHeaders["Accept"] === "application/json");

  // A write carries a body and a method other than GET, and takes a different branch through the
  // request builder, so it is covered separately rather than assumed from the read above.
  capturedHeaders = {};
  await c.instance("inst-1").write("hello");
  checkClientHeader("on a body-bearing write", capturedHeaders[CLIENT_HEADER]);
  check("client header: Authorization survives on a write", capturedHeaders["Authorization"] === "Bearer t");
  check("client header: Content-Type survives on a write", capturedHeaders["Content-Type"] === "application/json");

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: that abort signal is the one that enforces the request timeout
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  // Settles only when the signal aborts, so the timeout is what ends the request.
  globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof globalThis.fetch;

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t", timeoutMs: 5 });
  // Raced against a bound, so a timeout that never fires reports a failed check rather than hanging.
  // The bound is cleared on the way out, so the suite does not sit waiting for a timer it no longer
  // needs once the request has already ended.
  let bound: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    c.admin.listClusters().then(
      () => false,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      bound = setTimeout(() => resolve(false), 500);
    }),
  ]);
  clearTimeout(bound);
  check("the abort signal ends a request that outlives its timeout", timedOut);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: the header merge keeps what the caller built and adds the client header
// ---------------------------------------------------------------------------

{
  const caller = { Authorization: "Bearer t", Accept: "application/json" };
  const before = JSON.stringify(caller);
  const merged = withClientHeader(caller);
  check("merge: Authorization is kept", merged["Authorization"] === "Bearer t");
  check("merge: Accept is kept", merged["Accept"] === "application/json");
  check("merge: the client header is added", IDENTITY_SHAPE.test(merged[CLIENT_HEADER] ?? ""));
  // Compared whole, not one key: a merge that scribbled any other key on the caller would pass
  // a check that only looked for the client header.
  check("merge: the caller's own object is left alone", JSON.stringify(caller) === before);
  check("merge: no headers at all still yields the client header", IDENTITY_SHAPE.test(withClientHeader(undefined)[CLIENT_HEADER] ?? ""));
  const empty: Record<string, string> = {};
  withClientHeader(empty);
  check("merge: an empty caller object is left alone too", Object.keys(empty).length === 0);

  // A User-Agent on the way in is carried through untouched: this client does not claim that field,
  // so whatever the runtime or the caller put there is what goes out.
  const withUa = withClientHeader({ "User-Agent": "someone-else/1.0" });
  check("merge: a caller's User-Agent is carried through unchanged", withUa["User-Agent"] === "someone-else/1.0");
  check("merge: and the client header is still added alongside it", IDENTITY_SHAPE.test(withUa[CLIENT_HEADER] ?? ""));

  // An incoming spelling of our own header is dropped, whatever its case. Two keys differing only in
  // case are one field on the wire, and fetch joins them into "first, second" — whose leading token is
  // what the API reads, so a surviving duplicate would let the other value name the client.
  for (const spelling of ["X-Xmemory-Client", "x-xmemory-client", "X-XMEMORY-CLIENT", "x-Xmemory-client"]) {
    const out = withClientHeader({ [spelling]: "someone-else/1.0", Accept: "application/json" });
    const names = Object.keys(out).filter((n) => n.toLowerCase() === CLIENT_HEADER.toLowerCase());
    check(`merge: "${spelling}" leaves exactly one client header`, names.length === 1);
    check(`merge: "${spelling}" from a caller does not win`, IDENTITY_SHAPE.test(out[CLIENT_HEADER] ?? ""));
    check(`merge: "${spelling}" does not disturb other headers`, out["Accept"] === "application/json");
  }
}

// ---------------------------------------------------------------------------
// Test: checkHealth() never calls _headers() but still carries the client header
// ---------------------------------------------------------------------------

{
  let capturedHeaders: Record<string, string> = {};

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((_url, init) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    return { status: 200, body: {} };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", apiKey: "t" });
  await c.checkHealth();
  checkClientHeader("on checkHealth()", capturedHeaders[CLIENT_HEADER]);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: create() health-checks before it hands back a client, so the first
// request an application makes already identifies itself
// ---------------------------------------------------------------------------

{
  const seen: { url: string; identity: string | undefined }[] = [];

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch((url, init) => {
    seen.push({ url, identity: ((init?.headers ?? {}) as Record<string, string>)[CLIENT_HEADER] });
    return { status: 200, body: {} };
  });

  await XmemoryClient.create({ url: "http://localhost:1", apiKey: "t" });
  check("create(): health-checks before returning", seen.length === 1 && seen[0]!.url.endsWith("/healthz"));
  checkClientHeader("on the create() health check", seen[0]?.identity);

  globalThis.fetch = origFetch;
}

// ---------------------------------------------------------------------------
// Test: the header name is what the API reads, asserted as a literal
// ---------------------------------------------------------------------------

{
  // Compared against the string itself, not against CLIENT_HEADER, which every other check in this
  // file uses to look the header up. The API names this header in its own source and this package
  // cannot import it, so the two agree only by both being right; a rename here would move all those
  // other checks with it and leave the suite green while this SDK's calls were filed as generic
  // undici traffic — permanently, because an analytics value cannot be reclassified once emitted.
  check("the client header name is pinned to its literal", CLIENT_HEADER === "X-Xmemory-Client");
}

// ---------------------------------------------------------------------------
// Test: the exported VERSION constant stays in sync with package.json and
// with both version fields the lockfile carries
// ---------------------------------------------------------------------------

{
  // Resolved against this file rather than the process cwd, so the checks report a named failure
  // instead of an ENOENT crash when the suite is started from somewhere other than the package root.
  const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf-8"));

  const pkg = read("package.json") as { version: string };
  check("VERSION matches package.json", pkg.version === VERSION);

  const lock = read("package-lock.json") as {
    version?: string;
    packages?: Record<string, { version?: string } | undefined>;
  };
  check("package-lock.json top-level version matches", lock.version === VERSION);
  check("package-lock.json root package version matches", lock.packages?.[""]?.version === VERSION);

  // The fourth thing this repo requires to move together with a release.
  const changelog = readFileSync(new URL("./CHANGELOG.md", import.meta.url), "utf-8");
  // Split on either line ending, so a checkout that uses CRLF does not fail this on punctuation.
  const heading = changelog.split(/\r?\n/).find((line) => line.startsWith("## "));
  check("CHANGELOG.md leads with this version", heading === `## ${VERSION}`);
}

// ---------------------------------------------------------------------------
// Test: the package exposes its entry point and nothing else
// ---------------------------------------------------------------------------

{
  // Without an exports map every compiled module is deep-importable, which silently publishes
  // internals - the identity builders among them - as API a later release cannot take back.
  // This asserts the map still names exactly the two paths meant to be reachable, so dropping it,
  // or widening it with a "./*" entry, fails here rather than at the next publish.
  const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf-8"));
  const pkg = read("package.json") as { exports?: Record<string, unknown> };
  const paths = Object.keys(pkg.exports ?? {}).sort();

  check("package.json declares an exports map", pkg.exports !== undefined);
  check("exports map exposes only the entry point and package.json", paths.join(",") === ".,./package.json");

  // Dual build: "import" must land on ESM and "require" on CommonJS, never crossed - a consumer
  // that require()s an ESM file gets ERR_REQUIRE_ESM at runtime, which no type-check would catch.
  const entry = (pkg.exports?.["."] ?? {}) as Record<string, Record<string, string>>;
  check("entry point serves both module systems", Object.keys(entry).sort().join(",") === "import,require");
  check("import resolves to the ESM build", entry.import?.default === "./dist/esm/index.js");
  check("require resolves to the CommonJS build", entry.require?.default === "./dist/cjs/index.js");
  // Ahead of "default" in each condition, or a consumer on "moduleResolution": "bundler" gets no types.
  for (const condition of ["import", "require"]) {
    check(`${condition} declares its types first`, Object.keys(entry[condition] ?? {})[0] === "types");
  }
}

// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error("FAIL:", errors.join(", "));
  process.exit(1);
} else {
  console.log("OK: all checks passed");
}
