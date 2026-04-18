/* -------------------------------------------------------------
        Utilities
      ------------------------------------------------------------- */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Safe for attribute values (escapes quotes and newlines too)
function escapeAttr(s) {
  return escapeHtml(String(s || ""))
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "&#10;");
}

// Normalize ruleset keys to lowercase and drop duplicates (first wins)
function normalizeRuleset(input) {
  if (!input || typeof input !== "object") return input;
  const out = { ...input };
  const rules =
    input.rules && typeof input.rules === "object" ? input.rules : {};
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

function ensureNormalizedRuleset() {
  if (!ruleset) return;
  ruleset = normalizeRuleset(ruleset);
  syncRulesetToTextarea();
}

// Read a file into the given textarea
function readFileIntoTarget(file, target) {
  if (!file || !target) return;
  const reader = new FileReader();
  reader.onload = (ev) => (target.value = ev.target.result || "");
  reader.readAsText(file);
}

// Simple drag/drop helper so files can be dropped or clicked to choose a file
function setupDropzone(zone, target, options = {}) {
  if (!zone) return;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  if (options.accept) {
    fileInput.accept = options.accept;
  }
  fileInput.style.display = "none";
  zone.appendChild(fileInput);

  const openPicker = () => {
    fileInput.value = "";
    fileInput.click();
  };

  zone.tabIndex = 0;
  zone.setAttribute("role", "button");
  zone.addEventListener("click", openPicker);
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    readFileIntoTarget(file, target);
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    readFileIntoTarget(file, target);
  });
}

setupDropzone(
  document.getElementById("dropRules"),
  document.getElementById("rulesText"),
  { accept: ".json,application/json" },
);
setupDropzone(
  document.getElementById("dropConfig"),
  document.getElementById("configText"),
);

/* -------------------------------------------------------------
        Global state
      ------------------------------------------------------------- */
let ruleset = null;
let lastConfigText = "";
let lastValidation = null;
let selectedParamName = null;
let selectedParamLastValue = "";
let lastSelectedLineElem = null;
let lineTokenCache = new Map();
let lastSelectedTokens = [];
let selectedLineIdx = null;
let lastRemainderTokens = [];
let currentSearchTerm = "";
let isNewRuleSelection = false;
let hasEditedNewRuleEquals = false;
let suppressRuleValueInputTracking = false;

function getSelectedTokenLength() {
  const radio = document.querySelector(
    "#ruleTokenLengthGroup input[name='tokenLength']:checked",
  );
  return parseInt(radio ? radio.value : "2", 10) || 2;
}

function setTokenLengthUI(tokenLen) {
  document
    .querySelectorAll("#ruleTokenLengthGroup .token-chip")
    .forEach((label) => {
      const inp = label.querySelector("input");
      if (inp) {
        inp.checked = String(tokenLen) === inp.value;
        label.classList.toggle("active", inp.checked);
      }
    });
}

function buildKeyPreview(paramName, tokenLen, tokensOverride) {
  const lineTokens = tokensOverride || lineTokenCache.get(paramName);
  if (!lineTokens) return "";
  const key = lineTokens.slice(0, tokenLen).join(" ");
  const rem = lineTokens.slice(tokenLen).join(" ");
  return { key, rem };
}

function normalizeLineTokens(trimmed) {
  if (!trimmed) return [];
  return (
    trimmed
      .split(/\s+/)
      .filter(Boolean)
      // Standalone assignment separators are syntax, not meaningful tokens.
      .filter((token) => token !== "=")
  );
}

function setRuleValueInputValue(value) {
  const input = document.getElementById("ruleValueInput");
  if (!input) return;
  suppressRuleValueInputTracking = true;
  input.value = value;
  suppressRuleValueInputTracking = false;
}

function updateRuleMissingNotice() {
  const notice = document.getElementById("ruleMissingNotice");
  if (!notice) return;
  if (!isNewRuleSelection || !selectedParamName) {
    notice.style.display = "none";
    notice.innerHTML = "";
    return;
  }

  const type = document.getElementById("ruleTypeSelect")?.value || "allowed";
  const showEqualsHint = type === "equals" && !hasEditedNewRuleEquals;
  notice.style.display = "block";
  notice.innerHTML = `
          <strong>New rule</strong> No matching rule found. Save to create one.
          ${
            showEqualsHint
              ? '<br /><small class="hint">Equals value updates from the current remainder until edited.</small>'
              : ""
          }
        `;
}

function syncNewRuleEqualsValue() {
  if (!isNewRuleSelection || hasEditedNewRuleEquals || !selectedParamName) {
    return;
  }
  const type = document.getElementById("ruleTypeSelect")?.value;
  if (type !== "equals") return;
  const preview = buildKeyPreview(
    selectedParamName,
    getSelectedTokenLength(),
    lastSelectedTokens,
  );
  setRuleValueInputValue(preview?.rem || "");
}

