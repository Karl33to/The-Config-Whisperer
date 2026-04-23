/* ── Ruleset normalisation ────────────────────────────────────── */
function normalizeRuleset(input) {
  if (!input || typeof input !== "object") return input;
  const out = { ...input };
  const rules = input.rules && typeof input.rules === "object" ? input.rules : {};
  const cleaned = {};
  const seen = new Set();
  Object.entries(rules).forEach(([key, val]) => {
    const lc = String(key).toLowerCase();
    if (seen.has(lc)) return;
    seen.add(lc);
    cleaned[lc] = val;
  });
  out.rules = cleaned;
  return out;
}

// Standalone assignment separators are syntax, not meaningful tokens
function normalizeLineTokens(trimmed) {
  if (!trimmed) return [];
  return trimmed.split(/\s+/).filter(Boolean).filter((token) => token !== "=");
}

/* ── Rule key helpers ────────────────────────────────────────── */
function extractRuleKey(trimmed, tokenLengthOverride) {
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);

  if (tokens[0] === "set" && tokens[1]) {
    const len = tokenLengthOverride || 2;
    return { key: tokens.slice(0, len).join(" "), used: len, tokens };
  }
  if (tokens[0] === "resource" && tokens[1] && tokens[2]) {
    const len = tokenLengthOverride || 3;
    return { key: tokens.slice(0, len).join(" "), used: len, tokens };
  }

  const len = tokenLengthOverride || Math.min(tokens.length, 4);
  return { key: tokens.slice(0, len).join(" "), used: len, tokens };
}

/* ── Rule evaluation ─────────────────────────────────────────── */
function evaluateRule(rule, lineValue, fullLine, remainderTokens) {
  let status = "pass";
  const reasons = [];
  const type = typeof rule === "object" ? rule.rule || "allowed" : rule;
  const ruleNote = typeof rule === "object" && rule.note ? String(rule.note) : "";
  const remTokens = remainderTokens || [];

  if (type === "allowed") {
    // ok
  } else if (type === "forbidden") {
    status = "fail";
    reasons.push("Entry forbidden by ruleset");
  } else if (type === "equals") {
    const expected = typeof rule === "object" ? String(rule.value ?? "") : "";
    if (String(lineValue) !== expected) {
      status = "fail";
      reasons.push("Must equal " + expected);
    }
  } else if (type === "not_equals") {
    const forbidden = typeof rule === "object" ? String(rule.value ?? "") : "";
    if (String(lineValue) === forbidden) {
      status = "fail";
      reasons.push("Must not equal " + forbidden);
    }
  } else if (type === "range" && typeof rule === "object") {
    const num = parseFloat(lineValue);
    if (isNaN(num)) {
      status = "fail";
      reasons.push("Expected a numeric value");
    } else {
      if (rule.min !== undefined && num < rule.min) {
        status = "fail";
        reasons.push("Must be ≥ " + rule.min);
      }
      if (rule.max !== undefined && num > rule.max) {
        status = "fail";
        reasons.push("Must be ≤ " + rule.max);
      }
    }
  } else if (type === "one_of" && typeof rule === "object") {
    const list = rule.values || [];
    const valueTokens = (lineValue || "").split(/\s+/).filter(Boolean);
    if (!list.some((part) => valueTokens.includes(String(part)))) {
      status = "fail";
      reasons.push("Must be one of: " + list.join(", "));
    }
  } else if (type === "includes_all" && typeof rule === "object") {
    const valueTokens = (lineValue || "").split(/\s+/).filter(Boolean);
    const missing = (rule.values || []).filter((part) => !valueTokens.includes(String(part)));
    if (missing.length) {
      status = "fail";
      reasons.push("Missing: " + missing.join(", "));
    }
  } else if (type === "token_set" && typeof rule === "object") {
    const expected = rule.tokens || [];
    const actual = (lineValue || "").split(/\s+/).filter(Boolean);
    const missing = expected.filter((t) => !actual.includes(t));
    const extras = actual.filter((t) => !expected.includes(t));
    if (missing.length || extras.length) {
      status = "fail";
      if (missing.length) reasons.push("Missing: " + missing.join(", "));
      if (extras.length) reasons.push("Unexpected: " + extras.join(", "));
    }
  } else if (type === "positional" && typeof rule === "object") {
    const pos = Array.isArray(rule.pos) ? rule.pos : [];
    for (const entry of pos) {
      const idx = entry.index;
      const allowed = Array.isArray(entry.allowed) ? entry.allowed.map((x) => String(x)) : null;
      if (idx == null || allowed == null) continue;
      const token = remTokens[idx];
      if (!token || !allowed.includes(String(token))) {
        status = "fail";
        reasons.push(`Position ${idx} must be one of: ${allowed.join(", ")}`);
      }
    }
  } else if (type === "review" && typeof rule === "object") {
    status = "review";
    reasons.push(ruleNote ? `Manual review: ${ruleNote}` : "Manual review required");
  }

  if (ruleNote && type !== "review") {
    reasons.push(`Note: ${ruleNote}`);
  }

  return { status, reasons, required: typeof rule === "object" && rule.required };
}

