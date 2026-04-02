// ─────────────────────────────────────────
//  VolEdge — App Logic
// ─────────────────────────────────────────

// ── KEY STORAGE ──
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

// ── FILTER CHIPS ──
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
  document.getElementById('filterRow').innerHTML =
    chips.map(c => `<span class="fchip ${c.cls}">${c.text}</span>`).join('');
}
['ivRank', 'expDate', 'iv30', 'hv30'].forEach(id => {
  document.getElementById(id).addEventListener('input', evaluateFilters);
});

// ── FINNHUB: EARNINGS ──
async function checkEarnings(ticker, expDate) {
  const key = getKey('finnhubKey');
  if (!key || !ticker || !expDate) return null;
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${expDate}&symbol=${ticker}&token=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.earningsCalendar && data.earningsCalendar.length > 0)
      ? data.earningsCalendar[0].date : null;
  } catch (e) { return null; }
}

// ── FINNHUB: NEWS ──
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
  } catch { return []; }
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

  const ivHvRatio = (inputs.iv30 && inputs.hv30)
    ? (parseFloat(inputs.iv30) / parseFloat(inputs.hv30)).toFixed(2) : null;

  const emPct = (inputs.expectedMove && inputs.stockPrice)
    ? `±${((parseFloat(inputs.expectedMove) / parseFloat(inputs.stockPrice)) * 100).toFixed(1)}%` : '';

  const ma200dist = (inputs.ma200 && inputs.stockPrice)
    ? ` (${(((parseFloat(inputs.stockPrice) - parseFloat(inputs.ma200)) / parseFloat(inputs.ma200)) * 100).toFixed(1)}% from 200MA)` : '';

  const earningsNote = earningsDate
    ? `EARNINGS DATE DETECTED: ${earningsDate} — this falls ${new Date(earningsDate) <= new Date(inputs.expDate) ? 'INSIDE' : 'outside'} the expiry window`
    : 'No earnings found within expiry window (or ETF)';

  const newsText = newsItems.length > 0
    ? newsItems.map(n => `- ${n.headline}`).join('\n') : 'No recent news fetched';

  return `You are an expert options analyst specializing in premium SELLING strategies. The user ONLY sells premium — never suggest debit spreads or buying options.

═══════════════════════════════
TRADE INPUTS
═══════════════════════════════
Ticker: ${inputs.ticker}
Current Price: $${inputs.stockPrice}
Target Expiration: ${inputs.expDate} (${dte} DTE)
Today: ${today}

═══════════════════════════════
VOLATILITY
═══════════════════════════════
IV Rank: ${inputs.ivRank ? inputs.ivRank + '%' : 'Not provided'}
${ivVsHv}${ivHvRatio ? `\nIV/HV Ratio: ${ivHvRatio}x` : ''}
Expected Move: ${inputs.expectedMove ? `±$${inputs.expectedMove} ${emPct}` : 'Not provided'}

═══════════════════════════════
TECHNICALS
═══════════════════════════════
200-day MA: $${inputs.ma200 || 'Not provided'} — ${inputs.ma200pos || 'not specified'}${ma200dist}
Support: $${inputs.support || 'Not provided'}
Resistance: $${inputs.resistance || 'Not provided'}

═══════════════════════════════
EARNINGS & NEWS
═══════════════════════════════
${earningsNote}
${newsText}

═══════════════════════════════
OPTIONS CHAIN
═══════════════════════════════
${inputs.chainData || 'No chain data — base on IV and technicals only'}

═══════════════════════════════
CONTEXT
═══════════════════════════════
${inputs.context || 'None'}

═══════════════════════════════
RULES
═══════════════════════════════
STRIKE RULES: Short legs must have delta 0.15–0.30. If none exist in that range, say so and recommend what structure is still viable.
RISK/REWARD: Always state max loss in plain English: "You are risking $X to make $Y." Label: FAVORABLE (<2x), ACCEPTABLE (2-3x), or POOR (>3x).

═══════════════════════════════
OUTPUT FORMAT — FOLLOW EXACTLY:
═══════════════════════════════
Use these EXACT headers with ** on both sides. No ##. No other formatting for headers.

**1. GO / NO-GO**
One sentence. Flag if IV Rank below 50%, earnings inside window, or no valid delta strikes.

**2. STRATEGY**
Best structure and why. One sentence on directional bias.

**3. RECOMMENDED STRIKES**
Leg | Strike | Type | Action | Delta | % OTM | vs Expected Move | vs S/R

**4. TRADE METRICS**
Net Credit | Max Profit | Max Loss | Plain English risk | Risk/Reward Label | Breakeven Down | Breakeven Up | Credit % of Wing | PoP

**5. BREACH PROBABILITY ANALYSIS**
Each short strike: probability, distance from expected move, top catalyst.

**6. RISK FLAGS**
3 rows only: Risk | Trigger Price | Action

**7. FINAL RECOMMENDATION**
Two sentences: entry (legs/strikes/expiry/min credit) + exit (profit target and stop price).`;
}

