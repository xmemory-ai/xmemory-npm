import { XmemoryClient, XmemoryAPIError, xmemoryInstance, SchemaType } from "./src/client.js";

const errors: string[] = [];

function check(name: string, value: unknown) {
  if (value === undefined || value === null) {
    errors.push(`${name} is ${value}`);
  }
}

check("XmemoryClient", XmemoryClient);
check("XmemoryAPIError", XmemoryAPIError);
check("xmemoryInstance", xmemoryInstance);
check("SchemaType", SchemaType);
check("SchemaType.YML", SchemaType.YML);
check("SchemaType.JSON", SchemaType.JSON);

// Verify XmemoryClient is constructable
const client = new XmemoryClient();
check("new XmemoryClient()", client);
check("client.instanceId", client.instance_id === null ? "null" : client.instance_id);

// Verify XmemoryAPIError is throwable
try {
  throw new XmemoryAPIError("test", 400);
} catch (e) {
  if (!(e instanceof XmemoryAPIError)) errors.push("XmemoryAPIError instanceof check failed");
}

if (errors.length > 0) {
  console.error("FAIL:", errors.join(", "));
  process.exit(1);
} else {
  console.log("OK: all exports present and constructable");
}
