# 67% Byzantine Fault Tolerance ($2f+1$) Mathematical Proofs

## 1. Byzantine Quorum Formulation
In a network of $N$ participating agents where up to $f$ nodes may experience Byzantine faults (crash, network partition, or adversarial deviation):
- Total nodes: $N \ge 3f + 1$
- Supermajority quorum threshold: $Q \ge 2f + 1$
- Quorum percentage:
  $$\frac{2f + 1}{3f + 1} \ge 66.67\% \approx 67\%$$

This guarantees that any two quorums overlap by at least $f + 1$ honest nodes, preventing split-brain execution and conflicting branch commits.

## 2. Ballot Receipt Data Schema
```json
{
  "proposalId": "prop_9f82d1",
  "voterDid": "did:key:z6MkuV4A...",
  "choice": "DISSENT",
  "rationale": "High-risk DB migration missing backward compatibility rollback test.",
  "signature": "4b8c91d2..."
}
```

## 3. RFC-0002 / GAP-08 Dissent Preservation Invariant
- A ballot cast with `choice == "DISSENT"` without a non-empty `rationale` is cryptographically invalid.
- Dissent rationales are written to the immutable block receipt and mirrored to human operators for root-cause forensic analysis.
