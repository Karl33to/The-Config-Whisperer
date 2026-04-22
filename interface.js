const buttons = document.querySelectorAll("[data-panel]");
const panels = {};
const MAIN_KEYS = ["inputs", "results", "rules"];
const TAB_ORDER = ["inputs", "results", "rules", "help"];
const desktopMQ = window.matchMedia("(min-width: 1200px)");

buttons.forEach((btn) => {
  const key = btn.dataset.panel;
  const panel = document.getElementById(`${key}Panel`);
  if (panel) panels[key] = panel;
});

let current = null;

function updateButtonStates(activeKey) {
  buttons.forEach((btn) => {
    const isActive = btn.dataset.panel === activeKey;
    btn.setAttribute("aria-selected", isActive);
    // Header help button lives outside the nav tablist — always tab-reachable
    if (!btn.classList.contains("header-help-btn")) {
      btn.setAttribute("tabindex", isActive ? "0" : "-1");
    }
  });
}

// Returns "forward" when navigating to a higher-indexed tab, "backward" otherwise
function getDirection(fromKey, toKey) {
  const from = TAB_ORDER.indexOf(fromKey ?? "");
  const to = TAB_ORDER.indexOf(toKey);
  return from === -1 || to > from ? "forward" : "backward";
}

function animateOut(panel, direction) {
  panel.dataset.slideTo = direction === "forward" ? "left" : "right";
  panel.dataset.active = "false";
  panel.inert = true;
  const handle = () => {
    panel.hidden = true;
    delete panel.dataset.slideTo;
    panel.removeEventListener("transitionend", handle);
  };
  panel.addEventListener("transitionend", handle);
}

function animateIn(panel, direction) {
  panel.dataset.slideFrom = direction === "forward" ? "right" : "left";
  panel.inert = false;
  panel.hidden = false;
  requestAnimationFrame(() => {
    panel.dataset.active = "true";
  });
}

function showPanel(targetKey, { focus = true } = {}) {
  if (!panels[targetKey]) return;

  if (desktopMQ.matches) {
    // On desktop, only Help is tab-controlled
    if (MAIN_KEYS.includes(targetKey)) return;

    const helpPanel = panels["help"];
    if (!helpPanel) return;

    if (current === "help") {
      // Toggle off: slide out to the right (going back)
      animateOut(helpPanel, "backward");
      current = MAIN_KEYS[0];
      updateButtonStates(null);
    } else {
      // Toggle on: slide in from the right
      animateIn(helpPanel, "forward");
      current = "help";
      updateButtonStates("help");
      if (focus) {
        requestAnimationFrame(() => {
          helpPanel
            .querySelector(
              "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
            )
            ?.focus({ preventScroll: true });
        });
      }
    }
    return;
  }

  // Mobile: directional single-panel tab switching
  if (targetKey === current) return;

  const nextPanel = panels[targetKey];
  const prevPanel = current ? panels[current] : null;
  const direction = getDirection(current, targetKey);

  if (prevPanel && prevPanel.contains(document.activeElement)) {
    document.querySelector(`[data-panel="${targetKey}"]`)?.focus();
  }

  updateButtonStates(targetKey);

  if (prevPanel) animateOut(prevPanel, direction);
  animateIn(nextPanel, direction);

  current = targetKey;

  if (focus) {
    requestAnimationFrame(() => {
      nextPanel
        .querySelector(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        )
        ?.focus({ preventScroll: true });
    });
  }
}

// Snap layout to correct state — no animation (used on init and resize)
function syncLayout() {
  if (desktopMQ.matches) {
    MAIN_KEYS.forEach((key) => {
      const panel = panels[key];
      if (!panel) return;
      panel.hidden = false;
      panel.inert = false;
      panel.dataset.active = "true";
      delete panel.dataset.slideFrom;
      delete panel.dataset.slideTo;
    });

    const helpPanel = panels["help"];
    if (helpPanel) {
      const helpVisible = current === "help";
      helpPanel.hidden = !helpVisible;
      helpPanel.inert = !helpVisible;
      helpPanel.dataset.active = helpVisible ? "true" : "false";
      delete helpPanel.dataset.slideFrom;
      delete helpPanel.dataset.slideTo;
    }

    updateButtonStates(current === "help" ? "help" : null);
  } else {
    if (!current || !panels[current]) current = MAIN_KEYS[0];

    Object.entries(panels).forEach(([key, panel]) => {
      const isActive = key === current;
      panel.hidden = !isActive;
      panel.inert = !isActive;
      panel.dataset.active = isActive ? "true" : "false";
      delete panel.dataset.slideFrom;
      delete panel.dataset.slideTo;
    });

    updateButtonStates(current);
  }
}

// Click handling (event delegation)
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-panel]");
  if (!btn) return;
  showPanel(btn.dataset.panel);
});

// Arrow-key navigation across visible tab buttons
document.addEventListener("keydown", (e) => {
  const activeBtn = document.querySelector("[aria-selected='true']");
  if (!activeBtn) return;

  const list = [...buttons].filter((b) => b.offsetParent !== null);
  const index = list.indexOf(activeBtn);
  if (index === -1) return;

  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    const next = list[(index + 1) % list.length];
    next.focus();
    showPanel(next.dataset.panel, { focus: false });
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    const prev = list[(index - 1 + list.length) % list.length];
    prev.focus();
    showPanel(prev.dataset.panel, { focus: false });
  }
});

// Sync on viewport resize crossing the breakpoint
desktopMQ.addEventListener("change", syncLayout);

document.getElementById("backToResultsBtn")?.addEventListener("click", () => {
  showPanel("results");
});

// Initial load
window.addEventListener("DOMContentLoaded", () => {
  current = MAIN_KEYS[0];
  syncLayout();
});
