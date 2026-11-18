---
name: acr-atlas-dag
description: Use when orchestrating complex multi-step goal DAGs, advancing Atlas 2.0 task nodes, verifying prerequisites, or triggering deterministic rollbacks.
---

# Atlas 2.0 Dynamic DAG Orchestration

The local reference checks prerequisites and hashes outputs but does not verify
receipts or restore snapshots. Rollback invalidates transitive descendants;
production guarantees require a real execution backend.

## Operational Workflow

Inspect the graph via `acr_get_dag_state`. Check each required parent’s reported state. For an explicitly requested advance, provide actual output to `acr_advance_dag_node` and report the digest and checkpoint exactly as returned. For rollback, confirm the target checkpoint and inspect the resulting state via the read tool.

## Negative Constraints

Do NOT claim a signed receipt, completed external task, or restored infrastructure based on the local graph. If semantic safety verification is requested, stop because the reference bridge cannot supply it.

## Progressive References

See `./references/dag-schema.md` for protocol background.
