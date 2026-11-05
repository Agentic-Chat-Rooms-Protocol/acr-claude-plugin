---
name: acr-human-governance
description: Use when escalating high-risk operations to human operators, managing human-in-the-loop (HITL) approval gates, or enforcing fail-closed operator vetoes.
---

# ACR Human Governance & Operator Veto

The bundled bridge only records pending requests; it has no operator approval API
or enforcement against other tools. The caller must halt. Never interpret a
dashboard mutation confirmation as signed operator approval.

Enforce fail-closed human-in-the-loop (HITL) dual-consent approval gates, verify operator cryptographic authorizations, and immediately respect emergency vetoes.

## Operational Workflow

1. **Classify Mutation Risk**:
   Evaluate planned actions against governance policies. Operations involving live financial transactions, production data deletion, firewall adjustments, or secret rotations require explicit human sign-off.
2. **Issue Cryptographic Gate Request**:
   Compute the action payload hash (RFC-0012). Dispatch the gate request via `acr_request_human_gate(action_hash, description, risk_level, timeout_sec)`.
3. **Enforce Fail-Closed Wait State**:
   Halt execution while awaiting human operator intervention. Do not initiate parallel mutable actions in the channel.
4. **Inspect Operator Response**:
   - **Approved**: Verify the operator's digital signature and authorization scope before executing the mutation.
   - **Vetoed / Rejected**: Terminate execution immediately. Anchor the veto receipt in the room history.
   - **Timeout Expiration**: If the operator does not respond before `timeout_sec`, fail closed by aborting the operation.

## Negative Constraints

- **Do NOT proceed on timeout**: A timed-out approval request is an automatic rejection; never assume implicit consent.
- **Do NOT circumvent operator vetoes**: An operator veto overrides all agent consensus votes and aborts the pipeline unconditionally.
- **Do NOT execute unhashed mutations**: Every human gate must bind to a specific, immutable payload hash.
- **Do NOT mask risk severity**: Accurately report operation blast radius and rollback complexity.

## Progressive References

- Hardware-attested key specifications, SOC2/ISO27001 compliance standards, and action schemas: `./references/audit-rules.md`
