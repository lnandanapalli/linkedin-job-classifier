// ── DOM refs ──
const scanAllBtn = document.getElementById("scanAll");
const scanOneBtn = document.getElementById("scanOne");
const forceScanBtn = document.getElementById("forceScan");
const clearBtn = document.getElementById("clearBtn");
const allResults = document.getElementById("allResults");
const oneResultFixed = document.getElementById("oneResultFixed");
const apiKeyInput = document.getElementById("apiKey");
const modelSelect = document.getElementById("model");
const saveBtn = document.getElementById("saveSettings");
const saveStatus = document.getElementById("saveStatus");
const statsBar = document.getElementById("statsBar");
const filterRow = document.getElementById("filterRow");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const scrollArea = document.getElementById("scrollArea");

// Stat elements
const statGreen = document.getElementById("statGreen");
const statClicked = document.getElementById("statClicked");
const statUnclicked = document.getElementById("statUnclicked");
const statViewed = document.getElementById("statViewed");
const statSkipped = document.getElementById("statSkipped");

// ── State ──
let currentFilter = "all";
let pollTimer = null;
let lastRenderedCount = -1;
let lastClickedSnapshot = "";
let lastRenderedFilter = "";

// ── Settings ──
const settingsReadOnly = document.getElementById("settingsReadOnly");
const settingsEdit = document.getElementById("settingsEdit");
const editSettingsBtn = document.getElementById("editSettingsBtn");
const keyPreview = document.getElementById("keyPreview");
const modelPreview = document.getElementById("modelPreview");

const modelLabels = { "o4-mini": "o4-mini", "o3": "o3", "gpt-4.1-mini": "4.1-mini" };

function updateSettingsPreview() {
  chrome.storage.sync.get(["apiKey", "model"], (d) => {
    if (d.apiKey) {
      apiKeyInput.value = d.apiKey;
      keyPreview.textContent = "******";
    } else {
      keyPreview.textContent = "Not set";
    }
    if (d.model) {
      modelSelect.value = d.model;
      modelPreview.textContent = modelLabels[d.model] || d.model;
    } else {
      modelPreview.textContent = "o4-mini";
    }
  });
}

updateSettingsPreview();

editSettingsBtn.addEventListener("click", () => {
  const isEditing = settingsEdit.style.display !== "none";
  if (isEditing) {
    settingsEdit.style.display = "none";
    settingsReadOnly.style.display = "block";
    editSettingsBtn.textContent = "Edit";
  } else {
    settingsEdit.style.display = "block";
    settingsReadOnly.style.display = "none";
    editSettingsBtn.textContent = "Cancel";
  }
});

saveBtn.addEventListener("click", () => {
  chrome.storage.sync.set({ apiKey: apiKeyInput.value.trim(), model: modelSelect.value }, () => {
    settingsEdit.style.display = "none";
    settingsReadOnly.style.display = "block";
    editSettingsBtn.textContent = "Edit";
    updateSettingsPreview();
  });
});

// ── Helpers ──
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function getTab() {
  return new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, t => r(t[0] || null)));
}

function sendBg(msg) {
  return new Promise(r => chrome.runtime.sendMessage(msg, res => {
    if (chrome.runtime.lastError) r(null); else r(res);
  }));
}

function sendToContent(tabId, msg) {
  return new Promise(r => chrome.tabs.sendMessage(tabId, msg, res => {
    if (chrome.runtime.lastError) r(null); else r(res);
  }));
}

// ── Scroll persistence (via background JS variable) ──
function saveScroll() {
  sendBg({ type: "save-scroll", scrollTop: scrollArea.scrollTop });
}

function restoreScroll() {
  sendBg({ type: "get-scroll" }).then(res => {
    if (res && res.scrollTop) {
      scrollArea.scrollTop = res.scrollTop;
    }
  });
}

let scrollSaveTimer = null;
scrollArea.addEventListener("scroll", () => {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(saveScroll, 200);
});

// ── Filter logic ──
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    sendBg({ type: "save-filter", filter: currentFilter });
    // Re-render with current data
    sendBg({ type: "get-scan-state" }).then(state => {
      if (state && state.items.length > 0) {
        renderResults(state.items, state.clickedGreen, state.running, state.phase, state.currentIndex, state.totalCards, state.currentTitle);
      }
    });
  });
});

// ── Stats computation ──
function computeStats(items, clickedGreen) {
  let green = 0, clicked = 0, viewed = 0, aiSkip = 0;
  items.forEach((item, i) => {
    if (item.verdict === "APPLY") {
      green++;
      if (clickedGreen[i]) clicked++;
    } else if (item.verdict === "SKIP") {
      if (item.reason === "Viewed" || item.reason === "Applied" || item.reason === "Saved") {
        viewed++;
      } else {
        aiSkip++;
      }
    }
  });
  return { green, clicked, unclicked: green - clicked, viewed, aiSkip };
}