// Show which token each positional constraint would look at
function updatePosPreviews(remainderTokens) {
  const rows = document.querySelectorAll("#posRows .pos-row");
  rows.forEach((row) => {
    const idxVal = row.querySelector(".pos-index")?.value ?? "";
    const idx = parseInt(idxVal, 10);
    const preview = row.querySelector(".pos-preview");
    if (preview) {
      const tok =
        remainderTokens && !Number.isNaN(idx) && remainderTokens.length > idx
          ? remainderTokens[idx]
          : "";
      preview.textContent = tok;
    }
  });
}

// Render positional constraints table; always keep at least one row visible
function renderPosRows(posList, remainderTokens) {
  const container = document.getElementById("posRows");
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(posList) || posList.length === 0) {
    addEmptyPosRow(remainderTokens);
    updatePosPreviews(remainderTokens);
    return;
  }
  posList.forEach((entry) => {
    const row = document.createElement("tr");
    row.className = "pos-row";
    const previewTok =
      remainderTokens && remainderTokens.length > entry.index
        ? remainderTokens[entry.index]
        : "";
    row.innerHTML = `
      <td><input class="pos-index" type="number" value="${escapeHtml(
        String(entry.index ?? ""),
      )}" placeholder="index" /></td>
      <td class="pos-preview">${escapeHtml(String(previewTok || ""))}</td>
      <td><input class="pos-allowed" type="text" value="${escapeHtml(
        (entry.allowed || []).join(","),
      )}" placeholder="allowed tokens" /></td>
      <td><button type="button" class="btn btn-secondary btn-compact pos-remove">Del</button></td>
    `;
    row
      .querySelector(".pos-index")
      .addEventListener("input", () => updatePosPreviews(lastRemainderTokens));
    row.querySelector(".pos-remove").addEventListener("click", () => {
      row.remove();
      if (!container.querySelector(".pos-row"))
        addEmptyPosRow(lastRemainderTokens);
      updatePosPreviews(lastRemainderTokens);
    });
    container.appendChild(row);
  });
  updatePosPreviews(remainderTokens);
}

// Insert a blank positional row and wire up its events
function addEmptyPosRow(remainderTokens) {
  const container = document.getElementById("posRows");
  if (!container) return;
  const row = document.createElement("tr");
  row.className = "pos-row";
  row.innerHTML = `
    <td><input class="pos-index" type="number" placeholder="index" /></td>
    <td class="pos-preview"></td>
    <td><input class="pos-allowed" type="text" placeholder="allowed tokens" /></td>
    <td><button type="button" class="btn btn-secondary btn-compact pos-remove">Del</button></td>
  `;
  row
    .querySelector(".pos-index")
    .addEventListener("input", () => updatePosPreviews(lastRemainderTokens));
  row.querySelector(".pos-remove").addEventListener("click", () => {
    row.remove();
    if (!container.querySelector(".pos-row"))
      addEmptyPosRow(lastRemainderTokens);
    updatePosPreviews(lastRemainderTokens);
  });
  container.appendChild(row);
}

// Collect positional rows back into structured data
function readPosRows() {
  const container = document.getElementById("posRows");
  if (!container) return [];
  const rows = Array.from(container.querySelectorAll(".pos-row"));
  const pos = [];
  rows.forEach((row) => {
    const idxVal = row.querySelector(".pos-index")?.value ?? "";
    const allowedVal = row.querySelector(".pos-allowed")?.value ?? "";
    if (idxVal === "" || allowedVal.trim() === "") return;
    const idx = parseInt(idxVal, 10);
    if (Number.isNaN(idx)) return;
    const allowed = allowedVal
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.length) return;
    pos.push({ index: idx, allowed });
  });
  return pos;
}

/* -------------------------------------------------------------
        Rule key helpers (literal prefixes)
      -------------------------------------------------------------- */
// Derive the rule lookup key from the start of a config line, respecting token_length
function extractRuleKey(trimmed, tokenLengthOverride) {
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);

  // Special cases keep stable keys regardless of extra tokens
  if (tokens[0] === "set" && tokens[1]) {
    const len = tokenLengthOverride || 2;
    const key = tokens.slice(0, len).join(" ");
    return { key, used: len, tokens };
  }
  if (tokens[0] === "resource" && tokens[1] && tokens[2]) {
    const len = tokenLengthOverride || 3;
    const key = tokens.slice(0, len).join(" ");
    return { key, used: len, tokens };
  }

  const len = tokenLengthOverride || Math.min(tokens.length, 4);
  const key = tokens.slice(0, len).join(" ");
  return { key, used: len, tokens };
}

