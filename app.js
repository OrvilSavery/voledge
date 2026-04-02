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

  // Pre-compute IV/HV ratio for prompt context
  const ivHvRatio = (inputs.iv30 && inputs.hv30)
    ? (parseFloat(inputs.iv30) / parseFloat(inputs.hv30)).toFixed(2)
    : null;

  return `You are an expert options analyst specializing in premium SELLING strategies. The user only sells premium — NEVER suggest debit spreads, long options, or any strategy that requires paying net premium.

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
${ivVsHv}${ivHvRatio ? `\nIV/HV Ratio: ${ivHvRatio}x ${parseFloat(ivHvRatio) >= 1.3 ? '— STRONG edge to sell' : parseFloat(ivHvRatio) >= 1.0 ? '— Moderate edge' : '— WEAK edge, caution'}` : ''}
Expected Move for Expiry: ${inputs.expectedMove ? `±$${inputs.expectedMove} ${emPct}` : 'Not provided'}

═══════════════════════════════
TECHNICAL LEVELS
═══════════════════════════════
200-day MA: $${inputs.ma200 || 'Not provided'} — Stock is ${inputs.ma200pos || 'not specified'}${inputs.ma200 && inputs.stockPrice ? ` (${(((parseFloat(inputs.stockPrice) - parseFloat(inputs.ma200)) / parseFloat(inputs.ma200)) * 100).toFixed(1)}% from 200MA)` : ''}
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
STRIKE SELECTION RULES — MUST FOLLOW:
═══════════════════════════════
1. SHORT legs of any spread MUST have delta between 0.15 and 0.30 (absolute value). A delta above 0.30 on a short strike means the strike is too close to the money — do NOT recommend it. If the chain data shows no strikes in the 0.15–0.30 range, say so explicitly and widen the wing or suggest a different structure.
2. LONG (protective) legs should be 1–3 strikes further OTM than the short leg.
3. Wing width should be $2–$5 for stocks under $100, $5–$10 for stocks $100–$300.
4. Credit collected must be at least 25% of wing width. If it is not achievable with 0.15–0.30 delta shorts, flag it and explain why.

═══════════════════════════════
RISK/REWARD RULES — MUST FOLLOW:
═══════════════════════════════
1. Always calculate: Max Loss = Wing Width − Credit. State this in plain English: "You are risking $X to make $Y per contract."
2. If Max Loss > 3x Credit, label the trade POOR RISK/REWARD and explain what would need to change (wider credit, different strikes, different structure).
3. If Max Loss is 2–3x Credit, label it ACCEPTABLE but note the asymmetry.
4. If Max Loss < 2x Credit, label it FAVORABLE.

═══════════════════════════════
REQUIRED OUTPUT FORMAT — USE EXACTLY THESE HEADERS:
═══════════════════════════════

**1. GO / NO-GO**
One sentence verdict. Flag clearly if: IV Rank is below 50%, earnings fall inside the window, or no strikes exist in the 0.15–0.30 delta range.

**2. STRATEGY**
Which structure fits best: iron condor, bull put spread, or bear call spread? Why. Include one sentence on directional bias based on price vs support/resistance and 200MA.

**3. RECOMMENDED STRIKES**
For each leg: Strike | Type | Action | Delta | % OTM | vs Expected Move | vs Support/Resistance
SHORT legs must have delta 0.15–0.30. State the delta explicitly for every leg.

**4. TRADE METRICS**
— Net Credit: $X per contract
— Max Profit: $X per contract
— Max Loss: $X per contract
— Plain English: "You are risking $X to make $Y per contract."
— Risk/Reward Label: FAVORABLE / ACCEPTABLE / POOR RISK/REWARD
— Breakeven (downside): $X
— Breakeven (upside): $X
— Credit as % of Wing: X%
— Probability of Profit: X%

**5. BREACH PROBABILITY ANALYSIS**
For each short strike: realistic probability of being tested before expiry. Use delta, distance vs expected move, and any macro or news catalysts. Bull case and bear case for each side.

**6. RISK FLAGS**
3–5 specific things that would invalidate this trade. For each: what happens, at what price, and what action to take (close, roll, or hedge).

**7. FINAL RECOMMENDATION**
One paragraph max. State the full trade: legs, strikes, expiry, minimum credit to accept. State the exit plan: profit target and stop-loss price. If risk/reward is POOR, say whether to pass or adjust.`;
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

    // Call our Vercel serverless function (no CORS issues)
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Server error ${response.status}`);
    }

    const data = await response.json();
    const analysisText = data.text || '';

    stopLoading();
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('resultState').style.display = 'block';

    const dte = Math.round((new Date(expDate) - new Date()) / 86400000);
    document.getElementById('resultTicker').textContent = `${ticker} · $${stockPrice}`;
    document.getElementById('resultMeta').textContent =
      `${expDate} · ${dte} DTE${earningsDate ? ' · ⚠ Earnings ' + earningsDate : ''}`;

    renderAnalysis(analysisText);
    document.querySelector('.panel-right').scrollIntoView({ behavior: 'smooth', block: 'start' });

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
  if (e.key === 'Enter') document.getElementById('stockPrice').focus();
});
document.getElementById('ticker').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});
