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
  apiKey: "<your-api-key>",       // or set XMEM_API_KEY env var
});

// Write and read from an existing instance
const inst = xm.instance("<your-instance-id>");

await inst.write("Alice is a software engineer who loves TypeScript.");
const result = await inst.read("What does Alice do?");
console.log(result.reader_result);
```

## Configuration

| Parameter   | Env var          | Default                   | Description                             |
|-------------|------------------|---------------------------|-----------------------------------------|
| `url`       | `XMEM_API_URL`   | `https://api.xmemory.ai`  | Base URL of the Xmemory API             |
| `apiKey`    | `XMEM_API_KEY`   | `undefined`               | Bearer API key for authentication       |
| `timeoutMs` | —                | `60000`                   | Default request timeout in milliseconds |

The legacy `token` option and `XMEM_AUTH_TOKEN` env var are still accepted for backwards compatibility but are deprecated and will be removed in a future release. Using them prints a deprecation warning. If both the new and legacy values are set, the new ones win.

## Creating a client

```typescript
import { XmemoryClient, xmemoryInstance } from "xmemory";

// Option 1: constructor (no health check)
const xm1 = new XmemoryClient({ apiKey: "..." });

// Option 2: factory with health check
const xm2 = await XmemoryClient.create({ apiKey: "..." });

// Option 3: convenience function (same as Option 2)
const xm3 = await xmemoryInstance({ apiKey: "..." });
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
console.log(result.changes); // what the write created / updated / removed
```

Options: `{ extractionLogic?, diffEngine?, timeoutMs? }` — `extractionLogic` defaults to `"fast"`.

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

Options: `{ readMode?, scope?, traceId?, timeoutMs? }` — `readMode` defaults to `"single-answer"`.

#### Scoped reads

By default a read may draw on the whole instance. Pass a `scope` to restrict it
to a set of concrete objects — useful for grounding an answer in exactly the
records you care about, or for keeping a per-user / per-entity read from leaking
into unrelated data.

Each object in the scope is identified by its `type` (the PascalCase class name
or snake_case table name) plus its user-defined primary `key` (a mapping of
primary-key field name to value):

```typescript
const result = await inst.read("What do we know about these people?", {
  scope: {
    objects: [
      { type: "Person", key: { full_name: "Alice Smith" } },
      { type: "Person", key: { full_name: "Bob Jones" } },
    ],
    relationsScope: "all_relations", // default: "no_relations"
  },
});
```

`relationsScope` controls relation traversal: `"no_relations"` (the default)
restricts the read to the listed objects only, while `"all_relations"` also
exposes the relations among the in-scope objects.

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

### `inst.describe(options?)` → `DescribeResult`

Get agent-facing tool descriptions enriched with the instance's schema.

```typescript
const desc = await inst.describe();
console.log(desc.asText());              // plain text for system prompts
const tools = desc.asAnthropicTools();   // Anthropic tool-use format
const tools = desc.asOpenaiTools();      // OpenAI function-calling format
```

Results are cached for 5 minutes. Call `inst.clearDescribeCache()` to force a refresh.

## Schema evolution

Schemas can change after creation. xmemory supports **safe, data-preserving
migrations** (rename / remove / type change) driven by structured migration
ops, plus a **suggestion engine** that proposes improvements from real read
traffic. This is purely additive — existing methods are unchanged.