// Evaluate a single rule against one config line and return pass/fail reasons
function evaluateRule(rule, lineValue, fullLine, remainderTokens) {
  let status = "pass";
  const reasons = [];
  const type = typeof rule === "object" ? rule.rule || "allowed" : rule;
  const ruleNote =
    typeof rule === "object" && rule.note ? String(rule.note) : "";
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
  } else if (type === "nonzero") {
    if (String(lineValue) === "0") {
      status = "fail";
      reasons.push("Value must be nonzero");
    }
  } else if (type === "contains_all" && typeof rule === "object") {
    const missing = (rule.contains_all || []).filter(
      (part) => !fullLine.includes(part),
    );
    if (missing.length) {
      status = "fail";
      reasons.push("Missing: " + missing.join(", "));
    }
  } else if (type === "contains_any" && typeof rule === "object") {
    const list = rule.contains_any || [];
    if (!list.some((part) => fullLine.includes(part))) {
      status = "fail";
      reasons.push("Must contain one of: " + list.join(", "));
    }
  } else if (type === "contains_exact" && typeof rule === "object") {
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
      const allowed = Array.isArray(entry.allowed)
        ? entry.allowed.map((x) => String(x))
        : null;
      if (idx == null || allowed == null) continue;
      const token = remTokens[idx];
      if (!token || !allowed.includes(String(token))) {
        status = "fail";
        reasons.push(`Position ${idx} must be one of: ${allowed.join(", ")}`);
      }
    }
  } else if (type === "review" && typeof rule === "object") {
    status = "review";
    if (ruleNote) reasons.push(`Manual review: ${ruleNote}`);
    else reasons.push("Manual review required");
  }

  if (ruleNote && type !== "review") {
    reasons.push(`Note: ${ruleNote}`);
  }

  const required = typeof rule === "object" && rule.required;
  return { status, reasons, required };
}

/* -------------------------------------------------------------
        Core validation with prescriptive rules
      -------------------------------------------------------------- */
