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

if (errors.length > 0) {
  console.error("FAIL:", errors.join(", "));
  process.exit(1);
} else {
  console.log("OK: all exports present and constructable");
}