See the [Schema evolution section of the API reference](https://xmemory.ai/api/#schema-evolution)
for the conceptual model, and the [TypeScript guide](https://xmemory.ai/typescript/)
for full walkthroughs.

### Suggestion-engine flow (review → decide → apply)

The engine surfaces a single rolling proposal per instance. The minimum flow is
three calls — review, decide (in bulk), apply:

```typescript
import { XmemoryClient, type DecisionInput } from "xmemory";

const xm = new XmemoryClient({ apiKey: "..." });
const inst = xm.instance("<instance-id>");

// 1. Review — get the proposal + its concurrency token.
const review = await inst.reviewSuggestions();
if (review.status === "evolution_in_progress") {
  console.log(`A migration is in flight; retry in ${review.retry_after_seconds}s`);
} else if (review.proposal) {
  const proposal = review.proposal;
  for (const item of proposal.items) {
    console.log(item.item_fingerprint, item.rationale, item.op);
  }

  // 2. Decide — accept / reject / defer per item, in one batch.
  const decisions: DecisionInput[] = proposal.items.map((item) => ({
    item_fingerprint: item.item_fingerprint,
    decision: "accept",
  }));
  const decided = await inst.decideSuggestions(proposal.proposal_version, decisions);

  // 3. Apply — commit accepted decisions as one migration.
  const applied = await inst.applyPendingDecisions(decided.next_proposal_version);
  console.log(applied.status, applied.summary); // e.g. "ok" "added 1 field"
}
```

When `status === "evolution_in_progress"`, back off for `retry_after_seconds`
and retry instead of blocking.

### Direct migration flow (enhance → dry-run → update)

Drive a migration yourself — ask the server to *enhance* the current schema,
preview the DDL, then apply it:

```typescript
import { XmemoryClient, SchemaType } from "xmemory";
import yaml from "js-yaml";

const xm = new XmemoryClient({ apiKey: "..." });
const current = (await xm.admin.getInstanceSchema("<instance-id>")).data_schema;

// 1. Enhance — new schema + an executor-ready migration plan.
const enhanced = await xm.admin.enhanceSchema(
  "<cluster-id>",
  "Rename Person.mail to Person.email.",
  yaml.dump(current),
);
console.log(enhanced.summary, enhanced.migration_plan?.ops);

const newYaml = yaml.dump(enhanced.data_schema);

// 2. Dry-run — preview the DDL without applying anything.
const preview = await xm.admin.dryRunMigration("<instance-id>", newYaml, SchemaType.YML, {
  migrationPlan: enhanced.migration_plan ?? undefined,
});
console.log(preview.statements);

// 3. Update — apply. confirmDestructive is required for ops that drop data.
const info = await xm.admin.updateInstanceSchema("<instance-id>", newYaml, SchemaType.YML, {
  migrationPlan: enhanced.migration_plan ?? undefined,
  confirmDestructive: false,
});
console.log(info.migration_id, info.prior_version, "->", info.new_version);
```

### Migration history

```typescript
const page = await xm.admin.listMigrations("<instance-id>", { limit: 20 });
for (const record of page.items) {
  console.log(record.id, record.source, record.prior_version, "->", record.new_version);
}

const detail = await xm.admin.getMigration("<instance-id>", "<migration-id>", { includeYaml: true });
console.log(detail.yaml_before, detail.yaml_after);
```

Migration ops are exported as discriminated-union types (`MigrationPlan`,
`MigrationOp`, `AddField`, `RenameField`, `RemoveObject`, …) keyed on `op_type`.
`ProposalItem.op` and `MigrationRecord.ops` are raw dicts for forward
compatibility — narrow them to `MigrationOp` when needed.

Runnable end-to-end examples live in [`examples/`](examples/).

## Error handling

All errors throw `XmemoryAPIError`. Health check failures throw `XmemoryHealthCheckError` (a subclass).

```typescript
import { XmemoryClient, XmemoryAPIError, XmemoryHealthCheckError } from "xmemory";

try {
  const xm = await XmemoryClient.create({ apiKey: "..." });
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

`XmemoryAPIError` carries `status` (HTTP status), `code` (structured error code,
when the server returned one), and `details`. The schema-evolution endpoints
return codes you can pattern match on via `.code` — for example
`stale_proposal_version`, `dependency_closure_failed`,
`destructive_confirmation_required`, `non_additive_change_requires_plan`,
`stale_schema_version`, `migration_not_found`, `instance_not_initialised`:

```typescript
try {
  await inst.applyPendingDecisions(token);
} catch (e) {
  if (e instanceof XmemoryAPIError && e.code === "stale_proposal_version") {
    const review = await inst.reviewSuggestions(); // re-review and retry
  }
}
```

## All timeouts are per-request

Every method accepts an optional `timeoutMs` in its options bag, overriding the client default.

```typescript
const result = await inst.read("query", { timeoutMs: 120_000 });
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