// Main validator: walks config lines, matches rules, and records any failures
function applyRules(rules, cfgText) {
  const lines = cfgText.split(/\r?\n/);
  const results = [];
  const allowedHashes =
    (rules.firmware && rules.firmware.allowed_git_hashes) || [];
  const ruleMap = rules.rules || {};
  const ruleMapLower = new Map();
  for (const [k, v] of Object.entries(ruleMap)) {
    ruleMapLower.set(k.toLowerCase(), v);
  }

  // detect git hash
  let gitHash = null,
    gitLineIndex = null;
  const gitRegex = /\(([0-9A-Fa-f]{7,40})\)/;
  lines.forEach((raw, idx) => {
    const m = raw.match(gitRegex);
    if (m) {
      gitHash = m[1];
      gitLineIndex = idx;
    }
  });

  let gitOk = true;
  let gitReason = null;
  if (gitHash && allowedHashes.length) {
    gitOk = allowedHashes.some((h) => h.startsWith(gitHash));
    if (!gitOk) gitReason = "Firmware hash not allowed: " + gitHash;
  }

  const seenParams = new Set();
  const seenParamsLower = new Set();

  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    let status = "pass";
    let reasons = [];
    let paramName = null;
    let paramValue = null;
    let lineValue = "";

    // derive rule key
    let tokens = trimmed.split(/\s+/);
    let keyInfo = extractRuleKey(trimmed);
    let ruleKey = keyInfo ? keyInfo.key : null;
    let remainderTokens = tokens.slice(keyInfo ? keyInfo.used : 0);

    // parse "set" lines for value
    if (trimmed.startsWith("set ")) {
      const m = trimmed.match(/^set\s+(\S+)\s*=\s*(.+)$/);
      if (m) {
        paramName = `set ${m[1]}`.toLowerCase();
        paramValue = m[2].trim();
      }
    }

    // Generic rule evaluation
    if (ruleKey) {
      if (remainderTokens[0] === "=")
        remainderTokens = remainderTokens.slice(1);
      let matchedKey = ruleKey;
      let matchedUsed = keyInfo.used;
      const originalRemainder = remainderTokens.join(" ").trim();

      // longest-to-shorter prefix match respecting token_length
      const candidates = [];
      for (let len = tokens.length; len >= 1; len--) {
        const candidateKey = tokens.slice(0, len).join(" ");
        const candidateRule = ruleMapLower.get(candidateKey.toLowerCase());
        const requiredLen =
          candidateRule &&
          typeof candidateRule === "object" &&
          candidateRule.token_length
            ? candidateRule.token_length
            : len;
        if (candidateRule && requiredLen === len) {
          candidates.push({
            key: candidateKey,
            used: len,
            rule: candidateRule,
          });
          break;
        }
      }

      if (candidates.length) {
        matchedKey = candidates[0].key.toLowerCase();
        matchedUsed = candidates[0].used;
        remainderTokens = tokens.slice(matchedUsed);
        if (remainderTokens[0] === "=")
          remainderTokens = remainderTokens.slice(1);
        const remainder = remainderTokens.join(" ").trim();
        if (!paramName) paramName = matchedKey;
        if (!paramValue) paramValue = remainder;
        lineValue = paramValue || remainder || "";
        seenParams.add(matchedKey);
        seenParamsLower.add(matchedKey);

        const rule = candidates[0].rule;
        const evalRes = evaluateRule(rule, lineValue, trimmed, remainderTokens);
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

    results.push({
      line: raw,
      trimmed,
      idx,
      status,
      reasons,
      paramName,
      paramValue,
    });
  });

  // required parameters that are missing
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

/* -------------------------------------------------------------
        Rendering
      -------------------------------------------------------------- */
// Render status badges plus the merged config view (including synthetic missing rules)
function renderResults(data) {
  const panel = document.getElementById("resultsPanel");
  const badge = document.getElementById("statusBadge");
  const errors = document.getElementById("errorList");
  const output = document.getElementById("configOutput");

  panel.style.display = "block";
  errors.innerHTML = "";

  if (!data.gitOk && data.gitReason) {
    errors.innerHTML += `<div>• ${escapeHtml(data.gitReason)}</div>`;
  }

  const hasFail =
    !data.gitOk ||
    (data.missingRequired && data.missingRequired.length > 0) ||
    data.results.some((r) => r.status === "fail");
  const hasReview = data.results.some((r) => r.status === "review");

  let statusLabel = "";
  let statusMessage = "";
  let badgeClass = "badge-neutral";

  if (hasFail) {
    statusLabel = "FAIL";
    statusMessage = "Configuration has issues.";
    badgeClass = "badge-fail";
  } else if (hasReview) {
    statusLabel = "REVIEW";
    statusMessage = "Configuration needs manual review.";
    badgeClass = "badge-review";
  } else {
    statusLabel = "PASS";
    statusMessage = "Configuration is compliant.";
    badgeClass = "badge-pass";
  }

  badge.textContent = `${statusLabel} - ${statusMessage}`;
  badge.className = `badge ${badgeClass}`;
  badge.title = statusMessage;

  let html = "";
  if (data.missingRequired && data.missingRequired.length) {
    data.missingRequired.forEach((pname, idx) => {
      const syntheticLine = `[MISSING RULE] ${pname}`;
      const pnameLc = pname.toLowerCase();
      html += `<div class="line line-fail line-missing" data-param="${escapeAttr(
        pnameLc,
      )}" data-value="" data-tokens="${escapeAttr(
        pnameLc,
      )}" data-idx="missing-${idx}"><span class="line-text">${escapeHtml(
        syntheticLine,
      )}</span></div>`;
    });
  }
  data.results.forEach((r) => {
    if (r.trimmed === "") return; // skip blank lines in display
    let cls = "line";
    if (r.status === "pass") cls += " line-pass";
    else if (r.status === "review") cls += " line-review";
    else cls += " line-fail";

    if (!data.gitOk && r.idx === data.gitLineIndex) {
      cls = "line line-fail";
      r.reasons.push("Firmware hash not allowed");
    }

    const title = r.reasons.length
      ? `title="${escapeAttr(r.reasons.join("; "))}"`
      : "";

    const selectedClass =
      selectedParamName && selectedLineIdx === r.idx ? " line-selected" : "";
    const dataAttrs = r.paramName
      ? ` data-param="${escapeAttr(r.paramName)}" data-value="${escapeAttr(
          r.paramValue || "",
        )}" data-tokens="${escapeAttr(
          normalizeLineTokens(r.trimmed).join(" "),
        )}" data-idx="${r.idx}"`
      : ` data-idx="${r.idx}"`;
    html += `<div class="${cls}${selectedClass}" ${title}${dataAttrs}><span class="line-text">${escapeHtml(
      r.line,
    )}</span></div>`;
  });

  output.innerHTML = html;
  // update selected line reference
  if (selectedParamName && selectedLineIdx !== null) {
    const selectedEl = output.querySelector(
      `.line[data-idx="${selectedLineIdx}"]`,
    );
    lastSelectedLineElem = selectedEl || null;
  } else {
    lastSelectedLineElem = null;
  }
  lastValidation = data;
  applySearchFilter();
}

function showEmptyResults(reason, badgeSummary) {
  const panel = document.getElementById("resultsPanel");
  const badge = document.getElementById("statusBadge");
  const errors = document.getElementById("errorList");
  const output = document.getElementById("configOutput");

  panel.style.display = "block";
  panel.classList.remove("hidden-pass");
  badge.textContent = badgeSummary || reason;
  badge.className = "badge badge-neutral";
  badge.title = reason;
  errors.innerHTML = "";
  output.innerHTML = `<div class="placeholder">${escapeHtml(reason)}</div>`;
  lastValidation = null;
  applySearchFilter();
}

function applySearchFilter() {
  const term = currentSearchTerm.trim().toLowerCase();
  const clearBtn = document.getElementById("clearSearch");
  if (clearBtn) {
    clearBtn.classList.toggle("hidden", term.length === 0);
  }
  const lines = document.querySelectorAll("#configOutput .line");
  if (!lines.length) return;
  lines.forEach((line) => {
    if (!term) {
      line.style.display = "";
      return;
    }
    const text = line.textContent.toLowerCase();
    line.style.display = text.includes(term) ? "" : "none";
  });
}

function updateEmptyState() {
  if (lastValidation) return;
  const hasRules = document.getElementById("rulesText").value.trim().length > 0;
  const hasConfig =
    document.getElementById("configText").value.trim().length > 0;

  let msg =
    "Waiting for input: paste or drop a ruleset JSON and a config export, then click Validate.";
  let badgeMsg = "Waiting - Provide ruleset and config";
  if (hasRules && hasConfig) {
    msg = "Ready: click Validate to run checks.";
    badgeMsg = "Ready - Click Validate";
  } else if (hasRules && !hasConfig) {
    msg = "Config missing: drop or paste a config export.";
    badgeMsg = "Waiting - Config missing";
  } else if (!hasRules && hasConfig) {
    msg = "Ruleset missing: drop or paste your ruleset JSON.";
    badgeMsg = "Waiting - Ruleset missing";
  }
  showEmptyResults(msg, badgeMsg);
}

function focusRuleEditor() {
  const panel = document.getElementById("rulePanel");
  if (panel) {
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  const ruleSelect = document.getElementById("ruleTypeSelect");
  if (ruleSelect && ruleSelect.focus) {
    ruleSelect.focus({ preventScroll: true });
  }
}

/* -------------------------------------------------------------
        Rule editor – load/save from UI
      ------------------------------------------------------------- */
function loadRulesetFromTextarea() {
  const txt = document.getElementById("rulesText").value.trim();
  if (!txt) {
    alert("Please load or paste a ruleset JSON first.");
    updateEmptyState();
    return false;
  }
  try {
    ruleset = normalizeRuleset(JSON.parse(txt));
    syncRulesetToTextarea();
  } catch (e) {
    alert("Invalid ruleset JSON:\n" + e.message);
    updateEmptyState();
    return false;
  }
  return true;
}

function syncRulesetToTextarea() {
  if (!ruleset) return;
  document.getElementById("rulesText").value = JSON.stringify(ruleset, null, 2);
}

// structured UI removed

/* Parameter rule editor */
// Populate the rule editor panel for a clicked config line (or missing rule)
function openRuleEditorForParam(paramName, currentValue) {
  if (!ruleset) {
    const raw = document.getElementById("rulesText").value.trim();
    if (raw) {
      try {
        ruleset = normalizeRuleset(JSON.parse(raw));
        syncRulesetToTextarea();
      } catch (e) {
        alert("Invalid ruleset JSON:\n" + e.message);
        updateEmptyState();
        return;
      }
    } else {
      ruleset = { rules: {} };
      syncRulesetToTextarea();
    }
  }
  if (!ruleset.rules) ruleset.rules = {};
  ensureNormalizedRuleset();
  const paramKey = paramName.toLowerCase();
  selectedParamName = paramKey;
  selectedParamLastValue = currentValue || "";

  const ruleSelect = document.getElementById("ruleTypeSelect");
  const valInput = document.getElementById("ruleValueInput");
  const containsInput = document.getElementById("ruleContainsInput");
  const reviewInput = document.getElementById("ruleReviewNote");
  const valGroup = document.getElementById("ruleValueGroup");
  const containsGroup = document.getElementById("ruleContainsGroup");
  const reqCheckbox = document.getElementById("ruleRequiredCheckbox");
  const posGroup = document.getElementById("rulePositionalGroup");
  const tokensForLine = lastSelectedTokens.length
    ? lastSelectedTokens
    : lineTokenCache.get(paramName) || paramName.split(/\s+/);
  lineTokenCache.set(paramName, tokensForLine);
  lastSelectedTokens = tokensForLine;

  const rule = (ruleset.rules && ruleset.rules[paramKey]) || null;
  isNewRuleSelection = rule == null;
  hasEditedNewRuleEquals = false;
  let type = "allowed";
  let required = false;
  let value = "";
  let containsList = [];
  let tokenLen = 2;
  let posList = [];
  let ruleNote = "";

  if (rule == null) {
    type = "allowed";
    required = false;
    value = currentValue || "";
    tokenLen = tokensForLine.length >= 2 ? 2 : tokensForLine.length || 1;
  } else if (typeof rule === "string") {
    if (rule === "allowed") type = "allowed";
    else if (rule === "forbidden") type = "forbidden";
    else if (rule === "required") {
      type = "allowed";
      required = true;
    }
  } else if (typeof rule === "object") {
    type = rule.rule || "allowed";
    required = !!rule.required;
    if (rule.note != null) {
      ruleNote = String(rule.note);
    }
    if (type === "equals" && rule.value != null) {
      value = String(rule.value);
    } else if (type === "contains_all" && Array.isArray(rule.contains_all)) {
      containsList = rule.contains_all;
    } else if (type === "contains_any" && Array.isArray(rule.contains_any)) {
      containsList = rule.contains_any;
    } else if (type === "contains_exact" && Array.isArray(rule.tokens)) {
      containsList = rule.tokens;
    } else if (type === "positional" && Array.isArray(rule.pos)) {
      posList = rule.pos;
    }
    if (rule.token_length) {
      tokenLen = rule.token_length;
    }
  }

  const remainderTokens = tokensForLine.slice(tokenLen);
  lastRemainderTokens = remainderTokens;

  ruleSelect.value = type;
  reqCheckbox.checked = required;
  setRuleValueInputValue(value);
  valGroup.style.display = type === "equals" ? "block" : "none";
  containsInput.value = containsList.join(",");
  containsGroup.style.display =
    type === "contains_all" ||
    type === "contains_any" ||
    type === "contains_exact"
      ? "block"
      : "none";
  reviewInput.value = ruleNote;
  posGroup.style.display = type === "positional" ? "block" : "none";
  setTokenLengthUI(tokenLen);
  const preview = buildKeyPreview(paramName, tokenLen, tokensForLine);
  document.getElementById("selectedParamName").textContent =
    preview.key || "(none)";
  const remEl = document.getElementById("selectedParamRemainder");
  if (preview.rem) {
    remEl.style.display = "inline-flex";
    remEl.textContent = preview.rem;
  } else {
    remEl.style.display = "none";
  }
  renderPosRows(posList, remainderTokens);
  updateRuleMissingNotice();
  document.getElementById("rulePanel").classList.add("active-highlight");
  focusRuleEditor();
}

document.getElementById("ruleTypeSelect").addEventListener("change", () => {
  const type = document.getElementById("ruleTypeSelect").value;
  const valGroup = document.getElementById("ruleValueGroup");
  const containsGroup = document.getElementById("ruleContainsGroup");
  const posGroup = document.getElementById("rulePositionalGroup");
  valGroup.style.display = type === "equals" ? "block" : "none";
  containsGroup.style.display =
    type === "contains_all" ||
    type === "contains_any" ||
    type === "contains_exact"
      ? "block"
      : "none";
  posGroup.style.display = type === "positional" ? "block" : "none";
  if (selectedParamName) {
    const preview = buildKeyPreview(
      selectedParamName,
      getSelectedTokenLength(),
      lastSelectedTokens,
    );
    document.getElementById("selectedParamName").textContent =
      preview.key || "(none)";
    const remEl = document.getElementById("selectedParamRemainder");
    if (preview.rem) {
      remEl.style.display = "inline-flex";
      remEl.textContent = preview.rem;
    } else {
      remEl.style.display = "none";
    }
  }
  syncNewRuleEqualsValue();
  updateRuleMissingNotice();
});

document.getElementById("ruleValueInput").addEventListener("input", () => {
  if (suppressRuleValueInputTracking || !isNewRuleSelection) return;
  hasEditedNewRuleEquals = true;
  updateRuleMissingNotice();
});

document
  .getElementById("ruleTokenLengthGroup")
  .addEventListener("change", (e) => {
    if (e.target.name !== "tokenLength") return;
    document
      .querySelectorAll("#ruleTokenLengthGroup .token-chip")
      .forEach((label) =>
        label.classList.toggle("active", label.querySelector("input").checked),
      );
    const tokenLen = getSelectedTokenLength();
    lastRemainderTokens = lastSelectedTokens.slice(tokenLen);
    updatePosPreviews(lastRemainderTokens);
    if (selectedParamName) {
      const preview = buildKeyPreview(
        selectedParamName,
        tokenLen,
        lastSelectedTokens,
      );
      document.getElementById("selectedParamName").textContent =
        preview.key || "(none)";
      const remEl = document.getElementById("selectedParamRemainder");
      if (preview.rem) {
        remEl.style.display = "inline-flex";
        remEl.textContent = preview.rem;
      } else {
        remEl.style.display = "none";
      }
    }
    syncNewRuleEqualsValue();
    updateRuleMissingNotice();
  });

document.getElementById("addPosRowBtn").addEventListener("click", () => {
  addEmptyPosRow(lastRemainderTokens);
});

document.getElementById("saveParamRuleBtn").addEventListener("click", () => {
  if (!ruleset || !selectedParamName) return;
  if (!ruleset.rules) ruleset.rules = {};
  const paramKey = selectedParamName.toLowerCase();

  const type = document.getElementById("ruleTypeSelect").value;
  const val = document.getElementById("ruleValueInput").value.trim();
  const contains = document
    .getElementById("ruleContainsInput")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ruleNote = document.getElementById("ruleReviewNote").value.trim();
  const hasNote = ruleNote.length > 0;
  const required = document.getElementById("ruleRequiredCheckbox").checked;
  const tokenLen = getSelectedTokenLength();
  const pos = readPosRows();
  const baseTokens = lastSelectedTokens.length
    ? lastSelectedTokens
    : selectedParamName.split(/\s+/);
  const newKey = baseTokens.slice(0, tokenLen).join(" ");
  const newKeyLc = newKey.toLowerCase();
  const remainder = baseTokens.slice(tokenLen).join(" ");

  let ruleObj;

  const needsObject = required || type !== "allowed" || hasNote;

  if (type === "allowed" && !needsObject) {
    ruleObj = "allowed";
  } else {
    ruleObj = { rule: type };
    if (type === "equals") ruleObj.value = val;
    if (type === "contains_all") ruleObj.contains_all = contains;
    if (type === "contains_any") ruleObj.contains_any = contains;
    if (type === "contains_exact") ruleObj.tokens = contains;
    if (type === "positional") ruleObj.pos = pos;
    if (hasNote) ruleObj.note = ruleNote;
    const shouldPersistTokenLength =
      (type !== "allowed" && type !== "forbidden") || required || hasNote;
    if (shouldPersistTokenLength) {
      ruleObj.token_length = tokenLen;
    }
    if (required) ruleObj.required = true;
  }

  if (selectedParamName !== newKeyLc) {
    delete ruleset.rules[paramKey];
    if (lastSelectedLineElem)
      lastSelectedLineElem.classList.remove("line-selected");
    selectedParamName = newKeyLc;
    document.getElementById("selectedParamName").textContent = newKey;
  }

  ruleset.rules[newKeyLc] = ruleObj;
  isNewRuleSelection = false;
  hasEditedNewRuleEquals = false;
  lineTokenCache.set(newKeyLc, baseTokens);
  lastSelectedTokens = baseTokens;

  syncRulesetToTextarea();
  if (lastConfigText) {
    const res = applyRules(ruleset, lastConfigText);
    renderResults(res);
  }
  const ruleNotice = document.getElementById("ruleMissingNotice");
  if (ruleNotice) {
    ruleNotice.style.display = "none";
    ruleNotice.innerHTML = "";
  }
});

document.getElementById("deleteParamRuleBtn").addEventListener("click", () => {
  if (!ruleset || !selectedParamName || !ruleset.rules) return;
  if (!confirm("Delete rule for " + selectedParamName + "?")) return;
  delete ruleset.rules[selectedParamName.toLowerCase()];
  selectedParamName = null;
  selectedParamLastValue = "";
  selectedLineIdx = null;
  lastSelectedTokens = [];
  lastRemainderTokens = [];
  isNewRuleSelection = false;
  hasEditedNewRuleEquals = false;
  if (lastSelectedLineElem)
    lastSelectedLineElem.classList.remove("line-selected");
  lastSelectedLineElem = null;
  document.getElementById("rulePanel").classList.remove("active-highlight");
  document.getElementById("selectedParamName").textContent = "(none)";
  document.getElementById("selectedParamRemainder").style.display = "none";
  const ruleNotice = document.getElementById("ruleMissingNotice");
  if (ruleNotice) {
    ruleNotice.style.display = "none";
    ruleNotice.innerHTML = "";
  }
  document.getElementById("ruleTypeSelect").value = "allowed";
  document.getElementById("ruleValueInput").value = "";
  document.getElementById("ruleContainsInput").value = "";
  document.getElementById("ruleReviewNote").value = "";
  document.getElementById("ruleRequiredCheckbox").checked = false;
  document.getElementById("ruleValueGroup").style.display = "none";
  document.getElementById("ruleContainsGroup").style.display = "none";
  syncRulesetToTextarea();
  if (lastConfigText) {
    const res = applyRules(ruleset, lastConfigText);
    renderResults(res);
  }
});

/* -------------------------------------------------------------
        Wiring: validation + export + structured buttons
      ------------------------------------------------------------- */
document.getElementById("validateBtn").addEventListener("click", () => {
  if (!loadRulesetFromTextarea()) return;

  const cfg = document.getElementById("configText").value.trim();
  if (!cfg) {
    alert("Please load or paste a competitor config.");
    updateEmptyState();
    return;
  }
  lastConfigText = cfg;
  const res = applyRules(ruleset, cfg);
  renderResults(res);
  document.getElementById("hidePassing").checked = true;
  document.getElementById("resultsPanel").classList.add("hidden-pass");
});

document.getElementById("hidePassing").addEventListener("change", (e) => {
  document
    .getElementById("resultsPanel")
    .classList.toggle("hidden-pass", e.target.checked);
});

const searchInput = document.getElementById("configSearch");
const clearSearchBtn = document.getElementById("clearSearch");

if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    currentSearchTerm = e.target.value;
    applySearchFilter();
  });
}

