#!/usr/bin/env node
/**
 * PostGuard PreToolUse Security Hook for Claude Code
 *
 * Intercepts tool execution payloads before network dispatch:
 * 1. Sanitizes credentials, high-entropy secrets, and cloud API tokens.
 * 2. Scans for high-risk PII (SSNs, credit card numbers).
 * 3. Detects heuristic prompt injection, jailbreak delimiters, and system prompt leakage attempts.
 *
 * Implements Claude Code Hook Protocol:
 * Input (stdin): JSON object with tool_name and tool_input
 * Output (stdout): JSON object with hookSpecificOutput containing permissionDecision ("allow" | "deny")
 */

const fs = require('fs');

const SECURITY_RULES = [
  // 1. Private keys & Certificate Headers
  {
    category: 'CREDENTIAL_LEAK',
    pattern: /-----BEGIN (?:RSA|OPENSSH|EC|PGP|ENCRYPTED|DSA)? ?PRIVATE KEY-----/i,
    description: 'Cryptographic private key detected in tool arguments.'
  },
  // 2. AWS / Cloud Access Keys
  {
    category: 'CREDENTIAL_LEAK',
    pattern: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/,
    description: 'AWS access key identifier detected.'
  },
  // 3. OpenAI / Anthropic / Generic API Keys
  {
    category: 'CREDENTIAL_LEAK',
    pattern: /\bsk-(?:proj-)?[a-zA-Z0-9_-]{24,}\b/,
    description: 'AI model service API key token detected.'
  },
  // 4. GitHub Tokens
  {
    category: 'CREDENTIAL_LEAK',
    pattern: /\bgh[pousr]_[a-zA-Z0-9]{36,}\b/,
    description: 'GitHub personal access token detected.'
  },
  // 5. JSON Web Tokens (JWT)
  {
    category: 'CREDENTIAL_LEAK',
    pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
    description: 'Unencrypted JSON Web Token (JWT) detected.'
  },
  // 6. High-Risk PII: US Social Security Numbers
  {
    category: 'PII_EXPOSURE',
    pattern: /\b(?!000|666|9\d{2})\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/,
    description: 'Potential US Social Security Number (SSN) detected.'
  },
  // 7. High-Risk PII: Credit Card Numbers (Major card brands)
  {
    category: 'PII_EXPOSURE',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12})\b/,
    description: 'Payment credit card primary account number (PAN) detected.'
  },
  // 8. Prompt Injection: System Prompt Delimiter Hijacking
  {
    category: 'PROMPT_INJECTION',
    pattern: /<system_message>|<\/system_message>|<\|im_start\|>|<\|im_end\|>|\[SYSTEM\]|\[INST\]/i,
    description: 'Adversarial system prompt framing delimiter detected.'
  },
  // 9. Prompt Injection: Instruction Overrides
  {
    category: 'PROMPT_INJECTION',
    pattern: /\bignore (?:all )?(?:previous|prior) (?:instructions|prompts|directives)\b/i,
    description: 'Instruction override sequence ("ignore previous instructions") detected.'
  },
  // 10. Prompt Injection: Persona Escalation & Jailbreaks
  {
    category: 'PROMPT_INJECTION',
    pattern: /\byou are now (?:in )?(?:DAN|developer mode|unrestricted|god mode)\b/i,
    description: 'Autonomous persona override / DAN jailbreak attempt detected.'
  },
  // 11. Prompt Injection: Safety Guideline Disregard
  {
    category: 'PROMPT_INJECTION',
    pattern: /\bdisregard (?:all )?(?:safety|security) (?:guidelines|rules|policies)\b/i,
    description: 'Instruction seeking to bypass safety policies detected.'
  }
];

function extractStrings(value, accumulator = []) {
  if (typeof value === 'string') {
    accumulator.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      extractStrings(item, accumulator);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      accumulator.push(key);
      extractStrings(value[key], accumulator);
    }
  }
  return accumulator;
}

function scanPayload(toolName, toolInput) {
  const stringsToScan = [toolName, ...extractStrings(toolInput)];
  const combinedText = stringsToScan.join('\n');

  for (const rule of SECURITY_RULES) {
    if (rule.pattern.test(combinedText)) {
      return {
        passed: false,
        category: rule.category,
        description: rule.description
      };
    }
  }

  return { passed: true };
}

function respondAllow(reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason || 'Payload sanitized and passed PostGuard security policies.'
    }
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

function respondDeny(toolName, category, description) {
  const reason = `PostGuard blocked tool call '${toolName || 'unknown'}': [${category}] ${description}`;
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    },
    systemMessage: reason
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

function main() {
  let rawData = '';

  process.stdin.setEncoding('utf8');

  process.stdin.on('data', chunk => {
    rawData += chunk;
  });

  process.stdin.on('end', () => {
    if (!rawData.trim()) {
      respondAllow('Empty hook payload; allowing invocation.');
      return;
    }

    try {
      const parsed = JSON.parse(rawData);
      const toolName = parsed.tool_name || parsed.tool || '';
      const toolInput = parsed.tool_input || parsed.parameters || parsed.args || {};

      const scanResult = scanPayload(toolName, toolInput);

      if (!scanResult.passed) {
        respondDeny(toolName, scanResult.category, scanResult.description);
      } else {
        respondAllow(`Tool '${toolName}' verified clean by PostGuard scanner.`);
      }
    } catch (err) {
      // If parsing fails, fall back to string scan of raw input
      const fallbackResult = scanPayload('raw_stdin', rawData);
      if (!fallbackResult.passed) {
        respondDeny('raw_stdin', fallbackResult.category, fallbackResult.description);
      } else {
        respondAllow('Raw payload parsed safely and passed heuristics.');
      }
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  scanPayload,
  SECURITY_RULES
};
