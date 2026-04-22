/* ── Utilities ───────────────────────────────────────────────── */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(String(s || ""))
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "&#10;");
}

function ensureNormalizedRuleset() {
  if (!ruleset) return;
  ruleset = normalizeRuleset(ruleset);
  syncRulesetToTextarea();
}

function readFileIntoTarget(file, target) {
  if (!file || !target) return;
  const reader = new FileReader();
  reader.onload = (ev) => (target.value = ev.target.result || "");
  reader.readAsText(file);
}

function setupDropzone(zone, target, options = {}) {
  if (!zone) return;
  const container = options.container ?? zone.closest(".drop-container") ?? zone;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  if (options.accept) fileInput.accept = options.accept;
  fileInput.style.display = "none";
  zone.appendChild(fileInput);

  const openPicker = () => { fileInput.value = ""; fileInput.click(); };

  zone.tabIndex = 0;
  zone.setAttribute("role", "button");
  zone.addEventListener("click", openPicker);
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    readFileIntoTarget(file, target);
  });

  let dragDepth = 0;
  container.addEventListener("dragenter", () => {
    if (dragDepth++ === 0) zone.classList.add("dragover");
  });
  container.addEventListener("dragleave", () => {
    if (--dragDepth === 0) zone.classList.remove("dragover");
  });
  container.addEventListener("dragover", (e) => e.preventDefault());
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    zone.classList.remove("dragover");
    readFileIntoTarget(e.dataTransfer.files[0], target);
  });
}

/* ── DOM references ──────────────────────────────────────────── */
const el = {
  // Inputs
  rulesText:              document.getElementById("rulesText"),
  configText:             document.getElementById("configText"),
  dropRules:              document.getElementById("dropRules"),
  dropConfig:             document.getElementById("dropConfig"),
  // Results
  resultsPanel:           document.getElementById("resultsPanel"),
  statusBadge:            document.getElementById("statusBadge"),
  errorList:              document.getElementById("errorList"),
  configOutput:           document.getElementById("configOutput"),
  hidePassing:            document.getElementById("hidePassing"),
  configSearch:           document.getElementById("configSearch"),
  clearSearch:            document.getElementById("clearSearch"),
  // Rule editor
  rulesPanel:             document.getElementById("rulesPanel"),
  selectedParamName:      document.getElementById("selectedParamName"),
  selectedParamRemainder: document.getElementById("selectedParamRemainder"),
  ruleMissingNotice:      document.getElementById("ruleMissingNotice"),
  ruleTypeSelect:         document.getElementById("ruleTypeSelect"),
  ruleValueInput:         document.getElementById("ruleValueInput"),
  ruleValueGroup:         document.getElementById("ruleValueGroup"),
  ruleContainsInput:      document.getElementById("ruleContainsInput"),
  ruleContainsGroup:      document.getElementById("ruleContainsGroup"),
  ruleReviewNote:         document.getElementById("ruleReviewNote"),
  ruleRequiredCheckbox:   document.getElementById("ruleRequiredCheckbox"),
  rulePositionalGroup:    document.getElementById("rulePositionalGroup"),
  ruleTokenLengthGroup:   document.getElementById("ruleTokenLengthGroup"),
  posRows:                document.getElementById("posRows"),
  // Buttons
  validateBtn:            document.getElementById("validateBtn"),
  exportRulesBtn:         document.getElementById("exportRulesBtn"),
  saveParamRuleBtn:       document.getElementById("saveParamRuleBtn"),
  deleteParamRuleBtn:     document.getElementById("deleteParamRuleBtn"),
  addPosRowBtn:           document.getElementById("addPosRowBtn"),
  backToResultsBtn:       document.getElementById("backToResultsBtn"),
};

setupDropzone(el.dropRules, el.rulesText, { accept: ".json,application/json" });
setupDropzone(el.dropConfig, el.configText);

/* ── Global state ────────────────────────────────────────────── */
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

/* ── Token length UI ─────────────────────────────────────────── */
function getSelectedTokenLength() {
  const radio = el.ruleTokenLengthGroup.querySelector("input[name='tokenLength']:checked");
  return parseInt(radio ? radio.value : "2", 10) || 2;
}

