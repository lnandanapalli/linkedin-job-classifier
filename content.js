chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get-all-cards") {
    getAllCardsWithFullJD(msg.force).then(sendResponse);
    return true;
  } else if (msg.type === "get-active-job") {
    sendResponse(getActiveJob());
  } else if (msg.type === "click-card") {
    clickCardByMatch(msg.title, msg.company, msg.occurrence || 0);
    sendResponse({ ok: true });
  }
  return true;
});

function findCards() {
  const dismissBtns = document.querySelectorAll('button[aria-label^="Dismiss "][aria-label$=" job"]');
  const cards = [];
  for (const btn of dismissBtns) {
    let cardEl = btn;
    while (cardEl.parentElement) {
      const parent = cardEl.parentElement;
      const sibs = Array.from(parent.children).filter(c =>
        c.querySelector('button[aria-label^="Dismiss "][aria-label$=" job"]')
      );
      if (sibs.length > 1) break;
      cardEl = parent;
    }
    let clickTarget = cardEl.querySelector('div[role="button"][tabindex="0"]');
    if (!clickTarget) {
      let check = cardEl;
      while (check) {
        if (check.getAttribute && check.getAttribute('role') === 'button' && check.getAttribute('tabindex') === '0') {
          clickTarget = check;
          break;
        }
        check = check.parentElement;
      }
    }
    cards.push({ cardEl, clickTarget: clickTarget || cardEl });
  }
  return cards;
}

function clickCardByMatch(title, company, occurrence) {
  const cards = findCards();
  let matchCount = 0;
  for (const card of cards) {
    const info = parseCard(card.cardEl);
    // Match by title+company combo
    if (info.title === title && info.company === company) {
      if (matchCount === occurrence) {
        card.cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          simulateClick(card.clickTarget);
        }, 200);
        return;
      }
      matchCount++;
    }
  }
  // Fallback: try matching by title alone with occurrence
  matchCount = 0;
  for (const card of cards) {
    const info = parseCard(card.cardEl);
    if (info.title === title) {
      if (matchCount === occurrence) {
        card.cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          simulateClick(card.clickTarget);
        }, 200);
        return;
      }
      matchCount++;
    }
  }
}

function getSkipStatus(text) {
  const lower = text.toLowerCase();
  if (/\bapplied\b/.test(lower)) return "Applied";
  if (/\bsaved\b/.test(lower)) return "Saved";
  if (/\bviewed\b/.test(lower)) return "Viewed";
  return null;
}

function parseCard(el) {
  const rawText = (el.innerText || "").trim();
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  const title = lines[0] || "Unknown";
  // LinkedIn often renders the title twice (with and without "Verified job" suffix)
  // Detect duplicate and skip to the real company line
  let company = lines[1] || "Unknown";
  if (lines.length >= 3 && (title.includes(company) || company.includes(title.replace(/\s*\(Verified job\)/, "")))) {
    company = lines[2] || "Unknown";
  }
  return { title, company, rawText };
}

// ── Job details panel discovery ──
// LinkedIn migrated from BEM classes (jobs-search__job-details--container)
// to hashed class names in 2026. These helpers use stable attribute and
// structural selectors that survive CSS-class renames.

function getJobDetailsPanel() {
  // Strategy 1: find the lazy-column that CONTAINS job-detail components
  // (most robust — identifies the panel by its content, not its own attributes)
  try {
    const columns = document.querySelectorAll('[data-testid="lazy-column"]');
    for (const col of columns) {
      if (col.querySelector('[componentkey^="JobDetails_"]') ||
          col.querySelector('[data-sdui-component*="aboutTheJob"]') ||
          col.querySelector('[componentkey^="JobMatchInitialApplyRef"]')) {
        return col;
      }
    }
  } catch (e) {}

  // Strategy 2: legacy BEM selectors (pre-2026 LinkedIn)
  const legacy = [
    '.jobs-search__job-details--container',
    '.jobs-details__main-content',
    '[class*="jobs-description"]',
    '[class*="job-details"]'
  ];
  for (const sel of legacy) {
    try {
      const el = document.querySelector(sel);
      if (el && (el.innerText || "").trim().length > 200) return el;
    } catch (e) {}
  }

  return null;
}

