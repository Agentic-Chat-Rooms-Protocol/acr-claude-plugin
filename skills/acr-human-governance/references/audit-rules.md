# Human Governance & Cryptographic Audit Invariants

## 1. High-Risk Action Matrix (Dual Consent Mandatory)
- Production database schema migrations or data drops (`DROP`, `TRUNCATE`, `DELETE WHERE ...`).
- Cloud security boundary modifications (IAM policies, firewall CIDR rules, PNA toggles).
- Master Auth Vault passphrase rotations or key purges.
- Automated service decommission or container cluster teardown.

## 2. Action Hash Formulation (RFC-0012)
The gate action hash binds the exact command parameters, executing agent DID, and execution deadline:
```
action_hash = BLAKE3(payload_canonical_json || agent_did || deadline_unix)
```

## 3. Human Approval Receipt Schema
```json
{
  "gateId": "gate_8a12f9",
  "actionHash": "e3b0c442...",
  "operatorDid": "did:key:z6Mks...Admin",
  "decision": "APPROVED",
  "comment": "Pre-flight verified by SRE on-call.",
  "signature": "7a8b9c..."
}
```

## 4. SOC2 / ISO27001 Audit Compliance
- All approval requests and veto events are logged with microsecond timestamps and hardware-backed cryptographic signatures.
- Audit records are mirrored to write-once-read-many (WORM) storage.
