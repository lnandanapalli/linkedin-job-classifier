importScripts('profile.js', 'prompt-builder.js');

const SYSTEM_PROMPT = buildSystemPrompt(PROFILE);

// ── Scan state (lives in background, survives popup close) ──
let scanState = {
  running: false,
  phase: "",
  tabId: null,
  items: [],
  totalCards: 0,
  currentIndex: 0,
  currentTitle: "",
  clickedGreen: {}
};

let savedScrollTop = 0;
let savedFilter = "all";
let abortScan = false;
let oneJobResult = null;

function persistState() {
  chrome.storage.local.set({
    scanData: {
      items: scanState.items,
      totalCards: scanState.totalCards,
      clickedGreen: scanState.clickedGreen,
      scrollTop: savedScrollTop,
      filter: savedFilter,
      oneJobResult: oneJobResult
    }
  });
}

// Restore on service worker restart
chrome.storage.local.get(["scanData"], (d) => {
  if (d.scanData) {
    scanState.items = d.scanData.items || [];
    scanState.totalCards = d.scanData.totalCards || 0;
    scanState.clickedGreen = d.scanData.clickedGreen || {};
    savedScrollTop = d.scanData.scrollTop || 0;
    savedFilter = d.scanData.filter || "all";
    oneJobResult = d.scanData.oneJobResult || null;
    scanState.running = false;
  }
});

// ── Message handler ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "evaluate") {
    evaluateJob(msg.text).then(sendResponse).catch(e => sendResponse({ verdict: "ERROR", reason: e.message }));
    return true;
  }

  if (msg.type === "start-scan") {
    if (!scanState.running) {
      startScan(msg.tabId, msg.force || false);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "get-scan-state") {
    sendResponse({
      running: scanState.running,
      phase: scanState.phase,
      items: scanState.items,
      totalCards: scanState.totalCards,
      currentIndex: scanState.currentIndex,
      currentTitle: scanState.currentTitle,
      clickedGreen: scanState.clickedGreen,
      filter: savedFilter,
      scrollTop: savedScrollTop,
      oneJobResult: oneJobResult
    });
    return true;
  }

  if (msg.type === "save-one-result") {
    oneJobResult = msg.result;
    persistState();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "mark-clicked") {
    scanState.clickedGreen[msg.index] = true;
    persistState();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "clear-scan") {
    abortScan = true;
    scanState = {
      running: false, phase: "", tabId: null, items: [], totalCards: 0,
      currentIndex: 0, currentTitle: "", clickedGreen: {}
    };
    savedScrollTop = 0;
    savedFilter = "all";
    oneJobResult = null;
    chrome.storage.local.remove("scanData");
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "save-scroll") {
    savedScrollTop = msg.scrollTop || 0;
    persistState();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "save-filter") {
    savedFilter = msg.filter || "all";
    persistState();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "get-scroll") {
    sendResponse({ scrollTop: savedScrollTop });
    return true;
  }

  return true;
});

// ── Scan orchestration (runs in background, independent of popup) ──
async function startScan(tabId, force) {
  scanState.running = true;
  scanState.tabId = tabId;
  scanState.items = [];
  scanState.totalCards = 0;
  scanState.currentIndex = 0;
  scanState.currentTitle = "";
  scanState.clickedGreen = {};
  abortScan = false;
  scanState.phase = "collecting";
  persistState();

  try {
    const cards = await sendToContent(tabId, { type: "get-all-cards", force: !!force });
    if (abortScan || !cards || cards.length === 0) {
      scanState.running = false;
      scanState.phase = "";
      persistState();
      return;
    }

    scanState.totalCards = cards.length;
    scanState.phase = "evaluating";
    persistState();

    for (let i = 0; i < cards.length; i++) {
      if (abortScan) break;

      const card = cards[i];
      scanState.currentIndex = i + 1;
      scanState.currentTitle = card.title || "Unknown";
      persistState();

      if (card.skip) {
        scanState.items.push({
          title: card.title,
          company: card.company,
          occurrence: card.occurrence || 0,
          verdict: "SKIP",
          reason: card.skipReason
        });
        persistState();
        continue;
      }

      try {
        const result = await evaluateJob(card.text);
        scanState.items.push({
          title: card.title,
          company: card.company,
          occurrence: card.occurrence || 0,
          verdict: result.verdict || "ERROR",
          reason: result.reason || ""
        });
      } catch (e) {
        scanState.items.push({
          title: card.title,
          company: card.company,
          occurrence: card.occurrence || 0,
          verdict: "ERROR",
          reason: e.message
        });
      }
      persistState();
    }
  } catch (e) {
    console.error("Scan error:", e);
  }

  scanState.running = false;
  scanState.phase = "";
  scanState.currentTitle = "";
  persistState();
}

function sendToContent(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });
}

async function evaluateJob(text) {
  const { apiKey, model } = await chrome.storage.sync.get(["apiKey", "model"]);
  if (!apiKey) throw new Error("No API key. Set it in the extension popup.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({
      model: model || "o4-mini",
      max_completion_tokens: 1000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "Evaluate this job:\n\n" + text }
      ]
    })
  });

  if (!res.ok) throw new Error("API " + res.status);

  const data = await res.json();
  const raw = (data.choices[0].message.content || "").trim().replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(raw);

  return {
    verdict: parsed.verdict === "APPLY" ? "APPLY" : "SKIP",
    reason: parsed.reason || ""
  };
}
