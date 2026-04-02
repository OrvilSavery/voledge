// ─────────────────────────────────────────
//  VolEdge — Phase 1 Application Logic
// ─────────────────────────────────────────

// ── KEY STORAGE ──
// Claude key is now stored server-side (Vercel env variable)
// Finnhub key stays in browser since finnhub.io allows browser calls
function getKey(name) {
  return localStorage.getItem('voledge_' + name) || '';
}

function saveKeys() {
  const finnhub = document.getElementById('finnhubKey').value.trim();
  if (finnhub) localStorage.setItem('voledge_finnhubKey', finnhub);
  document.getElementById('keysSaved').style.display = 'block';
  setTimeout(() => {
    document.getElementById('keysSaved').style.display = 'none';
    closeSettings();
  }, 1500);
}

function openSettings() {
  document.getElementById('finnhubKey').value = getKey('finnhubKey');
  document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings(e) {
  if (!e || e.target === document.getElementById('settingsModal')) {
    document.getElementById('settingsModal').style.display = 'none';
  }
}

// ── MARKET STATUS ──
function updateMarketStatus() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && mins >= 570 && mins < 960;
  const isPreMkt = isWeekday && mins >= 240 && mins < 570;
  const isAfterHrs = isWeekday && mins >= 960 && mins < 1200;
  const timeStr = et.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  let status = '';
  if (isOpen) status = `🟢 Market Open · ${timeStr}`;
  else if (isPreMkt) status = `🟡 Pre-Market · ${timeStr}`;
  else if (isAfterHrs) status = `🟡 After Hours · ${timeStr}`;
  else status = `⚫ Market Closed · ${timeStr}`;

  document.getElementById('marketStatus').textContent = status;
}
updateMarketStatus();
setInterval(updateMarketStatus, 60000);

// ── FILTER EVALUATION ──
function evaluateFilters() {
  const ivRank = parseFloat(document.getElementById('ivRank').value);
  const expDate = document.getElementById('expDate').value;
  const chips = [];

  if (!isNaN(ivRank)) {
    if (ivRank >= 50) chips.push({ text: `IV Rank ${ivRank}% · PASS`, cls: 'fchip-pass' });
    else if (ivRank >= 35) chips.push({ text: `IV Rank ${ivRank}% · Marginal`, cls: 'fchip-warn' });
    else chips.push({ text: `IV Rank ${ivRank}% · Too Low`, cls: 'fchip-fail' });
  }

  if (expDate) {
    const dte = Math.round((new Date(expDate) - new Date()) / 86400000);
    if (dte < 14) chips.push({ text: `${dte} DTE · Too Short`, cls: 'fchip-fail' });
    else if (dte > 60) chips.push({ text: `${dte} DTE · Consider Shorter`, cls: 'fchip-warn' });
    else chips.push({ text: `${dte} DTE · Good Window`, cls: 'fchip-pass' });
  }

  const iv30 = parseFloat(document.getElementById('iv30').value);
  const hv30 = parseFloat(document.getElementById('hv30').value);
  if (!isNaN(iv30) && !isNaN(hv30)) {
    if (iv30 > hv30) chips.push({ text: `IV > HV · Sell Favorable`, cls: 'fchip-pass' });
    else chips.push({ text: `IV < HV · Options Cheap`, cls: 'fchip-warn' });
  }

  const row = document.getElementById('filterRow');
  row.innerHTML = chips.map(c => `<span class="fchip ${c.cls}">${c.text}</span>`).join('');
}

['ivRank', 'expDate', 'iv30', 'hv30'].forEach(id => {
  document.getElementById(id).addEventListener('input', evaluateFilters);
});

// ── FETCH EARNINGS VIA FINNHUB ──
async function checkEarnings(ticker, expDate) {
  const key = getKey('finnhubKey');
  if (!key || !ticker || !expDate) return null;
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${expDate}&symbol=${ticker}&token=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.earningsCalendar && data.earningsCalendar.length > 0) {
      return data.earningsCalendar[0].date;
    }
    return null;
  } catch (e) {
    console.warn('Finnhub earnings check failed:', e);
    return null;
  }
}

