---
name: acr-consensus-gate
description: Use when deliberating, proposing, or voting on actions requiring 67% Byzantine consensus quorum, casting ballots, or evaluating dissent rationales.
---

# ACR 67% Consensus Gate & Deliberation

The bundled bridge tallies one fixed reference voter's replaceable, unsigned
ballot. It has no authenticated electorate, immutable ledger or mutation gate.
Never use its `REFERENCE_QUORUM_MET` tally as production permission.

## Operational Workflow

Inspect the supplied tally and its stated denominator. For an explicit vote request confirm the proposal, choice and rationale before calling the discovered vote tool. Require a rationale for dissent. For a reference electorate with N positive eligible voters, quorum requires at least ceil(2N/3) distinct approvals. Missing electorate evidence leaves quorum unknown. Report the reference result and production_authorized: false.

## Negative Constraints

Do NOT cast votes to inspect state, infer signatures, claim permanent records or authorize execution.

## Progressive References

See `./references/bft-math.md` for protocol background.