/* ── Core validator ──────────────────────────────────────────── */
function applyRules(rules, cfgText) {
  const lines = cfgText.split(/\r?\n/);
  const results = [];
  const allowedHashes = (rules.firmware && rules.firmware.allowed_git_hashes) || [];
  const ruleMapLower = new Map();
  for (const [k, v] of Object.entries(rules.rules || {})) {
    ruleMapLower.set(k.toLowerCase(), v);
  }

  let gitHash = null, gitLineIndex = null;
  const gitRegex = /\(([0-9A-Fa-f]{7,40})\)/;
  lines.forEach((raw, idx) => {
    const m = raw.match(gitRegex);
    if (m) { gitHash = m[1]; gitLineIndex = idx; }
  });

  let gitOk = true, gitReason = null;
  if (gitHash && allowedHashes.length) {
    gitOk = allowedHashes.some((h) => h.startsWith(gitHash));
    if (!gitOk) gitReason = "Firmware hash not allowed: " + gitHash;
  }

  const seenParamsLower = new Set();

  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    let status = "pass";
    let reasons = [];
    let paramName = null;
    let paramValue = null;
    let lineValue = "";

    const tokens = trimmed.split(/\s+/);
    const keyInfo = extractRuleKey(trimmed);
    const ruleKey = keyInfo ? keyInfo.key : null;
    let remainderTokens = tokens.slice(keyInfo ? keyInfo.used : 0);

    if (trimmed.startsWith("set ")) {
      const m = trimmed.match(/^set\s+(\S+)\s*=\s*(.+)$/);
      if (m) {
        paramName = `set ${m[1]}`.toLowerCase();
        paramValue = m[2].trim();
      }
    }

    if (ruleKey) {
      if (remainderTokens[0] === "=") remainderTokens = remainderTokens.slice(1);
      const originalRemainder = remainderTokens.join(" ").trim();

      const candidates = [];
      for (let len = tokens.length; len >= 1; len--) {
        const candidateKey = tokens.slice(0, len).join(" ");
        const candidateRule = ruleMapLower.get(candidateKey.toLowerCase());
        const requiredLen =
          candidateRule && typeof candidateRule === "object" && candidateRule.token_length
            ? candidateRule.token_length
            : len;
        if (candidateRule && requiredLen === len) {
          candidates.push({ key: candidateKey, used: len, rule: candidateRule });
          break;
        }
      }

      if (candidates.length) {
        const matchedKey = candidates[0].key.toLowerCase();
        const matchedUsed = candidates[0].used;
        remainderTokens = tokens.slice(matchedUsed);
        if (remainderTokens[0] === "=") remainderTokens = remainderTokens.slice(1);
        const remainder = remainderTokens.join(" ").trim();
        if (!paramName) paramName = matchedKey;
        if (!paramValue) paramValue = remainder;
        lineValue = paramValue || remainder || "";
        seenParamsLower.add(matchedKey);

        const evalRes = evaluateRule(candidates[0].rule, lineValue, trimmed, remainderTokens);
        status = evalRes.status;
        reasons.push(...evalRes.reasons);
      } else if (trimmed !== "") {
        if (!paramName) paramName = ruleKey.toLowerCase();
        if (!paramValue) paramValue = originalRemainder;
        lineValue = paramValue || originalRemainder || "";
        status = "fail";
        reasons.push("No rule defined for this line");
      }
    } else if (trimmed !== "") {
      status = "fail";
      reasons.push("No rule defined for this line");
    }

    results.push({ line: raw, trimmed, idx, status, reasons, paramName, paramValue });
  });

  const missingRequired = [];
  if (rules.rules) {
    for (const [pname, rule] of Object.entries(rules.rules)) {
      const required =
        (typeof rule === "string" && rule === "required") ||
        (typeof rule === "object" && rule.required);
      if (required && !seenParamsLower.has(pname.toLowerCase())) {
        missingRequired.push(pname);
      }
    }
  }

  return { results, gitOk, gitReason, gitLineIndex, missingRequired };
}
