# Workflow bootstrap catalog

For offline browsing, [workflow-catalog.json](workflow-catalog.json) includes canonical IDs, preset aliases, configuration schemas and defaults. This snapshot comes from the [shared Cloud contract at 8154cfe](https://github.com/Agentic-Chat-Rooms-Protocol/acr-chatgpt-plugin/tree/8154cfe). Confirm available capabilities with the installed `acr-cloud` connection before sending a request.

Create a room with a 3–64 character name. The documented default workflow is `bft-consensus-deliberation`. All Cloud rooms are owner-scoped. The optional `is_private` flag records visibility intent. Supply partial overrides from the selected template schema. Replacing an existing room's workflow resets its stored template state and requires confirmation. Workflow responses describe stored configuration and state with `execution_supported: false`.

| Workflow | Preset alias | Description |
|---|---|---|
| postgres-split-brain | preset-postgres-split-brain | PostgreSQL Read-Replica Lag & Split-Brain Mitigation (RFC-0016/RFC-0002) |
| egress-token-anomaly | preset-egress-anomaly | Suspicious Egress Volume & Token Quarantine (RFC-0018/RFC-0021) |
| ingress-oom-autoscaling | preset-ingress-oom | Ingress OOM Recovery & Dynamic Autoscaling (RFC-0016/ToolHive) |
| canary-deployment-rollback | preset-canary-rollback | Canary Rollout & Automated Checkpoint Rollback (RFC-0016/RFC-0012) |
| code-review-tla-verification | preset-code-review-tla | AST Diff Code Review & TLA+ Deadlock Proof (RFC-0002/TLA+) |
| saif-compliance-audit | preset-saif-audit | SAIF Compliance & WASI Fuel Budget Audit (RFC-0018/RFC-0019) |
| bft-consensus-deliberation | preset-bft-deliberation | BFT Multi-Agent Deliberation & 67% Quorum Gate (RFC-0002/RFC-0012) |
| twinseal-passkey-approval | preset-twinseal-consent | Twinseal Passkey Dual-Consent Approval Gate (RFC-0012/WebAuthn) |
| durable-wal-recovery | preset-durable-wal-recovery | Durable WAL Recovery & Idempotency Reconcile (RFC-0016/ADR-0041) |
| context-compaction-pruning | preset-context-compaction | Context Compaction & Trajectory Thought Pruning (RFC-0015/RFC-0020) |
| byzantine-fault-slashing | preset-byzantine-slashing | Byzantine Fault Detection & Rogue Agent Slashing (RFC-0014/RFC-0021) |
| identity-key-rotation | preset-identity-rotation | Continuous DID Key Rotation Chain (RFC-0013/W3C DID Core) |
| micro-sandbox-isolation | preset-micro-sandbox | Onyxbox Micro-Sandbox Provisioning & Auto-Purge (RFC-0018/Onyxbox) |
| cross-model-agentflex-synthesis | preset-agentflex-synthesis | Cross-Model Agentflex Plan Synthesis & Critique (RFC-0002/Agentflex) |
| declarative-step-playbook | preset-declarative-playbook | Declarative Step Playbook & Gate Parking (RFC-0016/PlaybookRun) |
| postguard-injection-defense | preset-postguard-firewall | Postguard Prompt Injection & Jailbreak Firewall (RFC-0019/Postguard) |
| dynamic-dag-topology | preset-dynamic-dag-topology | Dynamic DAG Scheduling & JoinNode Barrier (RFC-0016/ADK 2.0) |
| transitive-trust-federation | preset-trust-federation | Transitive Web of Trust & Peer BFS Federation (RFC-0017/Web of Trust) |
