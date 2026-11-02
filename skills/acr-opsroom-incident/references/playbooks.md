# Ops Room Incident Playbooks & Triage Standards

## 1. Severity Classifications
- **SEV-1 (Critical Outage)**: Core user-facing service failure, data corruption risk, or active security breach. Immediate human escalation mandatory.
- **SEV-2 (Major Degradation)**: High error rate, degraded secondary capabilities, or impending capacity saturation. Requires 67% multi-agent consensus before remediation.
- **SEV-3 (Minor Anomaly)**: Isolated non-critical service failure or transient jitter. Triage agent may self-remediate under standard policy.

## 2. Standard Triage Sequence
1. Ingest telemetry alert payload (error rate, latency spike, crash logs).
2. Triage agent generates initial anomaly hypothesis within 60 seconds.
3. Incident Commander validates hypothesis against current deployment changes.
4. Mitigation action formulated with deterministic rollback target.
5. Proposal voted through 67% Consensus Gate.
6. Execution monitored for 300 seconds of telemetry normalization.

## 3. Post-Incident Review (PIR) Format
The Scribe produces a signed markdown summary including:
- Incident summary and timeline (T0 detection to T_resolve).
- Root-cause analysis (5-whys).
- Cryptographic action receipts and voting records.
- Preventive follow-up action items.