function getJDText() {
  // Try the full details panel first (matches original behavior — includes
  // title, company, description, and metadata).  This is what clickCardAndWait
  // uses for change-detection and what evaluateJob sends to the API.
  const panel = getJobDetailsPanel();
  if (panel) {
    const t = (panel.innerText || "").trim();
    if (t.length > 200) return t;
  }

  // Fallback: grab just the "About the job" section
  const jdSelectors = [
    '[componentkey^="JobDetails_AboutTheJob"]',
    '[data-sdui-component*="aboutTheJob"]'
  ];
  let best = "";
  for (const sel of jdSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.innerText || "").trim();
        if (t.length > best.length) best = t;
      }
    } catch (e) {}
  }
  if (best.length > 200) return best;

  // Last resort: entire main area
  const main = document.querySelector('[role="main"]');
  if (main) {
    const t = (main.innerText || "").trim();
    if (t.length > best.length) best = t;
  }
  return best;
}

function simulateClick(el) {
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

function clickCardAndWait(clickTarget, previousJD) {
  return new Promise((resolve) => {
    simulateClick(clickTarget);

    let checks = 0;
    let changed = false;
    let stableCount = 0;
    let lastText = "";

    const interval = setInterval(() => {
      checks++;
      const currentJD = getJDText();

      if (!changed) {
        if (currentJD.length > 100 && currentJD !== previousJD) {
          changed = true;
          lastText = currentJD;
          stableCount = 0;
        }
      } else {
        if (currentJD === lastText) {
          stableCount++;
        } else {
          lastText = currentJD;
          stableCount = 0;
        }
        if (stableCount >= 3) {
          clearInterval(interval);
          resolve(currentJD);
          return;
        }
      }

      if (checks > 10) {
        clearInterval(interval);
        resolve(getJDText());
      }
    }, 1000);
  });
}

async function getAllCardsWithFullJD(force) {
  const cards = findCards();
  const results = [];

  const snapshots = cards.map(c => {
    const info = parseCard(c.cardEl);
    const status = force ? null : getSkipStatus(info.rawText);
    return { ...c, ...info, preStatus: status };
  });

  // Assign occurrence counter per title+company combo
  const comboCounts = {};
  for (const snap of snapshots) {
    const key = snap.title + "||" + snap.company;
    comboCounts[key] = (comboCounts[key] || 0);
    snap.occurrence = comboCounts[key];
    comboCounts[key]++;
  }

  let currentJD = getJDText();

  for (const snap of snapshots) {
    if (snap.preStatus) {
      results.push({
        title: snap.title, company: snap.company,
        occurrence: snap.occurrence,
        text: "", skip: true, skipReason: snap.preStatus
      });
      continue;
    }

    const newJD = await clickCardAndWait(snap.clickTarget, currentJD);
    currentJD = newJD;

    results.push({
      title: snap.title, company: snap.company,
      occurrence: snap.occurrence,
      text: newJD, skip: false, skipReason: null
    });
  }

  return results;
}

function getActiveJob() {
  const jd = getJDText();
  let title = "Unknown";
  let company = "Unknown";

  // Strategy 1: extract from links in the details panel (most reliable —
  // LinkedIn uses /jobs/view/ links for titles and /company/ links for companies)
  const panel = getJobDetailsPanel();
  if (panel) {
    const titleLink = panel.querySelector('a[href*="/jobs/view/"]');
    if (titleLink) {
      const t = (titleLink.innerText || "").trim();
      if (t.length > 1) title = t;
    }
    const companyLink = panel.querySelector('a[href*="/company/"]');
    if (companyLink) {
      const t = (companyLink.innerText || "").trim();
      if (t.length > 1) company = t;
    }
  }

  // Strategy 2: parse from the aria-label="Company, ..." element
  if (company === "Unknown") {
    const companyEl = document.querySelector('[aria-label^="Company,"]');
    if (companyEl) {
      const match = companyEl.getAttribute('aria-label').match(/^Company,\s*(.+?)\.?$/);
      if (match) company = match[1].trim();
    }
  }

  // Strategy 3: fall back to line parsing (legacy behavior)
  if (title === "Unknown" || company === "Unknown") {
    const lines = jd.split("\n").map(l => l.trim()).filter(Boolean);
    if (title === "Unknown") title = lines[0] || "Unknown";
    if (company === "Unknown") company = lines[1] || "Unknown";
  }

  return { title, company, text: jd };
}
