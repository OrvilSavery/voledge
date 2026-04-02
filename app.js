// ─────────────────────────────────────────
//  VolEdge — Phase 1 Application Logic
// ─────────────────────────────────────────

// ── KEY STORAGE ──
function getKey(name) {
  return localStorage.getItem('voledge_' + name) || '';
}

function saveKeys() {
  const claude = document.getElementById('claudeKey').value.trim();
  const finnhub = document.getElementById('finnhubKey').value.trim();
  if (claude) localStorage.setItem('voledge_claudeKey', claude);
  if (finnhub) localStorage.setItem('voledge_finnhubKey', finnhub);
  document.getElementById('keysSaved').style.display = 'block';
  setTimeout(() => {
    document.getElementById('keysSaved').style.display = 'none';
    closeSettings();
  }, 1500);
}

function openSettings() {
  document.getElementById('claudeKey').value = getKey('claudeKey');
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
  const isOpen = isWeekday && mins >= 570 && mins < 960; // 9:30–16:00
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

  // IV Rank check
  if (!isNaN(ivRank)) {
    if (ivRank >= 50) {
      chips.push({ text: `IV Rank ${ivRank}% · PASS`, cls: 'fchip-pass' });
    } else if (ivRank >= 35) {
      chips.push({ text: `IV Rank ${ivRank}% · Marginal`, cls: 'fchip-warn' });
    } else {
      chips.push({ text: `IV Rank ${ivRank}% · Too Low`, cls: 'fchip-fail' });
    }
  }

  // Expiry check
  if (expDate) {
    const today = new Date();
    const exp = new Date(expDate);
    const dte = Math.round((exp - today) / 86400000);
    if (dte < 14) {
      chips.push({ text: `${dte} DTE · Too Short`, cls: 'fchip-fail' });
    } else if (dte > 60) {
      chips.push({ text: `${dte} DTE · Consider Shorter`, cls: 'fchip-warn' });
    } else {
      chips.push({ text: `${dte} DTE · Good Window`, cls: 'fchip-pass' });
    }
  }

  // IV vs HV
  const iv30 = parseFloat(document.getElementById('iv30').value);
  const hv30 = parseFloat(document.getElementById('hv30').value);
  if (!isNaN(iv30) && !isNaN(hv30)) {
    if (iv30 > hv30) {
      chips.push({ text: `IV > HV · Sell Favorable`, cls: 'fchip-pass' });
    } else {
      chips.push({ text: `IV < HV · Options Cheap`, cls: 'fchip-warn' });
    }
  }

  const row = document.getElementById('filterRow');
  row.innerHTML = chips.map(c =>
    `<span class="fchip ${c.cls}">${c.text}</span>`
  ).join('');
}

// attach live filter evaluation
['ivRank', 'expDate', 'iv30', 'hv30'].forEach(id => {
  document.getElementById(id).addEventListener('input', evaluateFilters);
});

// ── FETCH EARNINGS VIA FINNHUB ──
async function checkEarnings(ticker, expDate) {
  const key = getKey('finnhubKey');
  if (!key || !ticker || !expDate) return null;
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${expDate}&symbol=${ticker.toUpperCase()}&token=${key}`;
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

// ── FETCH COMPANY NEWS VIA FINNHUB ──
async function getNews(ticker) {
  const key = getKey('finnhubKey');
  if (!key || !ticker) return [];
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const url = `https://finnhub.io/api/v1/company-news?symbol=${ticker.toUpperCase()}&from=${from}&to=${to}&token=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data) ? data.slice(0, 5) : [];
  } catch (e) {
    return [];
  }
}