// ── LOADING ANIMATION ──
let loadingTimer = null;
function animateLoading() {
  const steps = ['ls1', 'ls2', 'ls3', 'ls4', 'ls5'];
  let current = 0;
  steps.forEach(id => { const el = document.getElementById(id); if (el) el.className = 'loading-step'; });
  loadingTimer = setInterval(() => {
    if (current > 0) { const prev = document.getElementById(steps[current - 1]); if (prev) prev.className = 'loading-step done'; }
    if (current < steps.length) { const curr = document.getElementById(steps[current]); if (curr) curr.className = 'loading-step active'; current++; }
    else clearInterval(loadingTimer);
  }, 900);
}
function stopLoading() { if (loadingTimer) clearInterval(loadingTimer); }

// ── SECTION PARSER ──
function findSectionStart(text, key, after) {
  after = after || 0;
  const plain = key.replace(/\*\*/g, '');
  const variants = [key, plain, '## ' + plain, '### ' + plain];
  let best = -1, bestLen = 0;
  for (const v of variants) {
    const idx = text.indexOf(v, after);
    if (idx !== -1 && (best === -1 || idx < best)) { best = idx; bestLen = v.length; }
  }
  return best === -1 ? null : { idx: best, len: bestLen };
}

// ── RENDER ANALYSIS ──
function renderAnalysis(text) {
  const content = document.getElementById('analysisContent');
  const sections = [
    { key: '**1. GO / NO-GO**',               id: 'go-nogo'   },
    { key: '**2. STRATEGY**',                  id: 'strategy'  },
    { key: '**3. RECOMMENDED STRIKES**',       id: 'strikes'   },
    { key: '**4. TRADE METRICS**',             id: 'metrics'   },
    { key: '**5. BREACH PROBABILITY ANALYSIS**', id: 'breach'  },
    { key: '**6. RISK FLAGS**',                id: 'flags'     },
    { key: '**7. FINAL RECOMMENDATION**',      id: 'final'     },
  ];

  let html = '';
  sections.forEach((sec, i) => {
    const found = findSectionStart(text, sec.key);
    if (!found) return;
    const { idx: startIdx, len: keyLen } = found;

    const nextSec = sections[i + 1];
    let endIdx = text.length;
    if (nextSec) {
      const nextFound = findSectionStart(text, nextSec.key, startIdx + 10);
      if (nextFound) endIdx = nextFound.idx;
    }

    let body = text.slice(startIdx + keyLen, endIdx).trim()
      .replace(/\*\*/g, '')
      .replace(/^#{1,3}\s*$/gm, '');

    if (sec.id === 'go-nogo') {
      const isNoGo = /no.go|skip|avoid|do not|don't/i.test(body);
      const isGo = !isNoGo && (/^go/i.test(body.trim()) || /\bgo\b/i.test(body));
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
        strategy: { label: 'Strategy',                    color: '#3b82f6' },
        strikes:  { label: 'Recommended Strikes',         color: '#00d4a0' },
        metrics:  { label: 'Trade Metrics',               color: '#a78bfa' },
        breach:   { label: 'Breach Probability Analysis', color: '#f59e0b' },
        flags:    { label: 'Risk Flags',                  color: '#ff4d6a' },
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
    .replace(/^[-—]{2,}\s*$/gm, '')
    .replace(/^#{1,3}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n/g, '<br>');
}

function formatText(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^[-—]{2,}\s*$/gm, '')
    .replace(/^#{1,3}\s*$/gm, '')
    .replace(/^###\s*(.+)$/gm, '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin:14px 0 6px;">$1</div>')
    .replace(/^##\s*(.+)$/gm, '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin:14px 0 6px;">$1</div>')
    .replace(/^#\s*(.+)$/gm, '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin:14px 0 6px;">$1</div>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^[—\-] (.+)$/gm, '<div style="display:flex;gap:8px;margin-bottom:4px;"><span style="color:var(--accent);flex-shrink:0;">—</span><span>$1</span></div>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="color:var(--accent);flex-shrink:0;min-width:16px;">$1.</span><span>$2</span></div>')
    .replace(/^\|[-| :]+\|$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

// ── MAIN RUN ──
async function runAnalysis() {
  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  const stockPrice = document.getElementById('stockPrice').value.trim();
  const expDate = document.getElementById('expDate').value;

  if (!ticker) { alert('Please enter a ticker symbol.'); return; }
  if (!stockPrice) { alert('Please enter the current stock price.'); return; }
  if (!expDate) { alert('Please select a target expiration date.'); return; }

  const inputs = {
    ticker, stockPrice, expDate,
    ivRank:       document.getElementById('ivRank').value,
    iv30:         document.getElementById('iv30').value,
    hv30:         document.getElementById('hv30').value,
    expectedMove: document.getElementById('expectedMove').value,
    ma200:        document.getElementById('ma200').value,
    ma200pos:     document.getElementById('ma200pos').value,
    support:      document.getElementById('support').value,
    resistance:   document.getElementById('resistance').value,
    chainData:    document.getElementById('chainData').value,
    context:      document.getElementById('context').value,
  };

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
    const [earningsDate, newsItems] = await Promise.all([
      checkEarnings(ticker, expDate),
      getNews(ticker),
    ]);

    const prompt = buildPrompt(inputs, earningsDate, newsItems);

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
        · Make sure CLAUDE_API_KEY is set in Vercel environment variables<br>
        · Check API credits at platform.claude.com<br>
        · Redeploy on Vercel after any env var changes
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
