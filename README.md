# `xmemory`

Integration code with `xmemory`.

For now just the Mastra prompt.

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
