# xmemory

TypeScript/JavaScript client library for the [Xmemory](https://xmemory.ai) API.

## Installation

```bash
npm install xmemory
```

## Quick start

```typescript
import { XmemoryClient } from "xmemory";

const xm = new XmemoryClient({
  url: "https://api.xmemory.ai",  // or set XMEM_API_URL env var
  token: "<your-token>",          // or set XMEM_AUTH_TOKEN env var
});

// Write and read from an existing instance
const inst = xm.instance("<your-instance-id>");

await inst.write("Alice is a software engineer who loves TypeScript.");
const result = await inst.read("What does Alice do?");
console.log(result.reader_result);
```

## Configuration

| Parameter   | Env var           | Default                    | Description                            |
|-------------|-------------------|----------------------------|----------------------------------------|
| `url`       | `XMEM_API_URL`    | `https://api.xmemory.ai`  | Base URL of the Xmemory API            |
| `token`     | `XMEM_AUTH_TOKEN` | `undefined`                | Bearer token for authentication        |
| `timeoutMs` | —                 | `60000`                    | Default request timeout in milliseconds |

## Creating a client

```typescript
import { XmemoryClient, xmemoryInstance } from "xmemory";

// Option 1: constructor (no health check)
const xm1 = new XmemoryClient({ token: "..." });

// Option 2: factory with health check
const xm2 = await XmemoryClient.create({ token: "..." });

// Option 3: convenience function (same as Option 2)
const xm3 = await xmemoryInstance({ token: "..." });
```

## Admin operations

All cluster and instance management lives under `client.admin`.

### Clusters

```typescript
const clusters = await xm.admin.listClusters();
const cluster = await xm.admin.getCluster(clusterId);
```

### Create an instance

```typescript
import { SchemaType } from "xmemory";

const inst = await xm.admin.createInstance(
  clusterId,
  "my-instance",
  schemaYml,
  SchemaType.YML,
  { description: "User profiles" },
);

// inst is an InstanceHandle — use it directly for data operations
await inst.write("Alice joined the team.");
```

### List and get instances

```typescript
const instances = await xm.admin.listInstances();
const info = await xm.admin.getInstance(instanceId);
```

### Schema operations

```typescript
const schema = await xm.admin.getInstanceSchema(instanceId);
await xm.admin.updateInstanceSchema(instanceId, newYml, SchemaType.YML);
```

### Generate schema

```typescript
const result = await xm.admin.generateSchema(clusterId, "Track user profiles and preferences");
console.log(result.data_schema);
```

### Update metadata and delete

```typescript
await xm.admin.updateInstanceMetadata(instanceId, "new-name", "new description");
const deletedIds = await xm.admin.deleteInstance(instanceId);
```

## Instance data operations

Get a handle to an instance and use it for reads, writes, and extractions.

```typescript
const inst = xm.instance("<instance-id>");
```

### `inst.write(text, options?)` → `WriteResult`

Extract and store structured objects from text.

```typescript
const result = await inst.write("Bob is a designer based in Berlin.");
console.log(result.write_id, result.trace_id);
```

Options: `{ extractionLogic?, diffEngine?, timeoutMs? }` — `extractionLogic` defaults to `"deep"`.

### `inst.writeAsync(text, options?)` → `AsyncWriteResult`

Start an asynchronous write. Returns a `write_id` for tracking.

```typescript
const { write_id } = await inst.writeAsync("Carol manages the London office.");
```

### `inst.writeStatus(writeId, options?)` → `WriteStatusResult`

Poll the status of an async write.

```typescript
const status = await inst.writeStatus(write_id);
console.log(status.write_status); // "queued" | "processing" | "completed" | "failed" | "not_found"
```

### `inst.read(query, options?)` → `ReadResult`

Query the instance.

```typescript
const result = await inst.read("Who is on the team?");
console.log(result.reader_result);
```

Options: `{ readMode?, readId?, timeoutMs? }` — `readMode` defaults to `"single-answer"`.

### `inst.extract(text, options?)` → `ExtractResult`

Extract objects from text without storing them.

```typescript
const result = await inst.extract("Dave is an engineer in Tokyo.");
console.log(result.objects_extracted);
```

### `inst.getSchema(options?)` → `InstanceSchemaInfo`

```typescript
const schema = await inst.getSchema();
console.log(schema.data_schema);
```

## Error handling

All errors throw `XmemoryAPIError`. Health check failures throw `XmemoryHealthCheckError` (a subclass).

```typescript
import { XmemoryClient, XmemoryAPIError, XmemoryHealthCheckError } from "xmemory";

try {
  const xm = await XmemoryClient.create({ token: "..." });
} catch (e) {
  if (e instanceof XmemoryHealthCheckError) {
    console.error("Server unreachable:", e.message);
  }
}

try {
  await inst.read("query");
} catch (e) {
  if (e instanceof XmemoryAPIError) {
    console.error(`API error (HTTP ${e.status}): ${e.message}`);
  }
}
```

## All timeouts are per-request

Every method accepts an optional `timeoutMs` in its options bag, overriding the client default.

```typescript
const result = await inst.read("query", { timeoutMs: 120_000 });
```
