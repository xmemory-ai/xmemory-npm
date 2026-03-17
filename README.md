# xmemory

TypeScript/JavaScript client library for the [Xmemory](https://xmemory.ai) API.

## Quick start

```typescript
import { xmemoryInstance } from "xmemory";

const mem = await xmemoryInstance({
  url: "https://api.xmemory.ai",    // or set XMEM_API_URL env var
  token: "<your-token>",            // or set XMEM_AUTH_TOKEN env var
});

mem.instanceId = "<your-instance-id>";

await mem.write("Alice is a software engineer who loves TypeScript.");
const result = await mem.read("What does Alice do?");
console.log(result.reader_result?.answer);
```

## Installation

```bash
npm install xmemory
```

## Configuration

| Parameter   | Env var           | Default                   | Description                           |
|-------------|-------------------|---------------------------|---------------------------------------|
| `url`       | `XMEM_API_URL`    | `http://0.0.0.0:8000`    | Base URL of the Xmemory API           |
| `token`     | `XMEM_AUTH_TOKEN` | `undefined`               | Bearer token for authentication       |
| `timeoutMs` | —                 | `60000`                   | Default request timeout in milliseconds |

## Creating a client

```typescript
import { XmemoryClient, xmemoryInstance } from "xmemory";

// Option 1: factory function (runs a health check automatically)
const mem = await xmemoryInstance({ url: "https://api.xmemory.ai", token: "..." });

// Option 2: static create method (also runs a health check)
const mem = await XmemoryClient.create({ url: "https://api.xmemory.ai", token: "..." });

// Option 3: constructor (no health check)
const mem = new XmemoryClient({ url: "https://api.xmemory.ai", token: "..." });
```

## Methods

### `createInstance(schemaText, schemaType, timeoutMs?) → Promise<boolean>`

Create a new instance with the given schema. On success the new `instanceId`
is saved automatically and used for subsequent calls.

```typescript
import { SchemaType } from "xmemory";

const ok = await mem.createInstance(schemaYml, SchemaType.YML);
const ok = await mem.createInstance(schemaJson, SchemaType.JSON);
```

### `write(text, options?) → Promise<WriteResponse>`

Extract structured objects from `text` and store them in the instance.

```typescript
const resp = await mem.write("Bob joined the team on Monday as a designer.");
console.log(resp.status); // "ok" or "error"
```

Options: `{ timeoutMs?, extractionLogic? }` where `extractionLogic` is `"fast"`, `"regular"`, or `"deep"` (default: `"deep"`).

### `writeAsync(text, options?) → Promise<AsyncWriteResponse>`

Start an asynchronous write and return immediately with a `write_id` for tracking.

```typescript
const resp = await mem.writeAsync("Carol is a manager based in Berlin.", {
  extractionLogic: "deep",
});
console.log(resp.write_id); // use this to check status
```

Options: `{ timeoutMs?, extractionLogic?, extractWriteId? }`.

### `writeStatus(writeId, options?) → Promise<WriteStatusResponse>`

Check the status of an async write operation.

```typescript
const status = await mem.writeStatus(resp.write_id);
console.log(status.write_status); // "queued" | "processing" | "completed" | "failed" | "not_found"
```

### `read(query, options?) → Promise<ReadResponse>`

Query the instance and get a natural-language answer.

```typescript
const resp = await mem.read("Who is on the team?");
console.log(resp.reader_result?.answer);
```

Options: `{ timeoutMs? }`.

### `getSchema(instanceId?) → Promise<GetInstanceSchemaResponse>`

Fetch the YAML schema for an instance. Uses the current `instanceId` when no argument is given.

```typescript
const { schema_yaml } = await mem.getSchema();
console.log(schema_yaml);

// or for a specific instance without switching
const { schema_yaml } = await mem.getSchema("other-id");
```

## Error handling

All errors raise `XmemoryAPIError`.

```typescript
import { XmemoryAPIError, xmemoryInstance } from "xmemory";

const mem = await xmemoryInstance({ url: "https://api.xmemory.ai", token: "..." });

try {
  const resp = await mem.read("something");
} catch (e) {
  if (e instanceof XmemoryAPIError) {
    console.error(`API error (HTTP ${e.status}): ${e.message}`);
  }
}
```

---

## Mastra integration

You can also use `xmemory` as an MCP server within [Mastra.ai](https://mastra.ai).

First, create a local Mastra instance:

```
npm create mastra@latest mastra-with-xmemory
```

From within this example `mastra-with-xmemory` directory, first give it some LLM key:

```
echo "export ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY_FOR_MASTRA" >>.env
```

Then you may want to add MCP support to Mastra first, for its hot reload to pick up `xmemory` right away.

```
npm i @mastra/mcp
```

Then fire up the AI-assisted IDE of your choice and give it this prompt.

```
We need to integrate the `xmemory` MCP server with the Mastra instance running from this directory.

To do this we need to add the `xmemory` Agent, alongside the Weather Agent, and the `xmemory` MCP server to use the Tools from it.

The `xmemory` Agent setup is straightforward, just clone what the Weather Agent has, with `xmemory`-specific instructions. Use the following instructions:

~ ~ ~

> You are the xmemory assistant. You help users manage and query their xmemory instance:
> - Create and configure new instances, generate or enhance schemas, connect and disconnect from instances.
> - Use the xmemory_admin_* tools to perform administrative and schema operations as requested.
> - Be concise and confirm what you did after each action.

~ ~ ~

For the MCP server, you need to add `@mastra/mcp` into `package.json` if it's not already there.

And then make changes along these lines:

new file mode 100644
--- /dev/null
+++ b/src/mastra/mcp-clients.ts
@@ -0,0 +1,19 @@
+import { MCPClient } from '@mastra/mcp';
+
+if (!process.env.XMEM_MCP_BEARER_TOKEN) {
+  throw new Error('XMEM_MCP_BEARER_TOKEN environment variable is required');
+}
+
+export const xmemoryMcp = new MCPClient({
+  id: 'xmemory',
+  servers: {
+    xmemory: {
+      url: new URL('https://dk-mcp.xmemory.ai'),
+      requestInit: {
+        headers: {
+          Authorization: `Bearer ${process.env.XMEM_MCP_BEARER_TOKEN}`,
+        },
+      },
+    },
+  },
+});


new file mode 100644
--- /dev/null
+++ b/src/mastra/xmemory-tools.ts
@@ -0,0 +1,10 @@
+import { xmemoryMcp } from './mcp-clients';
+
+let xmemoryTools: Record<string, any> = {};
+try {
+  xmemoryTools = await xmemoryMcp.listTools();
+} catch (err) {
+  console.error('Failed to load xmemory MCP tools:', err);
+}
+
+export { xmemoryTools };

~ ~ ~

Commit the above as "Added `xmemory` to Mastra."
```