// ── FETCH NEWS VIA FINNHUB ──
async function getNews(ticker) {
  const key = getKey('finnhubKey');
  if (!key || !ticker) return [];
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data) ? data.slice(0, 5) : [];
  } catch (e) {
    return [];
  }
}

// ── BUILD PROMPT ──
function buildPrompt(inputs, earningsDate, newsItems) {
  const today = new Date().toISOString().split('T')[0];
  const dte = inputs.expDate
    ? Math.round((new Date(inputs.expDate) - new Date()) / 86400000)
    : 'unknown';

  const ivVsHv = (inputs.iv30 && inputs.hv30)
    ? `IV30 ${inputs.iv30}% vs HV30 ${inputs.hv30}% — IV is ${parseFloat(inputs.iv30) > parseFloat(inputs.hv30) ? 'ELEVATED vs realized vol (favorable to sell)' : 'BELOW realized vol (caution)'}`
    : 'Not provided';

  const emPct = (inputs.expectedMove && inputs.stockPrice)
    ? `±${((parseFloat(inputs.expectedMove) / parseFloat(inputs.stockPrice)) * 100).toFixed(1)}%`
    : '';

  const earningsNote = earningsDate
    ? `EARNINGS DATE DETECTED: ${earningsDate} — this falls ${new Date(earningsDate) <= new Date(inputs.expDate) ? 'INSIDE' : 'outside'} the expiry window`
    : 'No earnings found within expiry window (or ETF)';

  const newsText = newsItems.length > 0
    ? newsItems.map(n => `- ${n.headline}`).join('\n')
    : 'No recent news fetched';

  return `You are an expert options analyst specializing in premium selling strategies. I ONLY sell premium — never suggest buying options or debit strategies.

Analyze the following data and provide a structured trade recommendation.

═══════════════════════════════
TRADE INPUTS
═══════════════════════════════
Ticker: ${inputs.ticker}
Current Price: $${inputs.stockPrice}
Target Expiration: ${inputs.expDate} (${dte} DTE)
Today's Date: ${today}

═══════════════════════════════
VOLATILITY DATA
═══════════════════════════════
IV Rank: ${inputs.ivRank ? inputs.ivRank + '%' : 'Not provided'}
${ivVsHv}
Expected Move for Expiry: ${inputs.expectedMove ? `±$${inputs.expectedMove} ${emPct}` : 'Not provided'}

═══════════════════════════════
TECHNICAL LEVELS
═══════════════════════════════
200-day MA: $${inputs.ma200 || 'Not provided'} — Stock is ${inputs.ma200pos || 'not specified'}
Key Support: $${inputs.support || 'Not provided'}
Key Resistance: $${inputs.resistance || 'Not provided'}

═══════════════════════════════
EARNINGS & NEWS
═══════════════════════════════
${earningsNote}

Recent News Headlines:
${newsText}

═══════════════════════════════
OPTIONS CHAIN DATA
═══════════════════════════════
${inputs.chainData || 'No chain data provided — base analysis on IV and technical reasoning only'}

═══════════════════════════════
ADDITIONAL CONTEXT
═══════════════════════════════
${inputs.context || 'None provided'}

═══════════════════════════════
REQUIRED OUTPUT FORMAT:
═══════════════════════════════

**1. GO / NO-GO**
One sentence verdict. Flag clearly if IV Rank is below 50% or earnings fall inside the window.

**2. STRATEGY**
Which structure fits best: iron condor, bull put spread, or bear call spread? Why.

**3. RECOMMENDED STRIKES**
For each leg state: strike, type (put/call), action (SELL/BUY), delta, % OTM, inside/outside expected move, nearest support/resistance.

**4. TRADE METRICS**
Credit collected, max loss, breakeven(s), credit as % of wing width, probability of profit.

**5. BREACH PROBABILITY ANALYSIS**
For each short strike: realistic probability of being tested before expiry. Use delta, distance vs expected move, and any macro or news catalysts.

**6. RISK FLAGS**
3-5 specific things that would invalidate this trade. Include the exact price that triggers a close or roll.

**7. FINAL RECOMMENDATION**
One line: "Sell the [strike] [put/call], buy the [strike] [put/call], expiring [date], for a minimum credit of $[X]. Close if [ticker] breaks $[price]."`;
}

