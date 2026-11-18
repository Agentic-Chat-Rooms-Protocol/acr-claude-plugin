# Reference tally and protocol quorum

For an eligible electorate of size N > 0, the local two-thirds threshold is ceil(2N/3). With six eligible voters, four approvals meet this threshold and three fall short. Preserve the stated denominator and the distinction between eligible voters and votes cast.

In a BFT protocol configured with exactly 3f + 1 replicas, two sets of 2f + 1 replicas intersect in at least f + 1 replicas, at least one of whom is honest under the assumed fault bound. That protocol argument also requires authenticated identities and protocol-specific voting rules. An unsigned reference tally supplies no such proof.

Local dissent requires a rationale. Reference votes are replaceable. Use the actual returned tally, report missing verification evidence as unknown, and always keep production authorization false in a reference assessment.
