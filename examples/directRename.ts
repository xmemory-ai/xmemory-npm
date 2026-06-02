/**
 * Direct migration flow: enhanceSchema → dryRunMigration → updateInstanceSchema.
 *
 * Drives a rename yourself instead of going through the suggestion engine. The
 * server emits a structured migration plan; you preview the DDL, then apply it.
 * A rename preserves data (unlike remove + add, which would drop the column).
 *
 * Requires `js-yaml` (npm i js-yaml @types/js-yaml). Run against a staging
 * instance:
 *
 *   export XMEM_API_KEY=xmem_...
 *   export XMEM_API_URL=https://api.stg.xmemory.ai   # optional; defaults to prod
 *   export XMEM_CLUSTER_ID=<cluster-id>
 *   export XMEM_INSTANCE_ID=<instance-id>
 *   npx tsx examples/directRename.ts
 */

import yaml from "js-yaml";

import { SchemaType, XmemoryAPIError, XmemoryClient } from "../src/index.js";

async function main(): Promise<void> {
  const clusterId = process.env.XMEM_CLUSTER_ID;
  const instanceId = process.env.XMEM_INSTANCE_ID;
  if (!clusterId || !instanceId) throw new Error("Set XMEM_CLUSTER_ID and XMEM_INSTANCE_ID");

  const xm = new XmemoryClient();

  const current = (await xm.admin.getInstanceSchema(instanceId)).data_schema;
  const currentYaml = yaml.dump(current);

  // 1. Enhance — get the new schema + an executor-ready migration plan.
  const enhanced = await xm.admin.enhanceSchema(
    clusterId,
    "Rename the `mail` field on the person object to `email`.",
    currentYaml,
  );
  console.log("Summary:", enhanced.summary);
  for (const op of enhanced.migration_plan?.ops ?? []) {
    console.log("  op:", op);
  }

  const newYaml = yaml.dump(enhanced.data_schema);

  // 2. Dry-run — preview the DDL. Nothing is applied.
  const preview = await xm.admin.dryRunMigration(instanceId, newYaml, SchemaType.YML, {
    migrationPlan: enhanced.migration_plan ?? undefined,
  });
  console.log(`Dry-run against v${preview.current_version}:`);
  for (const stmt of preview.statements) console.log("  ", stmt);
  console.log("  plan summary:", preview.plan_summary.count_by_op_type);

  // 3. Update — apply. A rename is non-destructive, so confirmDestructive stays
  //    false. Set it to true only for ops that drop data (remove*, lossy cast).
  try {
    const info = await xm.admin.updateInstanceSchema(instanceId, newYaml, SchemaType.YML, {
      migrationPlan: enhanced.migration_plan ?? undefined,
      confirmDestructive: false,
    });
    console.log(`Applied migration ${info.migration_id}: v${info.prior_version} -> v${info.new_version}`);
    if (info.migration_warnings?.length) console.log("Warnings:", info.migration_warnings);
  } catch (e) {
    if (e instanceof XmemoryAPIError && e.code === "destructive_confirmation_required") {
      console.log("Plan would drop data; re-run with confirmDestructive: true to proceed.");
      return;
    }
    throw e;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});