// ── LOADING ANIMATION ──
let loadingTimer = null;
function animateLoading() {
  const steps = ['ls1', 'ls2', 'ls3', 'ls4', 'ls5'];
  let current = 0;
  steps.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'loading-step';
  });
  loadingTimer = setInterval(() => {
    if (current > 0) {
      const prev = document.getElementById(steps[current - 1]);
      if (prev) prev.className = 'loading-step done';
    }
    if (current < steps.length) {
      const curr = document.getElementById(steps[current]);
      if (curr) curr.className = 'loading-step active';
      current++;
    } else {
      clearInterval(loadingTimer);
    }
  }, 900);
}

function stopLoading() {
  if (loadingTimer) clearInterval(loadingTimer);
}

// ── RENDER ANALYSIS ──
function renderAnalysis(text) {
  const content = document.getElementById('analysisContent');

  // During streaming, if we don't have section 1 yet, show raw text as a live preview
  // so the user sees output immediately rather than a blank panel
  const hasFirstSection = text.includes('**1. GO / NO-GO**') ||
                          text.includes('1. GO / NO-GO');
  if (!hasFirstSection) {
    content.innerHTML = `<div class="a-section"><div class="a-section-body">
      <div class="a-text" style="opacity:0.5;font-style:italic;">${formatText(text)}</div>
    </div></div>`;
    return;
  }
  const sections = [
    { key: '**1. GO / NO-GO**', id: 'go-nogo' },
    { key: '**2. STRATEGY**', id: 'strategy' },
    { key: '**3. RECOMMENDED STRIKES**', id: 'strikes' },
    { key: '**4. TRADE METRICS**', id: 'metrics' },
    { key: '**5. BREACH PROBABILITY ANALYSIS**', id: 'breach' },
    { key: '**6. RISK FLAGS**', id: 'flags' },
    { key: '**7. FINAL RECOMMENDATION**', id: 'final' },
  ];

  let html = '';

  sections.forEach((sec, i) => {
    const plainKey = sec.key.replace(/\*\*/g, '');
    // Try bold version, plain version, and ## prefixed version
    let startIdx = text.indexOf(sec.key);
    if (startIdx === -1) startIdx = text.indexOf(plainKey);
    if (startIdx === -1) startIdx = text.indexOf('## ' + plainKey);
    if (startIdx === -1) startIdx = text.indexOf('### ' + plainKey);
    if (startIdx === -1) return;

    // Figure out where to end the slice (start of next section)
    const nextSec = sections[i + 1];
    let endIdx = text.length;
    if (nextSec) {
      const nextPlain = nextSec.key.replace(/\*\*/g, '');
      let ni = text.indexOf(nextSec.key, startIdx + 10);
      if (ni === -1) ni = text.indexOf(nextPlain, startIdx + 10);
      if (ni === -1) ni = text.indexOf('## ' + nextPlain, startIdx + 10);
      if (ni === -1) ni = text.indexOf('### ' + nextPlain, startIdx + 10);
      if (ni !== -1) endIdx = ni;
    }

    // Find the actual key length used so we slice after it cleanly
    const usedKey = [sec.key, plainKey, '## ' + plainKey, '### ' + plainKey]
      .find(k => text.indexOf(k) === startIdx) || sec.key;

    let body = text.slice(startIdx + usedKey.length, endIdx).trim()
      .replace(/\*\*/g, '')
      // Remove any leading partial word left from mid-word section cuts (e.g. "ECTION")
      .replace(/^[A-Z]{2,}\b\n/, '')
      // Strip solo # lines with no content after them
      .replace(/^#{1,3}\s*$/gm, '');

    if (sec.id === 'go-nogo') {
      const isGo = /^(go|enter|proceed|favorable|recommend|yes)/i.test(body.trim()) ||
                   (/go/i.test(body) && !/no.go|skip|avoid|do not|don't/i.test(body));
      const isNoGo = /no.go|skip|avoid|do not|don't/i.test(body);
      const cls = isGo ? 'verdict-go' : isNoGo ? 'verdict-nogo' : 'verdict-wait';
      const icon = isGo ? '✓' : isNoGo ? '✕' : '⚠';
      const label = isGo ? 'GO — Enter Trade' : isNoGo ? 'NO-GO — Skip' : 'CAUTION — Review Carefully';
      html += `<div class="verdict-banner ${cls}">
        <div class="verdict-icon">${icon}</div>
        <div><div class="verdict-label">${label}</div>
        <div class="verdict-reason">${escHtml(body)}</div></div>
      </div>`;

    } else if (sec.id === 'final') {
      html += `<div class="final-rec">
        <div class="rec-label">Final Recommendation</div>
        <div class="rec-text">${escHtml(body)}</div>
      </div>`;

    } else {
      const meta = {
        strategy: { label: 'Strategy', color: '#3b82f6' },
        strikes:  { label: 'Recommended Strikes', color: '#00d4a0' },
        metrics:  { label: 'Trade Metrics', color: '#a78bfa' },
        breach:   { label: 'Breach Probability Analysis', color: '#f59e0b' },
        flags:    { label: 'Risk Flags', color: '#ff4d6a' },
      }[sec.id] || { label: sec.id, color: '#6b7280' };

      html += `<div class="a-section">
        <div class="a-section-head">
          <div class="head-dot" style="background:${meta.color}"></div>
          ${meta.label}
        </div>
        <div class="a-section-body">
          <div class="a-text">${formatText(body)}</div>
        </div>
      </div>`;
    }
  });

  if (!html.trim()) {
    html = `<div class="a-section"><div class="a-section-body">
      <div class="raw-analysis">${escHtml(text)}</div>
    </div></div>`;
  }

  content.innerHTML = html;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Strip raw markdown dividers
    .replace(/^[-—]{2,}\s*$/gm, '')
    // Strip ## / ### headers
    .replace(/^#{1,3}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n/g, '<br>');
}

function formatText(text) {
  return text
    // HTML escape first
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Strip raw markdown dividers (--- or ——— lines)
    .replace(/^[-—]{2,}\s*$/gm, '')
    // Strip solo # lines (no text after them)
    .replace(/^#{1,3}\s*$/gm, '')
    // Strip ### and ## headers — convert to a styled inline label instead
    .replace(/^###\s*(.+)$/gm, '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin:14px 0 6px;">$1</div>')
    .replace(/^##\s*(.+)$/gm, '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin:14px 0 6px;">$1</div>')
    // Strip leading # headings too just in case
    .replace(/^#\s*(.+)$/gm, '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin:14px 0 6px;">$1</div>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Bullet lines starting with — or -
    .replace(/^[—\-] (.+)$/gm, '<div style="display:flex;gap:8px;margin-bottom:4px;"><span style="color:var(--accent);flex-shrink:0;">—</span><span>$1</span></div>')
    // Numbered list items (e.g. "1. Some risk flag")
    .replace(/^(\d+)\.\s+(.+)$/gm, '<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="color:var(--accent);flex-shrink:0;min-width:16px;">$1.</span><span>$2</span></div>')
    // Markdown table rows — strip pipe-heavy lines that leaked through
    .replace(/^\|[-| :]+\|$/gm, '')
    // Collapse 3+ newlines to 2
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}


// ── AUTO-FETCH QUOTE (price + 200MA) ──
let quoteFetchTimer = null;

async function fetchQuote(ticker) {
  if (!ticker || ticker.length < 1) return;

  const priceEl   = document.getElementById('stockPrice');
  const ma200El   = document.getElementById('ma200');
  const ma200pos  = document.getElementById('ma200pos');
  const quoteTag  = document.getElementById('quoteStatus');

  if (quoteTag) quoteTag.textContent = 'Fetching quote...';

  try {
    const res = await fetch('/api/quote?ticker=' + encodeURIComponent(ticker));
    const data = await res.json();

    if (!res.ok || data.error) {
      if (quoteTag) quoteTag.textContent = 'Could not fetch — enter manually';
      return;
    }

    if (data.price && !priceEl.value)   priceEl.value  = data.price;
    if (data.ma200 && !ma200El.value)   ma200El.value  = data.ma200;
    if (data.ma200pos && !ma200pos.value) ma200pos.value = data.ma200pos;

    if (quoteTag) {
      quoteTag.textContent = data.price
        ? 'Auto-filled: $' + data.price + ' · 200MA $' + data.ma200
        : 'Could not fetch — enter manually';
    }

    evaluateFilters();

  } catch (err) {
    if (quoteTag) quoteTag.textContent = 'Could not fetch — enter manually';
  }
}

// ── MAIN RUN FUNCTION ──
async function runAnalysis() {
  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  const stockPrice = document.getElementById('stockPrice').value.trim();
  const expDate = document.getElementById('expDate').value;

  if (!ticker) { alert('Please enter a ticker symbol.'); return; }
  if (!stockPrice) { alert('Please enter the current stock price.'); return; }
  if (!expDate) { alert('Please select a target expiration date.'); return; }

  const inputs = {
    ticker, stockPrice, expDate,
    ivRank: document.getElementById('ivRank').value,
    iv30: document.getElementById('iv30').value,
    hv30: document.getElementById('hv30').value,
    expectedMove: document.getElementById('expectedMove').value,
    ma200: document.getElementById('ma200').value,
    ma200pos: document.getElementById('ma200pos').value,
    support: document.getElementById('support').value,
    resistance: document.getElementById('resistance').value,
    chainData: document.getElementById('chainData').value,
    context: document.getElementById('context').value,
  };

  // UI: switch to loading
  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  document.getElementById('btnText').textContent = 'Analyzing...';
  document.getElementById('btnArrow').textContent = '⟳';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('resultState').style.display = 'none';
  document.getElementById('loadingState').style.display = 'flex';
  document.getElementById('loadingTicker').textContent = ticker;
  animateLoading();

  try {
    // Fetch earnings + news in parallel
    const [earningsDate, newsItems] = await Promise.all([
      checkEarnings(ticker, expDate),
      getNews(ticker),
    ]);

    const prompt = buildPrompt(inputs, earningsDate, newsItems);

    // Call our Vercel edge function — streaming response
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      let errMsg = `Server error ${response.status}`;
      try { const e = await response.json(); errMsg = e.error || errMsg; }
      catch { try { errMsg = await response.text(); } catch {} }
      throw new Error(errMsg);
    }

    // Switch from loading to result view as soon as first byte arrives
    stopLoading();
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('resultState').style.display = 'block';

    const dte = Math.round((new Date(expDate) - new Date()) / 86400000);
    document.getElementById('resultTicker').textContent = `${ticker} · $${stockPrice}`;
    document.getElementById('resultMeta').textContent =
      `${expDate} · ${dte} DTE${earningsDate ? ' · ⚠ Earnings ' + earningsDate : ''}`;

    document.querySelector('.panel-right').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Read the stream and progressively render as chunks arrive
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      renderAnalysis(accumulated);
    }

    // Final render pass on complete text
    renderAnalysis(accumulated);

  } catch (err) {
    stopLoading();
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('resultState').style.display = 'block';
    document.getElementById('resultTicker').textContent = `${ticker} — Error`;
    document.getElementById('resultMeta').textContent = 'Analysis failed';
    document.getElementById('analysisContent').innerHTML = `
      <div class="error-box">
        <strong>Something went wrong:</strong><br><br>
        ${escHtml(err.message)}<br><br>
        Common fixes:<br>
        · Make sure your CLAUDE_API_KEY environment variable is set in Vercel<br>
        · Check you have API credits at platform.claude.com<br>
        · Try redeploying on Vercel
      </div>`;
  } finally {
    btn.disabled = false;
    document.getElementById('btnText').textContent = 'Run Analysis';
    document.getElementById('btnArrow').textContent = '→';
  }
}

// ── RESET ──
function resetAnalysis() {
  document.getElementById('resultState').style.display = 'none';
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('emptyState').style.display = 'flex';
  document.getElementById('analysisContent').innerHTML = '';
}

// ── TICKER INPUT ──
document.getElementById('ticker').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const ticker = e.target.value.trim().toUpperCase();
    if (ticker) fetchQuote(ticker);
    document.getElementById('stockPrice').focus();
  }
});
document.getElementById('ticker').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
  // Debounce: fetch quote 800ms after user stops typing
  clearTimeout(quoteFetchTimer);
  const val = e.target.value.trim();
  if (val.length >= 1) {
    quoteFetchTimer = setTimeout(() => fetchQuote(val), 800);
  }
});