function updateStats(items, clickedGreen) {
  const s = computeStats(items, clickedGreen);
  statGreen.textContent = s.green;
  statClicked.textContent = s.clicked;
  statUnclicked.textContent = s.unclicked;
  statViewed.textContent = s.viewed;
  statSkipped.textContent = s.aiSkip;
  statsBar.style.display = items.length > 0 ? "flex" : "none";
  filterRow.style.display = items.length > 0 ? "flex" : "none";
  clearBtn.style.display = items.length > 0 ? "block" : "none";
}

// ── Render results ──
function shouldShowItem(item) {
  if (currentFilter === "all") return true;
  if (currentFilter === "apply") return item.verdict === "APPLY";
  if (currentFilter === "viewed") {
    return item.verdict === "SKIP" && (item.reason === "Viewed" || item.reason === "Applied" || item.reason === "Saved");
  }
  if (currentFilter === "skip") {
    return item.verdict === "SKIP" && item.reason !== "Viewed" && item.reason !== "Applied" && item.reason !== "Saved";
  }
  return true;
}

function renderResults(items, clickedGreen, running, phase, currentIndex, totalCards, currentTitle) {
  updateStats(items, clickedGreen);

  // Progress
  if (running) {
    progressBar.style.display = "block";
    if (phase === "collecting") {
      progressText.textContent = "Clicking through cards and loading full JDs...";
    } else {
      progressText.textContent = `Evaluating ${currentIndex}/${totalCards}: ${currentTitle}...`;
    }
    scanAllBtn.disabled = true;
    forceScanBtn.disabled = true;
    scanAllBtn.textContent = "Scanning...";
  } else {
    progressBar.style.display = "none";
    scanAllBtn.disabled = false;
    forceScanBtn.disabled = false;
    scanAllBtn.textContent = "Scan All";
  }

  if (items.length === 0 && !running) {
    allResults.innerHTML = '<div class="section"><div class="section-body"><div class="empty">Click "Scan All" to evaluate sidebar jobs.</div></div></div>';
    return;
  }

  // Check if we actually need to re-render (avoid flickering and scroll loss)
  const clickedSnap = JSON.stringify(clickedGreen);
  if (items.length === lastRenderedCount && clickedSnap === lastClickedSnapshot && currentFilter === lastRenderedFilter && !running) {
    return; // no change
  }
  lastRenderedCount = items.length;
  lastClickedSnapshot = clickedSnap;
  lastRenderedFilter = currentFilter;

  const filtered = items.map((item, i) => ({ ...item, origIndex: i })).filter(item => shouldShowItem(item));

  let html = '<div class="section"><div class="section-body">';
  if (filtered.length === 0) {
    html += '<div class="empty">No jobs match this filter.</div>';
  }
  for (const item of filtered) {
    const dotClass = item.verdict === "APPLY" ? "dot-green" : item.verdict === "SKIP" ? "dot-red" : "dot-gray";
    const isClicked = clickedGreen[item.origIndex];
    const rowClass = (item.verdict === "APPLY" && isClicked) ? "job-row clicked-row" : "job-row";
    html += `<div class="${rowClass}" data-index="${item.origIndex}">
      <div class="dot ${dotClass}"></div>
      <div class="job-info">
        <div class="job-title" title="${esc(item.title)}">${esc(item.title)}</div>
        <div class="job-company">${esc(item.company)}</div>
        ${item.reason ? `<div class="job-reason">${esc(item.reason)}</div>` : ""}
      </div>
      <span class="nav-arrow">&rsaquo;</span>
    </div>`;
  }
  html += '</div></div>';
  allResults.innerHTML = html;

  // Attach click handlers for navigation
  allResults.querySelectorAll(".job-row[data-index]").forEach(row => {
    row.addEventListener("click", async () => {
      const idx = parseInt(row.dataset.index, 10);
      const item = items[idx];

      // Get current active tab and navigate
      const tab = await getTab();
      if (tab && tab.url && tab.url.includes("linkedin.com/jobs")) {
        sendToContent(tab.id, { type: "click-card", title: item.title, company: item.company, occurrence: item.occurrence || 0 });
      }

      // Mark green jobs as clicked
      if (item && item.verdict === "APPLY") {
        sendBg({ type: "mark-clicked", index: idx });
        row.classList.add("clicked-row");
        clickedGreen[idx] = true;
        updateStats(items, clickedGreen);
      }
    });
  });
}

// ── One-job result rendering (fixed top area) ──
function renderOneJob(item) {
  if (!item) {
    oneResultFixed.style.display = "none";
    return;
  }
  const cls = item.verdict === "APPLY" ? "verdict-apply" : "verdict-skip";
  const icon = item.verdict === "APPLY" ? "APPLY" : "SKIP";
  oneResultFixed.style.display = "block";
  oneResultFixed.innerHTML = `<div class="verdict-box ${cls}" style="margin-bottom:8px">
    <div class="verdict-label"><span class="dot ${item.verdict === 'APPLY' ? 'dot-green' : 'dot-red'}" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>${esc(icon)}</div>
    <div class="verdict-reason">${esc(item.reason || "")}</div>
    <div class="job-company" style="margin-top:4px">${esc(item.title)} - ${esc(item.company)}</div>
  </div>`;
}

