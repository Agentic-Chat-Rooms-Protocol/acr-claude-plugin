#!/bin/sh
# PostGuard PreToolUse hook. Plain POSIX shell: no interpreter, network, or file access.
#
# Reads the hook payload (JSON) on stdin and scans it for credentials, high-risk PII and
# prompt-injection framing. On a match it prints a "deny" decision. A clean payload prints
# nothing and exits 0, so Claude Code's own permission flow stays in control; this hook
# never auto-approves a tool call. The whole payload is scanned (envelope fields included),
# which is a superset of the tool name and tool input.

LC_ALL=C
export LC_ALL

scanner_failure() {
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"PostGuard scanner failed; tool execution denied."}}'
  exit 0
}

payload=$(cat) || scanner_failure
case $payload in
  *[![:space:]]*) ;;
  *) exit 0 ;;
esac

# Undo JSON string escapes so an escaped form cannot hide a match from the patterns below:
# \n \t \r \b \f become spaces, \/ and \" become plain characters, and \u00XX escapes of
# printable ASCII are decoded to the character they stand for.
text=$(printf '%s\n' "$payload" | sed \
  -e 's/\\[ntrbf]/ /g' \
  -e 's/\\\//\//g' \
  -e 's/\\"/"/g') || scanner_failure

if printf '%s\n' "$text" | grep -Eq '\\u00[2-7][0-9A-Fa-f]'; then
  nl='
'
  script=
  code=32
  while [ "$code" -le 126 ]; do
    ch=$(printf "\\$(printf '%03o' "$code")")
    case $ch in
      '\'|'&'|'/') ch="\\$ch" ;;
    esac
    lower=$(printf '%02x' "$code")
    upper=$(printf '%02X' "$code")
    script="${script}s/\\\\u00${lower}/${ch}/g${nl}"
    [ "$upper" = "$lower" ] || script="${script}s/\\\\u00${upper}/${ch}/g${nl}"
    code=$((code + 1))
  done
  text=$(printf '%s\n' "$text" | sed -e "$script") || scanner_failure
else
  status=$?
  [ "$status" -eq 1 ] || scanner_failure
fi

L='(^|[^A-Za-z0-9_])'
R='([^A-Za-z0-9_]|$)'
S='[[:space:]]+'

deny() {
  tool=$(printf '%s\n' "$payload" | sed -n \
    's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_.:-]*\)".*/\1/p' | head -n 1)
  [ -n "$tool" ] || tool=unknown
  reason="PostGuard blocked tool call '$tool': [$1] $2"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"},"systemMessage":"%s"}\n' "$reason" "$reason"
  exit 0
}

# check CATEGORY DESCRIPTION PATTERN [-i]
check() {
  if printf '%s\n' "$text" | grep -E${4:+i}q -e "$3"; then
    deny "$1" "$2"
  else
    status=$?
    [ "$status" -eq 1 ] || scanner_failure
  fi
}

SSN_AREA='(00[1-9]|0[1-9][0-9]|[1-5][0-9][0-9]|6[0-5][0-9]|66[0-5]|66[7-9]|6[7-9][0-9]|[78][0-9][0-9])'
SSN_GROUP='(0[1-9]|[1-9][0-9])'
SSN_SERIAL='(000[1-9]|00[1-9][0-9]|0[1-9][0-9][0-9]|[1-9][0-9][0-9][0-9])'

check CREDENTIAL_LEAK 'Cryptographic private key detected in tool arguments.' \
  '-----BEGIN (RSA|OPENSSH|EC|PGP|ENCRYPTED|DSA)? ?PRIVATE KEY-----' i
check CREDENTIAL_LEAK 'AWS access key identifier detected.' \
  "${L}(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}${R}"
check CREDENTIAL_LEAK 'AI model service API key token detected.' \
  "${L}sk-(proj-)?[A-Za-z0-9_-]{24,}${R}"
check CREDENTIAL_LEAK 'GitHub personal access token detected.' \
  "${L}gh[pousr]_[A-Za-z0-9]{36,}${R}"
check CREDENTIAL_LEAK 'Unencrypted JSON Web Token (JWT) detected.' \
  "${L}eyJ[A-Za-z0-9_-]{10,}[.]eyJ[A-Za-z0-9_-]{10,}[.][A-Za-z0-9_-]{10,}${R}"
check PII_EXPOSURE 'Potential US Social Security Number (SSN) detected.' \
  "${L}${SSN_AREA}[- ]${SSN_GROUP}[- ]${SSN_SERIAL}${R}"
check PII_EXPOSURE 'Payment credit card primary account number (PAN) detected.' \
  "${L}(4[0-9]{12}([0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(0[0-5]|[68][0-9])[0-9]{11}|6(011|5[0-9]{2})[0-9]{12})${R}"
check PROMPT_INJECTION 'Adversarial system prompt framing delimiter detected.' \
  '<system_message>|</system_message>|<[|]im_start[|]>|<[|]im_end[|]>|\[SYSTEM\]|\[INST\]' i
check PROMPT_INJECTION 'Instruction override sequence (ignore previous instructions) detected.' \
  "${L}ignore${S}(all${S})?(previous|prior)${S}(instructions|prompts|directives)${R}" i
check PROMPT_INJECTION 'Autonomous persona override / DAN jailbreak attempt detected.' \
  "${L}you${S}are${S}now${S}(in${S})?(DAN|developer${S}mode|unrestricted|god${S}mode)${R}" i
check PROMPT_INJECTION 'Instruction seeking to bypass safety policies detected.' \
  "${L}disregard${S}(all${S})?(safety|security)${S}(guidelines|rules|policies)${R}" i

exit 0