function setTokenLengthUI(tokenLen) {
  el.ruleTokenLengthGroup.querySelectorAll(".token-chip").forEach((label) => {
    const inp = label.querySelector("input");
    if (inp) {
      inp.checked = String(tokenLen) === inp.value;
      label.classList.toggle("active", inp.checked);
    }
  });
}

/* ── Rule editor field helpers ───────────────────────────────── */
function buildKeyPreview(paramName, tokenLen, tokensOverride) {
  const lineTokens = tokensOverride || lineTokenCache.get(paramName);
  if (!lineTokens) return "";
  return {
    key: lineTokens.slice(0, tokenLen).join(" "),
    rem: lineTokens.slice(tokenLen).join(" "),
  };
}

function setRuleValueInputValue(value) {
  suppressRuleValueInputTracking = true;
  el.ruleValueInput.value = value;
  suppressRuleValueInputTracking = false;
}

function updateRuleMissingNotice() {
  if (!isNewRuleSelection || !selectedParamName) {
    el.ruleMissingNotice.style.display = "none";
    el.ruleMissingNotice.innerHTML = "";
    return;
  }
  const type = el.ruleTypeSelect.value || "allowed";
  const showEqualsHint = type === "equals" && !hasEditedNewRuleEquals;
  el.ruleMissingNotice.style.display = "block";
  el.ruleMissingNotice.innerHTML = `
    <strong>New rule</strong> No matching rule found. Save to create one.
    ${showEqualsHint ? '<br /><small class="hint">Equals value updates from the current remainder until edited.</small>' : ""}
  `;
}

function syncNewRuleEqualsValue() {
  if (!isNewRuleSelection || hasEditedNewRuleEquals || !selectedParamName) return;
  if (el.ruleTypeSelect.value !== "equals") return;
  const preview = buildKeyPreview(selectedParamName, getSelectedTokenLength(), lastSelectedTokens);
  setRuleValueInputValue(preview?.rem || "");
}

function updateBackBtn() {
  if (el.backToResultsBtn) el.backToResultsBtn.hidden = !selectedParamName;
}

function updateRuleEditorVisibility() {
  const type = el.ruleTypeSelect.value;
  el.ruleValueGroup.style.display = type === "equals" ? "block" : "none";
  el.ruleContainsGroup.style.display =
    type === "contains_all" || type === "contains_any" || type === "contains_exact"
      ? "block"
      : "none";
  el.rulePositionalGroup.style.display = type === "positional" ? "block" : "none";
}

function updateParamPreview(paramName, tokenLen, tokens) {
  const preview = buildKeyPreview(paramName, tokenLen, tokens);
  el.selectedParamName.textContent = preview.key || "(none)";
  if (preview.rem) {
    el.selectedParamRemainder.style.display = "inline-flex";
    el.selectedParamRemainder.textContent = preview.rem;
  } else {
    el.selectedParamRemainder.style.display = "none";
  }
}

