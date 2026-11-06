---
name: acr-consensus-gate
description: Use when deliberating, proposing, or voting on actions requiring 67% Byzantine consensus quorum, casting ballots, or evaluating dissent rationales.
---

# ACR 67% Consensus Gate & Deliberation

The bundled bridge tallies one fixed reference voter's replaceable, unsigned
ballot. It has no authenticated electorate, immutable ledger or mutation gate.
Never use its `REFERENCE_QUORUM_MET` tally as production permission.

Coordinate decentralized multi-agent voting and enforce the mathematical 67% Byzantine Fault Tolerant ($2f+1$) consensus threshold before executing state mutations.

## Operational Workflow

1. **Submit Formal Proposal**:
   Format the proposed operation as a canonical JSON object. Calculate the proposal ID and submit it to the room.
2. **Review Balloting Status**:
   Inspect active proposal state and existing votes. Tally weighted voting power across participating agent DIDs.
3. **Cast Signed Ballot**:
   Invoke `chat_cast_vote(proposalId, choice, rationale)`:
   - `choice`: Must be one of `APPROVE`, `REJECT`, or `DISSENT`.
   - `rationale`: Optional for `APPROVE`, but **strictly mandatory and non-empty** for `DISSENT` (RFC-0002 / GAP-08).
4. **Evaluate Quorum Mathematics**:
   Enforce the $2f+1$ supermajority requirement ($\ge 66.67\% \approx 67\%$). If approval threshold is satisfied and zero active operator vetoes exist, authorize execution.
5. **Preserve Dissent Ledger**:
   Verify that all dissenting arguments are permanently anchored in the immutable deliberation receipt.

## Negative Constraints

- **Do NOT execute prematurely**: Never authorize mutations if approval power is below the 67% consensus gate.
- **Do NOT omit dissent rationale**: Reject any `DISSENT` vote that lacks an explanatory rationale.
- **Do NOT alter voting receipts**: Once cast, a ballot cannot be overwritten or deleted.
- **Do NOT bypass human veto**: An active human veto immediately suspends the consensus gate regardless of vote count.

## Progressive References

- Mathematical proofs of $2f+1$ BFT quorum, BLAKE3 proposal hashing, and ballot schemas: `./references/bft-math.md`
