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
  # Single-invocation static BRE table avoids subshells in the hot ASCII decode path.
  text=$(printf '%s\n' "$text" | sed -e 's/\\u0020/ /g;s/\\u0021/!/g;s/\\u0022/"/g;s/\\u0023/#/g;s/\\u0024/$/g;s/\\u0025/%/g;s/\\u0026/\&/g;s/\\u0027/'\''/g;s/\\u0028/(/g;s/\\u0029/)/g;s/\\u002[aA]/*/g;s/\\u002[bB]/+/g;s/\\u002[cC]/,/g;s/\\u002[dD]/-/g;s/\\u002[eE]/./g;s/\\u002[fF]/\//g;s/\\u0030/0/g;s/\\u0031/1/g;s/\\u0032/2/g;s/\\u0033/3/g;s/\\u0034/4/g;s/\\u0035/5/g;s/\\u0036/6/g;s/\\u0037/7/g;s/\\u0038/8/g;s/\\u0039/9/g;s/\\u003[aA]/:/g;s/\\u003[bB]/;/g;s/\\u003[cC]/</g;s/\\u003[dD]/=/g;s/\\u003[eE]/>/g;s/\\u003[fF]/?/g;s/\\u0040/@/g;s/\\u0041/A/g;s/\\u0042/B/g;s/\\u0043/C/g;s/\\u0044/D/g;s/\\u0045/E/g;s/\\u0046/F/g;s/\\u0047/G/g;s/\\u0048/H/g;s/\\u0049/I/g;s/\\u004[aA]/J/g;s/\\u004[bB]/K/g;s/\\u004[cC]/L/g;s/\\u004[dD]/M/g;s/\\u004[eE]/N/g;s/\\u004[fF]/O/g;s/\\u0050/P/g;s/\\u0051/Q/g;s/\\u0052/R/g;s/\\u0053/S/g;s/\\u0054/T/g;s/\\u0055/U/g;s/\\u0056/V/g;s/\\u0057/W/g;s/\\u0058/X/g;s/\\u0059/Y/g;s/\\u005[aA]/Z/g;s/\\u005[bB]/[/g;s/\\u005[cC]/\\/g;s/\\u005[dD]/]/g;s/\\u005[eE]/^/g;s/\\u005[fF]/_/g;s/\\u0060/`/g;s/\\u0061/a/g;s/\\u0062/b/g;s/\\u0063/c/g;s/\\u0064/d/g;s/\\u0065/e/g;s/\\u0066/f/g;s/\\u0067/g/g;s/\\u0068/h/g;s/\\u0069/i/g;s/\\u006[aA]/j/g;s/\\u006[bB]/k/g;s/\\u006[cC]/l/g;s/\\u006[dD]/m/g;s/\\u006[eE]/n/g;s/\\u006[fF]/o/g;s/\\u0070/p/g;s/\\u0071/q/g;s/\\u0072/r/g;s/\\u0073/s/g;s/\\u0074/t/g;s/\\u0075/u/g;s/\\u0076/v/g;s/\\u0077/w/g;s/\\u0078/x/g;s/\\u0079/y/g;s/\\u007[aA]/z/g;s/\\u007[bB]/{/g;s/\\u007[cC]/|/g;s/\\u007[dD]/}/g;s/\\u007[eE]/~/g') || scanner_failure
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