// ── BUILD THE ANALYSIS PROMPT ──
function buildPrompt(inputs, earningsDate, newsItems) {
  const today = new Date().toISOString().split('T')[0];
  const expDate = inputs.expDate;
  const dte = expDate
    ? Math.round((new Date(expDate) - new Date()) / 86400000)
    : 'unknown';

  const ivVsHv = (inputs.iv30 && inputs.hv30)
    ? `IV30 ${inputs.iv30}% vs HV30 ${inputs.hv30}% — IV is ${parseFloat(inputs.iv30) > parseFloat(inputs.hv30) ? 'ELEVATED vs realized vol (favorable to sell)' : 'BELOW realized vol (options may be cheap — caution)'}`
    : 'Not provided';

  const emPct = (inputs.expectedMove && inputs.stockPrice)
    ? `±${((parseFloat(inputs.expectedMove) / parseFloat(inputs.stockPrice)) * 100).toFixed(1)}%`
    : '';

  const earningsNote = earningsDate
    ? `EARNINGS DATE DETECTED: ${earningsDate} — this falls ${new Date(earningsDate) <= new Date(expDate) ? 'INSIDE' : 'outside'} the expiry window`
    : 'No earnings found within expiry window (or ETF)';

  const newsText = newsItems.length > 0
    ? newsItems.map(n => `- ${n.headline}`).join('\n')
    : 'No recent news fetched';

  return `You are an expert options analyst specializing in premium selling strategies. I ONLY sell premium — never suggest buying options or debit strategies.

Analyze the following data and provide a structured trade recommendation.

═══════════════════════════════
TRADE INPUTS
═══════════════════════════════
Ticker: ${inputs.ticker || 'Not provided'}
Current Price: $${inputs.stockPrice || 'Not provided'}
Target Expiration: ${inputs.expDate || 'Not provided'} (${dte} DTE)
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
REQUIRED OUTPUT — Follow this exact format:
═══════════════════════════════

**1. GO / NO-GO**
One sentence verdict. If IV Rank is below 50% say so clearly. If earnings fall inside the window, flag it as a hard block.

**2. STRATEGY**
Which structure fits best and why: iron condor, bull put spread, or bear call spread? Base this on directional bias from the 200MA position, support/resistance, and IV skew.

**3. RECOMMENDED STRIKES**
List specific strikes with:
— Strike price
— Option type (put/call)
— Action (SELL / BUY)
— Delta (from chain data if available, or estimate)
— Distance from current price (% OTM)
— Whether inside or outside the expected move
— Nearest technical level (support or resistance) that protects it

**4. TRADE METRICS**
— Estimated credit (use mid prices from chain if available)
— Max loss
— Breakeven price(s)
— Credit as % of wing width
— Probability of profit

**5. BREACH PROBABILITY ANALYSIS**
For each short strike, assess the realistic probability it gets tested before expiration. Consider:
— Delta-implied probability
— Distance vs expected move
— Macro or news catalysts that could push price toward that level
— Proximity to key support/resistance

**6. RISK FLAGS**
List 3–5 specific things that would invalidate this trade. Include a specific price level that would trigger a close or roll.

**7. FINAL RECOMMENDATION**
One line only: "Sell the [strike] [put/call], buy the [strike] [put/call], expiring [date], for a minimum credit of $[X]. Close if [ticker] breaks $[price]."

Be specific, be direct. No hedging language. If the trade setup is poor, say skip and explain why clearly.`;
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

// ── PARSE & RENDER ANALYSIS ──
function renderAnalysis(text, inputs) {
  // Try to render nicely structured output
  const content = document.getElementById('analysisContent');

  // Parse sections from the markdown-ish response
  const sections = [
    { key: '1. GO / NO-GO', id: 'go-nogo' },
    { key: '2. STRATEGY', id: 'strategy' },
    { key: '3. RECOMMENDED STRIKES', id: 'strikes' },
    { key: '4. TRADE METRICS', id: 'metrics' },
    { key: '5. BREACH PROBABILITY', id: 'breach' },
    { key: '6. RISK FLAGS', id: 'flags' },
    { key: '7. FINAL RECOMMENDATION', id: 'final' },
  ];

  let html = '';

  // Try to extract each section
  sections.forEach((sec, i) => {
    const startMarker = `**${sec.key}**`;
    const nextMarker = i + 1 < sections.length ? `**${i + 2}.` : null;

    let startIdx = text.indexOf(startMarker);
    if (startIdx === -1) {
      // Try without ** markers
      startIdx = text.indexOf(sec.key);
    }
    if (startIdx === -1) return;

    let endIdx = text.length;
    if (nextMarker) {
      const nextIdx = text.indexOf(nextMarker, startIdx + 10);
      if (nextIdx !== -1) endIdx = nextIdx;
    }

    let sectionText = text.slice(startIdx + startMarker.length, endIdx).trim();
    // Clean up markdown bold markers
    sectionText = sectionText.replace(/\*\*/g, '');

    // Special rendering per section
    if (sec.id === 'go-nogo') {
      const isGo = /go|enter|proceed|favorable|recommend/i.test(sectionText) &&
                   !/no.go|skip|avoid|wait|do not|don't/i.test(sectionText);
      const isNoGo = /no.go|skip|avoid|do not|don't/i.test(sectionText);
      const bannerClass = isGo ? 'verdict-go' : isNoGo ? 'verdict-nogo' : 'verdict-wait';
      const icon = isGo ? '✓' : isNoGo ? '✕' : '⚠';
      const label = isGo ? 'GO — Enter Trade' : isNoGo ? 'NO-GO — Skip' : 'CAUTION — Review';

      html += `
        <div class="verdict-banner ${bannerClass}">
          <div class="verdict-icon">${icon}</div>
          <div>
            <div class="verdict-label">${label}</div>
            <div class="verdict-reason">${escHtml(sectionText)}</div>
          </div>
        </div>`;

    } else if (sec.id === 'final') {
      html += `
        <div class="final-rec">
          <div class="rec-label">Final Recommendation</div>
          <div class="rec-text">${escHtml(sectionText)}</div>
        </div>`;

    } else {
      const sectionTitles = {
        'strategy': { label: 'Strategy', color: '#3b82f6' },
        'strikes': { label: 'Recommended Strikes', color: '#00d4a0' },
        'metrics': { label: 'Trade Metrics', color: '#a78bfa' },
        'breach': { label: 'Breach Probability Analysis', color: '#f59e0b' },
        'flags': { label: 'Risk Flags', color: '#ff4d6a' },
      };

      const meta = sectionTitles[sec.id] || { label: sec.key, color: '#6b7280' };

      html += `
        <div class="a-section">
          <div class="a-section-head">
            <div class="head-dot" style="background:${meta.color}"></div>
            ${meta.label}
          </div>
          <div class="a-section-body">
            <div class="a-text">${formatSectionText(sectionText)}</div>
          </div>
        </div>`;
    }
  });

  // If parsing failed, just show raw text nicely
  if (!html.trim()) {
    html = `<div class="a-section">
      <div class="a-section-body">
        <div class="raw-analysis">${escHtml(text)}</div>
      </div>
    </div>`;
  }

  content.innerHTML = html;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function formatSectionText(text) {
  // Convert — bullets and line breaks to nice HTML
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^— (.+)$/gm, '<div style="display:flex;gap:8px;margin-bottom:4px;"><span style="color:var(--accent);flex-shrink:0;">—</span><span>$1</span></div>')
    .replace(/^- (.+)$/gm, '<div style="display:flex;gap:8px;margin-bottom:4px;"><span style="color:var(--accent);flex-shrink:0;">·</span><span>$1</span></div>')
    .replace(/\n\n/g, '</p><p style="margin-top:10px;">')
    .replace(/\n/g, '<br>');
}

// ── MAIN ANALYSIS FUNCTION ──
async function runAnalysis() {
  const claudeKey = getKey('claudeKey');
  if (!claudeKey) {
    openSettings();
    return;
  }

  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  const stockPrice = document.getElementById('stockPrice').value.trim();
  const expDate = document.getElementById('expDate').value;

  if (!ticker) {
    alert('Please enter a ticker symbol.');
    return;
  }
  if (!stockPrice) {
    alert('Please enter the current stock price.');
    return;
  }
  if (!expDate) {
    alert('Please select a target expiration date.');
    return;
  }

  const inputs = {
    ticker,
    stockPrice,
    expDate,
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

  // Switch to loading state
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
    // Fetch earnings and news in parallel
    const [earningsDate, newsItems] = await Promise.all([
      checkEarnings(ticker, expDate),
      getNews(ticker),
    ]);

    // Build the prompt
    const prompt = buildPrompt(inputs, earningsDate, newsItems);

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-calls': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `API error ${response.status}`);
    }

    const data = await response.json();
    const analysisText = data.content[0]?.text || '';

    stopLoading();

    // Show result
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('resultState').style.display = 'block';

    const dte = Math.round((new Date(expDate) - new Date()) / 86400000);
    document.getElementById('resultTicker').textContent = `${ticker} · $${stockPrice}`;
    document.getElementById('resultMeta').textContent =
      `${expDate} · ${dte} DTE${earningsDate ? ' · ⚠ Earnings ' + earningsDate : ''}`;

    renderAnalysis(analysisText, inputs);

    // Scroll to results on mobile
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
        · Check your Claude API key is correct (click ⚙ bottom right)<br>
        · Make sure you have API credits at platform.claude.com<br>
        · Check your internet connection
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

// ── ENTER KEY SHORTCUT ──
document.getElementById('ticker').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('stockPrice').focus();
});

// ── AUTO-UPPERCASE TICKER ──
document.getElementById('ticker').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// ── CHECK KEYS ON LOAD ──
window.addEventListener('load', () => {
  if (!getKey('claudeKey')) {
    // Small delay so page renders first
    setTimeout(openSettings, 500);
  }
});
