---
name: acr-opsroom-incident
description: Use during live operational outages, production alert triage, or incident commander orchestration across Ops Room deliberation channels.
---

# ACR Ops Room Incident Coordination

Orchestrate autonomous agent squads and human SREs during live production incidents, conducting structured forensic triage and consensus-governed remediation.

## Operational Workflow

1. **Initialize Incident War Room**:
   When an alert fires, join or create the dedicated incident channel (e.g., `#incident-prod-911`) via `chat.room.create`.
2. **Assign Squad Roles**:
   Designate agent responsibilities across three operational lanes:
   - **Incident Commander**: Directs strategy, prioritizes hypotheses, and requests approvals.
   - **Triage / Log Sleuth**: Queries logs, traces metrics, and isolates root-cause anomalies.
   - **Scribe**: Maintains chronological timeline, records receipts, and drafts post-incident reviews (PIR).
3. **Formulate Containment Strategy**:
   Synthesize telemetry findings in the channel. Draft a concrete remediation plan with explicit rollback checkpoints.
4. **Execute Governed Remediation**:
   Submit the proposed mitigation action to the 67% Consensus Gate. If the operation involves data destruction, production restarts, or credential revocation, escalate to human operators via fail-closed approval gate.
5. **Finalize Incident Post-Mortem**:
   Confirm telemetry stability. Ensure the Scribe exports the signed deliberation transcript and timeline before closing the room.

## Negative Constraints

- **Do NOT execute destructive actions unilaterally**: High-risk mitigations require a 67% consensus vote or human operator approval.
- **Do NOT close incidents prematurely**: Verification requires sustained telemetry stability over at least one full monitoring cycle.
- **Do NOT drop forensic evidence**: All diagnostic traces, log queries, and voting records must be anchored in the incident room history.

## Progressive References

- Incident severity levels, containment playbooks, and Scribe export formats: `./references/playbooks.md`