// ── Poll background for state updates ──
let initialLoadDone = false;

function pollState() {
  sendBg({ type: "get-scan-state" }).then(state => {
    if (!state) return;

    // On first load, restore filter, scroll, and one-job result
    if (!initialLoadDone) {
      initialLoadDone = true;
      if (state.filter && state.filter !== currentFilter) {
        currentFilter = state.filter;
        document.querySelectorAll(".filter-btn").forEach(b => {
          b.classList.toggle("active", b.dataset.filter === currentFilter);
        });
      }
      renderOneJob(state.oneJobResult);
      renderResults(state.items, state.clickedGreen, state.running, state.phase, state.currentIndex, state.totalCards, state.currentTitle);
      if (state.scrollTop) {
        setTimeout(() => { scrollArea.scrollTop = state.scrollTop; }, 50);
      }
      return;
    }

    renderResults(state.items, state.clickedGreen, state.running, state.phase, state.currentIndex, state.totalCards, state.currentTitle);
  });
}

// ── Initial load ──
pollState();

// Poll every 800ms while popup is open
pollTimer = setInterval(pollState, 800);

// ── Scan All ──
scanAllBtn.addEventListener("click", async () => {
  const tab = await getTab();
  if (!tab || !tab.url.includes("linkedin.com/jobs")) {
    allResults.innerHTML = '<div class="section"><div class="section-body"><div class="empty">Navigate to LinkedIn Jobs first.</div></div></div>';
    return;
  }

  scanAllBtn.disabled = true;
  scanAllBtn.textContent = "Starting...";
  lastRenderedCount = -1;
  lastClickedSnapshot = "";

  // Tell background to start scanning
  sendBg({ type: "start-scan", tabId: tab.id });
});

// ── Force Scan All (ignores Viewed/Saved/Applied) ──
forceScanBtn.addEventListener("click", async () => {
  const tab = await getTab();
  if (!tab || !tab.url.includes("linkedin.com/jobs")) {
    allResults.innerHTML = '<div class="section"><div class="section-body"><div class="empty">Navigate to LinkedIn Jobs first.</div></div></div>';
    return;
  }

  scanAllBtn.disabled = true;
  forceScanBtn.disabled = true;
  scanAllBtn.textContent = "Scanning...";
  lastRenderedCount = -1;
  lastClickedSnapshot = "";

  sendBg({ type: "start-scan", tabId: tab.id, force: true });
});

// ── Scan This Job ──
scanOneBtn.addEventListener("click", async () => {
  const tab = await getTab();
  if (!tab || !tab.url.includes("linkedin.com/jobs")) {
    oneResultFixed.style.display = "block";
    oneResultFixed.innerHTML = '<div class="empty" style="padding:4px 0">Navigate to LinkedIn Jobs first.</div>';
    return;
  }

  scanOneBtn.disabled = true;
  scanOneBtn.textContent = "Scanning...";
  oneResultFixed.style.display = "block";
  oneResultFixed.innerHTML = '<div class="progress" style="padding:4px 0">Reading job description...</div>';

  const job = await sendToContent(tab.id, { type: "get-active-job" });
  if (!job || !job.text || job.text.length < 50) {
    oneResultFixed.innerHTML = '<div class="empty" style="padding:4px 0">No job description found. Click a job card first.</div>';
    scanOneBtn.disabled = false;
    scanOneBtn.textContent = "Scan This";
    return;
  }

  oneResultFixed.innerHTML = `<div class="progress" style="padding:4px 0">Evaluating ${esc(job.title)}...</div>`;

  const result = await sendBg({ type: "evaluate", text: job.text });
  const item = {
    title: job.title,
    company: job.company,
    verdict: result.verdict || "ERROR",
    reason: result.reason || ""
  };

  // Persist and render
  sendBg({ type: "save-one-result", result: item });
  renderOneJob(item);

  scanOneBtn.disabled = false;
  scanOneBtn.textContent = "Scan This";
});

// ── Clear results ──
clearBtn.addEventListener("click", () => {
  sendBg({ type: "clear-scan" });
  lastRenderedCount = -1;
  lastClickedSnapshot = "";
  lastRenderedFilter = "";
  currentFilter = "all";
  document.querySelectorAll(".filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === "all");
  });
  allResults.innerHTML = '<div class="section"><div class="section-body"><div class="empty">Click "Scan All" to evaluate sidebar jobs.</div></div></div>';
  oneResultFixed.style.display = "none";
  oneResultFixed.innerHTML = "";
  statsBar.style.display = "none";
  filterRow.style.display = "none";
  clearBtn.style.display = "none";
  progressBar.style.display = "none";
});
