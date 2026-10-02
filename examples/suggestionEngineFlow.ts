/**
 * End-to-end suggestion-engine flow: read → flagged → review → decide → apply.
 *
 * The suggestion engine watches read traffic. When a read can't be fully
 * answered because the schema lacks a field/object/relation, that gap
 * accumulates and is surfaced — on demand — as a single consolidated proposal
 * you review, decide on (in bulk), and apply as one migration.
 *
 * Run against a test instance:
 *
 *   export XMEM_API_KEY=xmem_...
 *   export XMEM_API_URL=<api-url>   # optional; defaults to https://api.xmemory.ai
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
    const blocked = item.apply_blocked ? " (cannot be applied as proposed)" : "";
    console.log(`  - [${item.item_fingerprint}]${blocked} ${item.rationale}`);
    console.log(`      op:`, item.op);
  }

  // 2. Decide — accept everything that can be applied; in practice you'd
  //    choose per item. An apply_blocked item would fail the whole apply.
  const decisions: DecisionInput[] = proposal.items
    .filter((item) => !item.apply_blocked)
    .map((item) => ({
      item_fingerprint: item.item_fingerprint,
      decision: "accept",
    }));
  if (decisions.length === 0) {
    console.log("Every suggestion is blocked; nothing to accept.");
    return;
  }
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