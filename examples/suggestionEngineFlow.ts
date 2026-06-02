/**
 * End-to-end suggestion-engine flow: read → flagged → review → decide → apply.
 *
 * The suggestion engine watches read traffic. When a read can't be fully
 * answered because the schema lacks a field/object/relation, that gap
 * accumulates and is surfaced — on demand — as a single consolidated proposal
 * you review, decide on (in bulk), and apply as one migration.
 *
 * Run against a staging instance:
 *
 *   export XMEM_API_KEY=xmem_...
 *   export XMEM_API_URL=https://api.stg.xmemory.ai   # optional; defaults to prod
 *   export XMEM_INSTANCE_ID=<instance-id>
 *   npx tsx examples/suggestionEngineFlow.ts
 */

import { XmemoryClient, type DecisionInput } from "../src/index.js";

async function main(): Promise<void> {
  const instanceId = process.env.XMEM_INSTANCE_ID;
  if (!instanceId) throw new Error("Set XMEM_INSTANCE_ID");

  const xm = new XmemoryClient(); // reads XMEM_API_KEY / XMEM_API_URL from the env
  const inst = xm.instance(instanceId);

  // A read that may not be fully answerable by the current schema — what the
  // gap analyzer learns from.
  await inst.write("Dana Lopez is a staff engineer. Her desk phone is +1-555-0100.");
  await inst.read("What is Dana's phone number?");

  // 1. Review — pull the rolling proposal. May report a migration in flight.
  let review = await inst.reviewSuggestions();
  if (review.status === "evolution_in_progress") {
    const wait = review.retry_after_seconds ?? 5;
    console.log(`Evolution in progress; retrying in ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    review = await inst.reviewSuggestions();
  }

  const proposal = review.proposal;
  if (!proposal || proposal.items.length === 0) {
    console.log("No pending suggestions.");
    return;
  }

  console.log(`Proposal ${proposal.proposal_version} (schema v${proposal.schema_version}):`);
  for (const item of proposal.items) {
    console.log(`  - [${item.item_fingerprint}] ${item.rationale}`);
    console.log(`      op:`, item.op);
  }

  // 2. Decide — accept everything here; in practice you'd choose per item.
  const decisions: DecisionInput[] = proposal.items.map((item) => ({
    item_fingerprint: item.item_fingerprint,
    decision: "accept",
  }));
  const decided = await inst.decideSuggestions(proposal.proposal_version, decisions);
  for (const warning of decided.warnings) {
    console.log(`  dependency warning: ${warning.kind} — ${warning.guidance}`);
  }

  // 3. Apply — commit accepted decisions as a single migration.
  const applied = await inst.applyPendingDecisions(decided.next_proposal_version);
  if (applied.status === "nothing_to_apply") {
    console.log("Nothing to apply.");
  } else {
    console.log(
      `Applied migration ${applied.migration_id}: ` +
        `v${applied.prior_version} -> v${applied.new_version} (${applied.summary})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});