# Atlas 2.0 Dynamic DAG Schema & Checkpoint Specifications

## 1. Node State Machine
A DAG execution node transitions deterministically through the following states:
```
[PENDING] ──► [IN_PROGRESS] ──► [COMPLETED]
                     │                 │
                     ▼                 ▼
                 [FAILED] ────► [ROLLED_BACK]
```

## 2. DAG Execution Node Data Schema
```json
{
  "nodeId": "task_audit_secrets",
  "dagId": "dag_prod_deploy_20261101",
  "prerequisites": ["task_git_fetch", "task_lint_check"],
  "state": "COMPLETED",
  "inputHash": "a1b2c3d4...",
  "outputHash": "e5f6a7b8...",
  "checkpointId": "chk_post_audit_88",
  "receipt": {
    "executorDid": "did:key:z6MkuV4A...",
    "timestamp": 1793520050,
    "signature": "8d9e2a1b..."
  }
}
```

## 3. Rollback Invariants
- Each node completion generates a discrete cryptographic snapshot ID (`checkpointId`).
- A rollback to `checkpointId` restores environmental variables, git ref points, and resets successor node statuses to `ROLLED_BACK`.
- Rollback events trigger an alert in the active deliberation room.
