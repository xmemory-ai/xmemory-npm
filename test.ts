import {
  XmemoryClient,
  XmemoryAPIError,
  XmemoryHealthCheckError,
  InstanceHandle,
  xmemoryInstance,
  SchemaType,
} from "./src/index.js";

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
const client = new XmemoryClient({ url: "http://localhost:9999", token: "test" });
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

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }): FetchFn {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
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

  const c = new XmemoryClient({ url: "http://localhost:1", token: "t" });

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

  const c = new XmemoryClient({ url: "http://localhost:1", token: "t" });
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
// Test: _requestOne throws when server returns zero items
// ---------------------------------------------------------------------------

{
  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(() => {
    return { status: 200, body: { items: [] } };
  });

  const c = new XmemoryClient({ url: "http://localhost:1", token: "t" });
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

  const c = new XmemoryClient({ url: "http://localhost:1", token: "t" });
  const result = await c.admin.getCluster("cluster-1");
  check("_requestOne returns item on exactly one", (result as any).id === "cluster-1");

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

  const c = new XmemoryClient({ url: "http://localhost:1", token: "t" });

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

  const c = new XmemoryClient({ url: "http://localhost:1", token: "t" });
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

if (errors.length > 0) {
  console.error("FAIL:", errors.join(", "));
  process.exit(1);
} else {
  console.log("OK: all checks passed");
}