/* ── Positional rows ─────────────────────────────────────────── */
function updatePosPreviews(remainderTokens) {
  el.posRows.querySelectorAll(".pos-row").forEach((row) => {
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

function addEmptyPosRow(remainderTokens) {
  const row = document.createElement("tr");
  row.className = "pos-row";
  row.innerHTML = `
    <td><input class="pos-index" type="number" placeholder="index" /></td>
    <td class="pos-preview"></td>
    <td><input class="pos-allowed" type="text" placeholder="allowed tokens" /></td>
    <td><button type="button" class="btn btn-secondary btn-compact pos-remove">Del</button></td>
  `;
  row.querySelector(".pos-index").addEventListener("input", () => updatePosPreviews(lastRemainderTokens));
  row.querySelector(".pos-remove").addEventListener("click", () => {
    row.remove();
    if (!el.posRows.querySelector(".pos-row")) addEmptyPosRow(lastRemainderTokens);
    updatePosPreviews(lastRemainderTokens);
  });
  el.posRows.appendChild(row);
}

function renderPosRows(posList, remainderTokens) {
  el.posRows.innerHTML = "";
  if (!Array.isArray(posList) || posList.length === 0) {
    addEmptyPosRow(remainderTokens);
    updatePosPreviews(remainderTokens);
    return;
  }
  posList.forEach((entry) => {
    const row = document.createElement("tr");
    row.className = "pos-row";
    const previewTok =
      remainderTokens && remainderTokens.length > entry.index ? remainderTokens[entry.index] : "";
    row.innerHTML = `
      <td><input class="pos-index" type="number" value="${escapeHtml(String(entry.index ?? ""))}" placeholder="index" /></td>
      <td class="pos-preview">${escapeHtml(String(previewTok || ""))}</td>
      <td><input class="pos-allowed" type="text" value="${escapeHtml((entry.allowed || []).join(","))}" placeholder="allowed tokens" /></td>
      <td><button type="button" class="btn btn-secondary btn-compact pos-remove">Del</button></td>
    `;
    row.querySelector(".pos-index").addEventListener("input", () => updatePosPreviews(lastRemainderTokens));
    row.querySelector(".pos-remove").addEventListener("click", () => {
      row.remove();
      if (!el.posRows.querySelector(".pos-row")) addEmptyPosRow(lastRemainderTokens);
      updatePosPreviews(lastRemainderTokens);
    });
    el.posRows.appendChild(row);
  });
  updatePosPreviews(remainderTokens);
}

function readPosRows() {
  const pos = [];
  el.posRows.querySelectorAll(".pos-row").forEach((row) => {
    const idxVal = row.querySelector(".pos-index")?.value ?? "";
    const allowedVal = row.querySelector(".pos-allowed")?.value ?? "";
    if (idxVal === "" || allowedVal.trim() === "") return;
    const idx = parseInt(idxVal, 10);
    if (Number.isNaN(idx)) return;
    const allowed = allowedVal.split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.length) return;
    pos.push({ index: idx, allowed });
  });
  return pos;
}

/* ── Rendering ───────────────────────────────────────────────── */
function renderResults(data) {
  el.errorList.innerHTML = "";

  if (!data.gitOk && data.gitReason) {
    el.errorList.innerHTML += `<div>• ${escapeHtml(data.gitReason)}</div>`;
  }

  const hasFail =
    !data.gitOk ||
    (data.missingRequired && data.missingRequired.length > 0) ||
    data.results.some((r) => r.status === "fail");
  const hasReview = data.results.some((r) => r.status === "review");

  let statusLabel, statusMessage, badgeClass;
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

  el.statusBadge.textContent = `${statusLabel} - ${statusMessage}`;
  el.statusBadge.className = `badge ${badgeClass}`;
  el.statusBadge.title = statusMessage;

  let html = "";
  if (data.missingRequired && data.missingRequired.length) {
    data.missingRequired.forEach((pname, idx) => {
      const pnameLc = pname.toLowerCase();
      html += `<div class="line line-fail line-missing" data-param="${escapeAttr(pnameLc)}" data-value="" data-tokens="${escapeAttr(pnameLc)}" data-idx="missing-${idx}"><span class="line-text">${escapeHtml(`[MISSING RULE] ${pname}`)}</span></div>`;
    });
  }
  data.results.forEach((r) => {
    if (r.trimmed === "") return;
    let cls = "line";
    if (r.status === "pass") cls += " line-pass";
    else if (r.status === "review") cls += " line-review";
    else cls += " line-fail";

    if (!data.gitOk && r.idx === data.gitLineIndex) {
      cls = "line line-fail";
      r.reasons.push("Firmware hash not allowed");
    }

    const title = r.reasons.length ? `title="${escapeAttr(r.reasons.join("; "))}"` : "";
    const selectedClass = selectedParamName && selectedLineIdx === r.idx ? " line-selected" : "";
    const dataAttrs = r.paramName
      ? ` data-param="${escapeAttr(r.paramName)}" data-value="${escapeAttr(r.paramValue || "")}" data-tokens="${escapeAttr(normalizeLineTokens(r.trimmed).join(" "))}" data-idx="${r.idx}"`
      : ` data-idx="${r.idx}"`;
    html += `<div class="${cls}${selectedClass}" ${title}${dataAttrs}><span class="line-text">${escapeHtml(r.line)}</span></div>`;
  });

  el.configOutput.innerHTML = html;
  if (selectedParamName && selectedLineIdx !== null) {
    lastSelectedLineElem =
      el.configOutput.querySelector(`.line[data-idx="${selectedLineIdx}"]`) || null;
  } else {
    lastSelectedLineElem = null;
  }
  lastValidation = data;
  applySearchFilter();
}

function showEmptyResults(reason, badgeSummary) {
  el.resultsPanel.classList.remove("hidden-pass");
  el.statusBadge.textContent = badgeSummary || reason;
  el.statusBadge.className = "badge badge-neutral";
  el.statusBadge.title = reason;
  el.errorList.innerHTML = "";
  el.configOutput.innerHTML = `<div class="placeholder">${escapeHtml(reason)}</div>`;
  lastValidation = null;
  applySearchFilter();
}

function applySearchFilter() {
  const term = currentSearchTerm.trim().toLowerCase();
  el.clearSearch.classList.toggle("hidden", term.length === 0);
  el.configOutput.querySelectorAll(".line").forEach((line) => {
    line.style.display = !term || line.textContent.toLowerCase().includes(term) ? "" : "none";
  });
}

function updateEmptyState() {
  if (lastValidation) return;
  const hasRules = el.rulesText.value.trim().length > 0;
  const hasConfig = el.configText.value.trim().length > 0;

  let msg, badgeMsg;
  if (hasRules && hasConfig) {
    msg = "Ready: click Validate to run checks.";
    badgeMsg = "Ready - Click Validate";
  } else if (hasRules && !hasConfig) {
    msg = "Config missing: drop or paste a config export.";
    badgeMsg = "Waiting - Config missing";
  } else if (!hasRules && hasConfig) {
    msg = "Ruleset missing: drop or paste your ruleset JSON.";
    badgeMsg = "Waiting - Ruleset missing";
  } else {
    msg = "Waiting for input: paste or drop a ruleset JSON and a config export, then click Validate.";
    badgeMsg = "Waiting - Provide ruleset and config";
  }
  showEmptyResults(msg, badgeMsg);
}

function focusRuleEditor() {
  el.rulesPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  el.ruleTypeSelect.focus({ preventScroll: true });
}

/* ── Ruleset I/O ─────────────────────────────────────────────── */
function syncRulesetToTextarea() {
  if (!ruleset) return;
  el.rulesText.value = JSON.stringify(ruleset, null, 2);
}

function loadRulesetFromTextarea() {
  const txt = el.rulesText.value.trim();
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

/* ── Rule editor ─────────────────────────────────────────────── */
function clearRuleEditor() {
  selectedParamName = null;
  updateBackBtn();
  selectedParamLastValue = "";
  selectedLineIdx = null;
  isNewRuleSelection = false;
  hasEditedNewRuleEquals = false;
  if (lastSelectedLineElem) lastSelectedLineElem.classList.remove("line-selected");
  lastSelectedLineElem = null;
  lastSelectedTokens = [];
  lastRemainderTokens = [];
  el.rulesPanel.classList.remove("active-highlight");
  el.selectedParamName.textContent = "(none)";
  el.selectedParamRemainder.style.display = "none";
  el.ruleMissingNotice.style.display = "none";
  el.ruleMissingNotice.innerHTML = "";
  el.ruleTypeSelect.value = "allowed";
  el.ruleValueInput.value = "";
  el.ruleContainsInput.value = "";
  el.ruleReviewNote.value = "";
  el.ruleRequiredCheckbox.checked = false;
  el.ruleValueGroup.style.display = "none";
  el.ruleContainsGroup.style.display = "none";
}

function openRuleEditorForParam(paramName, currentValue) {
  if (!ruleset) {
    const raw = el.rulesText.value.trim();
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
  updateBackBtn();
  selectedParamLastValue = currentValue || "";

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
    value = currentValue || "";
    tokenLen = tokensForLine.length >= 2 ? 2 : tokensForLine.length || 1;
  } else if (typeof rule === "string") {
    if (rule === "allowed") type = "allowed";
    else if (rule === "forbidden") type = "forbidden";
    else if (rule === "required") { type = "allowed"; required = true; }
  } else if (typeof rule === "object") {
    type = rule.rule || "allowed";
    required = !!rule.required;
    if (rule.note != null) ruleNote = String(rule.note);
    if (type === "equals" && rule.value != null) value = String(rule.value);
    else if (type === "contains_all" && Array.isArray(rule.contains_all)) containsList = rule.contains_all;
    else if (type === "contains_any" && Array.isArray(rule.contains_any)) containsList = rule.contains_any;
    else if (type === "contains_exact" && Array.isArray(rule.tokens)) containsList = rule.tokens;
    else if (type === "positional" && Array.isArray(rule.pos)) posList = rule.pos;
    if (rule.token_length) tokenLen = rule.token_length;
  }

  const remainderTokens = tokensForLine.slice(tokenLen);
  lastRemainderTokens = remainderTokens;

  el.ruleTypeSelect.value = type;
  el.ruleRequiredCheckbox.checked = required;
  setRuleValueInputValue(value);
  el.ruleContainsInput.value = containsList.join(",");
  el.ruleReviewNote.value = ruleNote;
  updateRuleEditorVisibility();
  setTokenLengthUI(tokenLen);
  updateParamPreview(paramName, tokenLen, tokensForLine);
  renderPosRows(posList, remainderTokens);
  updateRuleMissingNotice();
  el.rulesPanel.classList.add("active-highlight");
  focusRuleEditor();
}

function saveCurrentRule() {
  if (!ruleset || !selectedParamName) return;
  if (!ruleset.rules) ruleset.rules = {};
  const paramKey = selectedParamName.toLowerCase();

  const type = el.ruleTypeSelect.value;
  const val = el.ruleValueInput.value.trim();
  const contains = el.ruleContainsInput.value.split(",").map((s) => s.trim()).filter(Boolean);
  const ruleNote = el.ruleReviewNote.value.trim();
  const required = el.ruleRequiredCheckbox.checked;
  const tokenLen = getSelectedTokenLength();
  const pos = readPosRows();
  const baseTokens = lastSelectedTokens.length ? lastSelectedTokens : selectedParamName.split(/\s+/);
  const newKey = baseTokens.slice(0, tokenLen).join(" ");
  const newKeyLc = newKey.toLowerCase();
  const hasNote = ruleNote.length > 0;
  const needsObject = required || type !== "allowed" || hasNote;

  let ruleObj;
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
    const shouldPersistTokenLength = (type !== "allowed" && type !== "forbidden") || required || hasNote;
    if (shouldPersistTokenLength) ruleObj.token_length = tokenLen;
    if (required) ruleObj.required = true;
  }

  if (selectedParamName !== newKeyLc) {
    delete ruleset.rules[paramKey];
    if (lastSelectedLineElem) lastSelectedLineElem.classList.remove("line-selected");
    selectedParamName = newKeyLc;
    el.selectedParamName.textContent = newKey;
  }

  ruleset.rules[newKeyLc] = ruleObj;
  isNewRuleSelection = false;
  hasEditedNewRuleEquals = false;
  lineTokenCache.set(newKeyLc, baseTokens);
  lastSelectedTokens = baseTokens;

  syncRulesetToTextarea();
  if (lastConfigText) renderResults(applyRules(ruleset, lastConfigText));
  el.ruleMissingNotice.style.display = "none";
  el.ruleMissingNotice.innerHTML = "";
}

function deleteCurrentRule() {
  if (!ruleset || !selectedParamName || !ruleset.rules) return;
  if (!confirm("Delete rule for " + selectedParamName + "?")) return;
  delete ruleset.rules[selectedParamName.toLowerCase()];
  clearRuleEditor();
  syncRulesetToTextarea();
  if (lastConfigText) renderResults(applyRules(ruleset, lastConfigText));
}

function runValidation() {
  if (!loadRulesetFromTextarea()) return;
  const cfg = el.configText.value.trim();
  if (!cfg) {
    alert("Please load or paste a competitor config.");
    updateEmptyState();
    return;
  }
  lastConfigText = cfg;
  renderResults(applyRules(ruleset, cfg));
  el.hidePassing.checked = true;
  el.resultsPanel.classList.add("hidden-pass");
  showPanel("results");
}

function exportRuleset() {
  if (!ruleset && !loadRulesetFromTextarea()) return;
  if (ruleset) {
    ruleset = normalizeRuleset(ruleset);
    syncRulesetToTextarea();
  }
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
}

/* ── Event wiring ────────────────────────────────────────────── */
el.validateBtn.addEventListener("click", runValidation);
el.exportRulesBtn.addEventListener("click", exportRuleset);
el.saveParamRuleBtn.addEventListener("click", saveCurrentRule);
el.deleteParamRuleBtn.addEventListener("click", deleteCurrentRule);
el.addPosRowBtn.addEventListener("click", () => addEmptyPosRow(lastRemainderTokens));

el.hidePassing.addEventListener("change", (e) => {
  el.resultsPanel.classList.toggle("hidden-pass", e.target.checked);
});

el.configSearch.addEventListener("input", (e) => {
  currentSearchTerm = e.target.value;
  applySearchFilter();
});

el.clearSearch.addEventListener("click", () => {
  currentSearchTerm = "";
  el.configSearch.value = "";
  applySearchFilter();
  el.configSearch.focus({ preventScroll: true });
});

el.ruleTypeSelect.addEventListener("change", () => {
  updateRuleEditorVisibility();
  if (selectedParamName) updateParamPreview(selectedParamName, getSelectedTokenLength(), lastSelectedTokens);
  syncNewRuleEqualsValue();
  updateRuleMissingNotice();
});

el.ruleValueInput.addEventListener("input", () => {
  if (suppressRuleValueInputTracking || !isNewRuleSelection) return;
  hasEditedNewRuleEquals = true;
  updateRuleMissingNotice();
});

el.ruleTokenLengthGroup.addEventListener("change", (e) => {
  if (e.target.name !== "tokenLength") return;
  el.ruleTokenLengthGroup.querySelectorAll(".token-chip").forEach((label) =>
    label.classList.toggle("active", label.querySelector("input").checked),
  );
  const tokenLen = getSelectedTokenLength();
  lastRemainderTokens = lastSelectedTokens.slice(tokenLen);
  updatePosPreviews(lastRemainderTokens);
  if (selectedParamName) updateParamPreview(selectedParamName, tokenLen, lastSelectedTokens);
  syncNewRuleEqualsValue();
  updateRuleMissingNotice();
});

el.configOutput.addEventListener("click", (e) => {
  const line = e.target.closest(".line[data-param]");
  if (!line) return;

  const param = line.dataset.param;
  const val = line.dataset.value || "";
  const tokens = line.dataset.tokens ? line.dataset.tokens.split(/\s+/) : param.split(/\s+/);
  const idxRaw = line.dataset.idx;
  const idx = idxRaw && idxRaw.startsWith("missing-") ? idxRaw : parseInt(idxRaw, 10);

  if (tokens.length) {
    lineTokenCache.set(param, tokens);
    lastSelectedTokens = tokens;
  }

  if (selectedParamName === param) {
    clearRuleEditor();
    return;
  }

  if (lastSelectedLineElem) lastSelectedLineElem.classList.remove("line-selected");
  line.classList.add("line-selected");
  lastSelectedLineElem = line;
  selectedLineIdx = idx;

  openRuleEditorForParam(param, val);
  showPanel("rules");
});

[el.rulesText, el.configText].forEach((textarea) => {
  textarea.addEventListener("input", updateEmptyState);
});

/* ── Init ────────────────────────────────────────────────────── */
updateEmptyState();
setTokenLengthUI(2);
