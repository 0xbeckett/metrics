/*
 * Privacy scanner for the public metrics document.
 *
 * metrics.json ships to the open internet (metrics.0xbeckett.me). This module is the single
 * source of truth for "what must never appear in it", shared by the publish-time verifier
 * (scripts/verify-public-metrics.mjs) and its tests. Each rule returns the offending matches
 * so a failure names exactly what tripped it.
 *
 * DELIBERATELY ALLOWED (do not add rules that reject these — the dashboard needs them):
 *   - ticket refs: "#100", "#10.1", "OPS-125"
 *   - ticket titles (free prose describing a unit of work)
 *   - model ids: "claude-opus-4-8", "gpt-5.6-terra"
 *   - ISO timestamps and yyyy-mm-dd dates
 *
 * FORBIDDEN — every rule below hard-fails the publish:
 *   emails · absolute local paths · Discord ids/usernames/mention-content ·
 *   memory file bodies · anything token/secret shaped.
 */

// A "rule" is { id, describe, test(text) -> string[] of matches }. A non-empty return is a
// violation. Rules are intentionally tuned to avoid the allowed shapes above.
const RULES = [
  {
    id: "email",
    describe: "email address",
    re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  },
  {
    id: "local-path",
    describe: "absolute local filesystem path",
    // /home/… , /Users/… , or a Windows drive path. Ticket refs and URLs never match these.
    re: /(?:\/home\/|\/Users\/|[A-Za-z]:[\\/])/g,
  },
  {
    id: "discord-snowflake",
    describe: "Discord numeric id (user/channel/message snowflake)",
    // 17–20 digit run not embedded in a longer number. Token counts, costs and durations in
    // this document are all far shorter; epoch-ms timestamps are emitted as ISO strings.
    re: /(?<!\d)\d{17,20}(?!\d)/g,
  },
  {
    id: "discord-mention",
    describe: "Discord mention / channel-content markup",
    // <@123>, <@!123>, <#123>, <@&123>, and the "user:<snowflake>" form beckett stamps into
    // ticket descriptions — a reliable signal that raw Discord content leaked in.
    re: /<[@#][!&]?\d+>|user:\d{6,}/gi,
  },
  {
    id: "discord-username",
    describe: "Discord legacy username#discriminator",
    // name#1234. Model labels ("haiku-4.5") and refs ("OPS-125") never carry a #NNNN suffix.
    re: /(?<![#\w])[A-Za-z0-9_.]{2,32}#\d{4}(?!\d)/g,
  },
  {
    id: "discord-link",
    describe: "Discord invite / CDN link",
    re: /\b(?:discord\.gg\/\S+|(?:cdn|media)\.discordapp\.(?:com|net)\/\S+)/gi,
  },
  {
    id: "memory-body",
    describe: "memory file body (wiki-link or frontmatter marker)",
    // The graph ships as structured {from,to} edges — a literal [[wiki-link]] means a raw
    // memory body slipped through. The **Why:/**How to apply:** markers are beckett's memory
    // body template. A leading YAML frontmatter fence is the third tell.
    re: /\[\[[^\]]+\]\]|\*\*(?:Why|How to apply):\*\*|(?:^|\\n)---\\nname:/g,
  },
  {
    id: "secret-prefixed",
    describe: "token/secret with a known prefix",
    re: /\b(?:ghp_|gho_|ghu_|ghs_|github_pat_|sk-[A-Za-z0-9]|xox[baprs]-|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,})[A-Za-z0-9_-]*/g,
  },
  {
    id: "secret-bearer",
    describe: "bearer/authorization token or PEM block",
    re: /Bearer\s+[A-Za-z0-9._-]{12,}|-----BEGIN [A-Z ]+-----|[A-Z0-9_]*(?:TOKEN|SECRET|API[_-]?KEY|PASSWORD)[A-Z0-9_]*\s*[:=]\s*\S+/g,
  },
  {
    id: "secret-high-entropy",
    describe: "high-entropy token-shaped string",
    // >=25 chars of base64url alphabet carrying upper + lower + digit. A 40-char git SHA is
    // all-lowercase-hex (no uppercase) and is NOT matched; model ids and dates are far shorter
    // and lack the mixed-case-plus-digit density.
    re: /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]{25,}(?![A-Za-z0-9_-]))(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{25,}/g,
  },
];

/**
 * Scan a string for public-safety violations.
 * @param {string} text
 * @returns {{id:string, describe:string, samples:string[]}[]} one entry per rule that matched.
 */
export function scanForViolations(text) {
  const out = [];
  for (const rule of RULES) {
    const matches = text.match(rule.re);
    if (matches && matches.length) {
      // De-dupe and cap so an error message stays readable.
      const samples = [...new Set(matches)].slice(0, 5);
      out.push({ id: rule.id, describe: rule.describe, samples });
    }
  }
  return out;
}

/** Throw if `text` contains any violation. `label` names the source in the error. */
export function assertPublicText(text, label = "document") {
  const violations = scanForViolations(text);
  if (violations.length) {
    const detail = violations
      .map((v) => `${v.describe} (${v.samples.map((s) => JSON.stringify(s)).join(", ")})`)
      .join("; ");
    throw new Error(`privacy check failed for ${label}: ${detail}`);
  }
}

/** Convenience for callers holding a parsed value rather than its text. */
export function assertPublicJson(value, label = "document") {
  assertPublicText(JSON.stringify(value), label);
}

export const RULE_IDS = RULES.map((r) => r.id);
