---
name: acr-atlas-dag
description: Use when orchestrating complex multi-step goal DAGs, advancing Atlas 2.0 task nodes, verifying prerequisites, or triggering deterministic rollbacks.
---

# Atlas 2.0 Dynamic DAG Orchestration

The local reference checks prerequisites and hashes outputs but does not verify
receipts or restore snapshots. Rollback invalidates transitive descendants;
production guarantees require a real execution backend.

Model and execute complex agent workflows as directed acyclic graphs (DAGs) with strict ancestor verification and deterministic state rollback checkpoints.

## Operational Workflow

1. **Query DAG Topology & State**:
   Inspect the active goal graph using `acr_get_dag_state(dag_id)`. Retrieve node states (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `ROLLED_BACK`).
2. **Verify Ancestor Prerequisites**:
   Before executing a node, confirm that all direct prerequisite parent nodes have completed with cryptographically valid output receipts.
3. **Advance Execution Node**:
   Perform the scoped task for the target node. Compute the output state hash and invoke `acr_advance_dag_node(dag_id, node_id, output, receipt)` to transition the node to `COMPLETED`.
4. **Trigger Deterministic Rollback**:
   If an unrecoverable error, timeout, or consensus failure occurs, halt execution. Invoke `acr_rollback_dag(dag_id, target_checkpoint_id, reason)` to revert downstream state to the last verified checkpoint.

## Negative Constraints

- **Do NOT execute out of order**: Never start a node until every incoming edge reports a verified completion receipt.
- **Do NOT mutate historical checkpoints**: Node completion hashes and checkpoint records are append-only.
- **Do NOT ignore rollback cascades**: When rolling back to checkpoint $K$, all dependent child nodes $> K$ must be transitioned to `ROLLED_BACK`.
- **Do NOT create cyclic dependencies**: The execution graph must maintain strict DAG invariants.

## Progressive References

- JSON Schema for Atlas 2.0 DAG nodes, state transitions, and checkpoint hashing: `./references/dag-schema.md`