if (clearSearchBtn) {
  clearSearchBtn.addEventListener("click", () => {
    currentSearchTerm = "";
    if (searchInput) searchInput.value = "";
    applySearchFilter();
    if (searchInput && searchInput.focus) {
      searchInput.focus({ preventScroll: true });
    }
  });
}

document.getElementById("exportRulesBtn").addEventListener("click", () => {
  if (!ruleset && !loadRulesetFromTextarea()) return;
  if (ruleset) {
    ruleset = normalizeRuleset(ruleset);
    syncRulesetToTextarea();
  }
  // Deep copy and sort rules alphabetically
  const exportObj = JSON.parse(JSON.stringify(ruleset || {}));
  if (exportObj.rules && typeof exportObj.rules === "object") {
    const sorted = {};
    Object.keys(exportObj.rules)
      .sort((a, b) => a.localeCompare(b))
      .forEach((k) => (sorted[k] = exportObj.rules[k]));
    exportObj.rules = sorted;
  }

  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ruleset-updated.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

/* Click handler for config lines */
document.getElementById("configOutput").addEventListener("click", (e) => {
  const line = e.target.closest(".line[data-param]");
  if (!line) return;
  const param = line.dataset.param;
  const val = line.dataset.value || "";
  const tokens = line.dataset.tokens
    ? line.dataset.tokens.split(/\s+/)
    : param.split(/\s+/);
  const idxRaw = line.dataset.idx;
  const idx =
    idxRaw && idxRaw.startsWith("missing-") ? idxRaw : parseInt(idxRaw, 10);
  if (tokens.length) {
    lineTokenCache.set(param, tokens);
    lastSelectedTokens = tokens;
  }

  // toggle selection
  if (selectedParamName === param) {
    selectedParamName = null;
    selectedParamLastValue = "";
    selectedLineIdx = null;
    isNewRuleSelection = false;
    hasEditedNewRuleEquals = false;
    if (lastSelectedLineElem)
      lastSelectedLineElem.classList.remove("line-selected");
    lastSelectedLineElem = null;
    lastSelectedTokens = [];
    document.getElementById("rulePanel").classList.remove("active-highlight");
    document.getElementById("selectedParamName").textContent = "(none)";
    document.getElementById("selectedParamRemainder").style.display = "none";
    const ruleNotice = document.getElementById("ruleMissingNotice");
    if (ruleNotice) {
      ruleNotice.style.display = "none";
      ruleNotice.innerHTML = "";
    }
    document.getElementById("ruleTypeSelect").value = "allowed";
    document.getElementById("ruleValueInput").value = "";
    document.getElementById("ruleContainsInput").value = "";
    document.getElementById("ruleReviewNote").value = "";
    document.getElementById("ruleRequiredCheckbox").checked = false;
    document.getElementById("ruleValueGroup").style.display = "none";
    document.getElementById("ruleContainsGroup").style.display = "none";
    return;
  }

  if (lastSelectedLineElem)
    lastSelectedLineElem.classList.remove("line-selected");
  line.classList.add("line-selected");
  lastSelectedLineElem = line;
  selectedLineIdx = idx;

  openRuleEditorForParam(param, val);
});

["rulesText", "configText"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateEmptyState);
});

updateEmptyState();
setTokenLengthUI(2);
