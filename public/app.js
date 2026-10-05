// ==================== STATE ====================
let isRunning = false;
let startTime = null;
let pollInterval = null;
let tradingChart = null;
let lastFetchOk = true;
let lastSeenCloseTs = 0;
let currentTab = 'trading';
let consecutiveFetchFails = 0;
const MAX_SILENT_FAILS = 3;

// ==================== UTILITIES ====================
function fmtUsd(n, decimals = 2) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '$0.00';
  return '$' + num.toLocaleString('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
}

function showToast(msg, type = 'error') {
  const toast = document.getElementById('toast');
  const box = document.getElementById('toastBox');
  if (!toast || !box) return;
  box.innerText = msg;
  box.className = `px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-lg ${
    type === 'error' ? 'bg-red-500/90' : 'bg-emerald-500/90'
  }`;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 2500);
}

function pctColor(v) {
  if (v == null) return 'text-gray-400';
  return v >= 0 ? 'text-emerald-400' : 'text-red-400';
}

// ==================== TAB SYSTEM ====================
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  currentTab = tab;

  document.querySelectorAll('.tab-btn').forEach(b => {
    if (b.dataset.tab === tab) {
      b.classList.add('tab-active', 'text-white');
      b.classList.remove('text-gray-400');
    } else {
      b.classList.remove('tab-active', 'text-white');
      b.classList.add('text-gray-400');
    }
  });

  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.dataset.tab === tab) b.classList.add('nav-btn-active');
    else b.classList.remove('nav-btn-active');
  });

  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  const el = document.getElementById(`tab-${tab}`);
  if (el) el.classList.remove('hidden');

  if (tab === 'trading' && tradingChart) {
    setTimeout(() => tradingChart.resize(), 50);
  }
}

// ==================== EMOTION TRIGGER ====================
function triggerEmotion(type, message) {
  const bubble = document.getElementById('speechBubble');
  const bubbleText = document.getElementById('speechText');
  const svg = document.querySelector('.robot-3d-scene');
  if (!bubble || !bubbleText || !svg) return;

  svg.classList.remove('robot-happy', 'robot-sad');
  bubble.classList.remove('bubble-happy', 'bubble-sad', 'hidden');

  if (type === 'PROFIT') {
    svg.classList.add('robot-happy');
    bubble.classList.add('bubble-happy');
  } else {
    svg.classList.add('robot-sad');
    bubble.classList.add('bubble-sad');
  }

  bubbleText.innerText = message || (type === 'PROFIT'
    ? 'Horee!!! Berhasil profit'
    : 'Yaah!! Gagal nih aku coba lagi ya');

  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';

  clearTimeout(triggerEmotion._t);
  triggerEmotion._t = setTimeout(() => {
    bubble.classList.add('hidden');
    svg.classList.remove('robot-happy', 'robot-sad');
  }, 5000);
}

function checkCloseEvent(d) {
  if (!d || !d.lastCloseEvent) return;
  const evt = d.lastCloseEvent;
  if (evt.timestamp === lastSeenCloseTs) return;
  lastSeenCloseTs = evt.timestamp;
  triggerEmotion(evt.type, evt.message);
}

// ==================== CHART.JS ====================
const chartCtx = document.getElementById('tradingChart')?.getContext('2d');
if (chartCtx) {
  tradingChart = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'BTC/USDT',
        data: [],
        borderColor: '#f7931a',
        backgroundColor: 'rgba(247, 147, 26, 0.12)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointBackgroundColor: '#f7931a'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(31, 41, 55, 0.4)' }, ticks: { color: '#9ca3af', font: { size: 9 } } },
        y: { grid: { color: 'rgba(31, 41, 55, 0.4)' }, ticks: { color: '#9ca3af', font: { size: 9 } } }
      },
      animation: { duration: 300 }
    }
  });
}

function updateLiveChart(newPrice) {
  if (!tradingChart) return;
  const price = parseFloat(newPrice);
  if (!Number.isFinite(price)) return;
  const now = new Date();
  const t = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  if (tradingChart.data.labels.length > 20) {
    tradingChart.data.labels.shift();
    tradingChart.data.datasets[0].data.shift();
  }
  tradingChart.data.labels.push(t);
  tradingChart.data.datasets[0].data.push(price);
  tradingChart.update();
}

// ==================== BOT CONTROL ====================
const toggleBtn = document.getElementById('toggleBtn');
toggleBtn?.addEventListener('click', async () => {
  const endpoint = isRunning ? '/api/stop-bot' : '/api/start-bot';
  const key = localStorage.getItem('controlKey') || '';
  const url = key ? `${endpoint}?key=${encodeURIComponent(key)}` : endpoint;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.success) {
      showToast(json.message || 'OK', 'success');
      setBotUIState(!isRunning);
      setTimeout(syncWithServer, 400);
    } else {
      showToast(json.message || 'Gagal');
    }
  } catch (e) {
    showToast('Gagal menghubungi server');
  }
});

function setBotUIState(running) {
  isRunning = running;
  const badge = document.getElementById('botBadge');
  const statusText = document.getElementById('botStatusText');
  const liveIndicator = document.getElementById('liveIndicator');
  const chartStatus = document.getElementById('chartStatusLabel');

  if (running) {
    if (!startTime) startTime = Date.now();
    if (badge) {
      badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 flex items-center space-x-1.5 glow-green';
      badge.querySelector('span').className = 'w-2 h-2 rounded-full bg-emerald-500 pulse-dot';
    }
    if (statusText) statusText.innerText = 'Aktif';
    if (toggleBtn) {
      toggleBtn.innerText = 'Hentikan Bot';
      toggleBtn.className = 'px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-red-600/30';
    }
    if (liveIndicator) liveIndicator.innerText = 'Live';
    if (chartStatus) { chartStatus.innerText = 'Live'; chartStatus.className = 'text-emerald-400'; }
  } else {
    startTime = null;
    if (badge) {
      badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700 flex items-center space-x-1.5';
      badge.querySelector('span').className = 'w-2 h-2 rounded-full bg-gray-500 pulse-dot';
    }
    if (statusText) statusText.innerText = 'Standby';
    if (toggleBtn) {
      toggleBtn.innerText = 'Mulai Bot';
      toggleBtn.className = 'px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-orange-600/35';
    }
    if (liveIndicator) liveIndicator.innerText = 'Standby';
    if (chartStatus) { chartStatus.innerText = 'Standby'; chartStatus.className = 'text-gray-500'; }
    const uptimeEl = document.getElementById('botUptime');
    if (uptimeEl) uptimeEl.innerText = '0j 0m';
  }
}

// ==================== SYNC (DENGAN TIMEOUT + SMART TOAST) ====================
async function syncWithServer() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch('/api/bot-status', {
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();

    // Recovery: kalau sebelumnya gagal berkali-kali dan sekarang berhasil
    if (!lastFetchOk && consecutiveFetchFails >= MAX_SILENT_FAILS) {
      showToast('Koneksi pulih', 'success');
    }
    consecutiveFetchFails = 0;
    lastFetchOk = true;

    if (json.running !== isRunning) setBotUIState(json.running);
    if (json.data) renderData(json.data);
  } catch (err) {
    clearTimeout(timeoutId);
    consecutiveFetchFails++;

    // Toast hanya muncul setelah 3x gagal berturut-turut
    if (consecutiveFetchFails === MAX_SILENT_FAILS) {
      lastFetchOk = false;
      showToast(`Server tidak merespon (${consecutiveFetchFails}x)`);
    }
    console.warn(`Sync error (${consecutiveFetchFails}):`, err.message);
  }
}

// ==================== MAIN RENDER ====================
function renderData(d) {
  // Price & Chart
  if (d.price) {
    const priceEl = document.getElementById('crypto-price');
    if (priceEl) priceEl.innerText = fmtUsd(parseFloat(d.price));
    if (isRunning) updateLiveChart(d.price);
  }

  // Change %
  const changeEl = document.getElementById('crypto-change');
  if (changeEl && d.change !== undefined) {
    const c = Number(d.change) || 0;
    changeEl.innerText = `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`;
    changeEl.className = `text-xs block font-semibold ${c >= 0 ? 'text-emerald-400' : 'text-red-400'}`;
  }

  // Account
  const balance = Number(d.balance) || 10000;
  const balanceDisplay = document.getElementById('balance-display');
  if (balanceDisplay) balanceDisplay.innerText = fmtUsd(balance, 2);

  const lotEl = document.getElementById('dynamic-lot');
  if (lotEl && d.dynamicLot) lotEl.innerText = d.dynamicLot;

  const totalProfit = balance - 10000;
  const profitPct = ((totalProfit / 10000) * 100).toFixed(2);
  const profitText = `${totalProfit >= 0 ? '+' : '-'}${fmtUsd(Math.abs(totalProfit))}`;
  const profitColor = pctColor(totalProfit);

  const pnlToday = document.getElementById('todayPnL');
  const pnlVirtual = document.getElementById('virtual-pnl');
  const profitPctEl = document.getElementById('profitPercentage');

  if (pnlToday) { pnlToday.innerText = profitText; pnlToday.className = `text-base font-bold ${profitColor}`; }
  if (pnlVirtual) { pnlVirtual.innerText = profitText; pnlVirtual.className = `text-base font-bold ${profitColor}`; }
  if (profitPctEl) {
    profitPctEl.innerText = `(${profitPct >= 0 ? '+' : ''}${profitPct}%)`;
    profitPctEl.className = `text-[10px] ${profitColor} bg-${totalProfit >= 0 ? 'emerald' : 'red'}-500/10 px-1 py-0.5 rounded font-semibold`;
  }

  const unrealized = Number(d.totalCurrentPnl) || 0;
  const floatEl = document.getElementById('floating-pnl');
  if (floatEl) {
    floatEl.innerText = `${unrealized >= 0 ? '+' : '-'}${fmtUsd(Math.abs(unrealized))}`;
    floatEl.className = `text-base font-bold ${pctColor(unrealized)}`;
  }

  const cycleEl = document.getElementById('cycleCountText');
  if (cycleEl) cycleEl.innerText = `Siklus: ${d.cycleCount ?? 0}`;

  // Active position indicator
  const posIndicator = document.getElementById('activePosIndicator');
  const activeCount = Number(d.activeTradesCount) || 0;
  if (posIndicator) {
    posIndicator.innerText = `Posisi: ${activeCount}`;
    posIndicator.className = `badge-pill ${activeCount > 0 ? (unrealized >= 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20') : ''}`;
  }

  // Indicators
  if (d.indicators) {
    const rsiEl = document.getElementById('ind-rsi');
    const emaEl = document.getElementById('ind-ema');
    const macdEl = document.getElementById('ind-macd');

    if (rsiEl) rsiEl.innerText = d.indicators.rsi ?? '—';
    if (emaEl) emaEl.innerText = d.indicators.ema20 ?? '—';

    if (macdEl) {
      const s = d.indicators.macdStatus || '';
      if (s.includes('GOLDEN')) { macdEl.innerText = 'GOLDEN ⬆'; macdEl.className = 'text-[10px] font-bold text-emerald-400 truncate block'; }
      else if (s.includes('DEATH')) { macdEl.innerText = 'DEATH ⬇'; macdEl.className = 'text-[10px] font-bold text-red-400 truncate block'; }
      else if (s.includes('Belum')) { macdEl.innerText = 'WARMUP'; macdEl.className = 'text-[10px] font-bold text-gray-400 truncate block'; }
      else { macdEl.innerText = 'NEUTRAL'; macdEl.className = 'text-[10px] font-bold text-indigo-400 truncate block'; }
    }

    const trendBadge = document.getElementById('trendBadge');
    if (trendBadge && d.indicators.trend) {
      const isUp = d.indicators.trend.includes('UP');
      trendBadge.innerText = isUp ? '📈 UPTREND' : '📉 DOWNTREND';
      trendBadge.className = `badge-pill ${isUp ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-red-400 bg-red-500/10 border-red-500/30'}`;
    }
  }

  // Confidence
  const confBadge = document.getElementById('confidenceBadge');
  if (confBadge) {
    if (d.confidence != null) {
      const pct = Math.round(d.confidence * 100);
      confBadge.innerText = `Conf: ${pct}%`;
      let cls = 'badge-pill ';
      if (pct >= 70) cls += 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      else if (pct >= 40) cls += 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      else cls += 'text-gray-400';
      confBadge.className = cls;
    } else {
      confBadge.innerText = 'Conf: —';
      confBadge.className = 'badge-pill';
    }
  }

  // AI analysis
  const aiText = document.getElementById('ai-status-text');
  if (aiText && d.analysis) aiText.innerText = d.analysis;

  // Trades & History
  renderActiveTrades(d.activeTrades, d.price);
  renderHistoryTable(d.tradeHistory);
  renderMarketMemory(d.marketMemory);

  // Level 5
  renderEnsemble(d.ensemble);
  renderFeatureScore(d.featureScore);
  renderMarketContext(d.marketContext, d.indicators);
  renderDynamicParams(d.dynamicParams);
  renderCalibration(d.confidenceCalibration);
  renderBestPatterns(d.bestPatterns, d.patternStats);
  renderMetrics(d.metrics, d.streak, d.winRate);

  // Last update
  const lu = document.getElementById('lastUpdate');
  if (lu && d.timestamp) lu.innerText = d.timestamp;

  // Emotion
  checkCloseEvent(d);
}

// ==================== RENDER: ENSEMBLE ====================
function renderEnsemble(ens) {
  if (!ens) return;

  const consEl = document.getElementById('ensembleConsensus');
  if (consEl) {
    consEl.innerText = ens.consensus || '—';
    if (ens.consensus === 'BUY') consEl.className = 'text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30';
    else if (ens.consensus === 'SELL') consEl.className = 'text-[10px] font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30';
    else consEl.className = 'text-[10px] font-bold bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700';
  }

  const buyPctEl = document.getElementById('ensembleBuyPct');
  const sellPctEl = document.getElementById('ensembleSellPct');
  if (buyPctEl) buyPctEl.innerText = `${ens.buyPct ?? 0}%`;
  if (sellPctEl) sellPctEl.innerText = `${ens.sellPct ?? 0}%`;

  const sigList = document.getElementById('ensembleSignals');
  if (!sigList || !ens.signals) return;

  const entries = Object.entries(ens.signals);
  sigList.innerHTML = entries.map(([name, sig]) => {
    const isBuy = sig.signal === 'BUY';
    const isSell = sig.signal === 'SELL';
    const color = isBuy ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                : isSell ? 'text-red-400 bg-red-500/10 border-red-500/30'
                : 'text-gray-400 bg-gray-800 border-gray-700';
    const label = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const strength = Math.round((sig.strength || 0) * 100);
    return `
      <div class="flex justify-between items-center px-2 py-1.5 rounded-lg border ${color}">
        <span class="text-[10px] font-semibold">${label}</span>
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-bold">${sig.signal}</span>
          <span class="text-[9px] opacity-70">${strength}%</span>
        </div>
      </div>
    `;
  }).join('');

  const statsList = document.getElementById('ensembleStatsList');
  if (statsList && ens.stats) {
    statsList.innerHTML = Object.entries(ens.stats).map(([name, s]) => {
      const total = s.wins + s.losses;
      const wr = total > 0 ? (s.wins / total * 100).toFixed(0) : '—';
      const label = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const wrColor = wr !== '—' && parseInt(wr) >= 50 ? 'text-emerald-400' : 'text-red-400';
      return `
        <div class="flex justify-between items-center bg-gray-900/70 rounded-lg p-2 border border-gray-800">
          <span class="text-[10px] text-gray-400">${label}</span>
          <div class="text-right">
            <span class="text-[10px] font-bold ${wrColor}">${wr}%</span>
            <span class="text-[9px] text-gray-500 block">${s.wins}W/${s.losses}L</span>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ==================== RENDER: FEATURE SCORE ====================
function renderFeatureScore(fs) {
  if (!fs) return;
  const buyScore = fs.buy ?? 0;
  const sellScore = fs.sell ?? 0;

  const bEl = document.getElementById('featureBuyScore');
  const sEl = document.getElementById('featureSellScore');
  const bBar = document.getElementById('featureBuyBar');
  const sBar = document.getElementById('featureSellBar');
  if (bEl) bEl.innerText = `${buyScore}/100`;
  if (sEl) sEl.innerText = `${sellScore}/100`;
  if (bBar) bBar.style.width = `${buyScore}%`;
  if (sBar) sBar.style.width = `${sellScore}%`;

  const details = document.getElementById('featureDetails');
  if (details && fs.features) {
    const entries = Object.entries(fs.features);
    details.innerHTML = entries.map(([k, v]) => {
      const pct = Math.round((v || 0) * 100);
      const label = k.replace(/([A-Z])/g, ' $1').replace(/\b\w/g, c => c.toUpperCase()).trim();
      const color = pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-gray-400';
      return `
        <div class="bg-gray-900/70 rounded-lg px-2 py-1 border border-gray-800">
          <span class="text-[8px] text-gray-500 block">${label}</span>
          <span class="text-[10px] font-bold ${color}">${pct}%</span>
        </div>
      `;
    }).join('');
  }
}

// ==================== RENDER: MARKET CONTEXT ====================
function renderMarketContext(mc, ind) {
  if (!mc) return;

  const alignEl = document.getElementById('alignmentScore');
  if (alignEl) {
    const score = mc.alignmentScore ?? 0;
    alignEl.innerText = `${score}/100`;
    if (score >= 70) alignEl.className = 'text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30';
    else if (score >= 40) alignEl.className = 'text-[10px] font-bold bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/30';
    else alignEl.className = 'text-[10px] font-bold bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700';
  }

  const aDetails = document.getElementById('alignmentDetails');
  if (aDetails && mc.alignmentDetails) {
    aDetails.innerHTML = Object.entries(mc.alignmentDetails).map(([tf, d]) => {
      const isUp = d.trend === 'UP';
      const color = isUp ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-red-400 bg-red-500/10 border-red-500/30';
      return `
        <div class="flex justify-between items-center px-2 py-1.5 rounded-lg border ${color}">
          <span class="text-[10px] font-bold">${tf}</span>
          <div class="flex items-center gap-2 text-[10px]">
            <span>${d.trend}</span>
            <span class="opacity-70">w${d.weight}</span>
            <span class="opacity-70">RSI ${d.rsi ?? '—'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  const obEl = document.getElementById('obImbalance');
  if (obEl) {
    const v = mc.orderBookImbalance;
    obEl.innerText = v != null ? `${(v * 100).toFixed(1)}%` : '—';
    obEl.className = `text-xs font-bold ${v > 0.15 ? 'text-emerald-400' : v < -0.15 ? 'text-red-400' : 'text-white'}`;
  }

  const cvdEl = document.getElementById('cvdTrend');
  if (cvdEl) {
    cvdEl.innerText = mc.cvdTrend || '—';
    cvdEl.className = `text-xs font-bold ${mc.cvdTrend === 'buying' ? 'text-emerald-400' : mc.cvdTrend === 'selling' ? 'text-red-400' : 'text-white'}`;
  }

  const bwEl = document.getElementById('bidWall');
  const awEl = document.getElementById('askWall');
  if (bwEl) bwEl.innerText = mc.orderBookBidWall ? fmtUsd(mc.orderBookBidWall) : '—';
  if (awEl) awEl.innerText = mc.orderBookAskWall ? fmtUsd(mc.orderBookAskWall) : '—';

  const sessEl = document.getElementById('currentSession');
  if (sessEl) {
    const s = mc.session || '—';
    sessEl.innerText = s.replace(/_/g, ' ');
    const isGood = s === 'LONDON_NY_OVERLAP' || s === 'LONDON' || s === 'NY';
    sessEl.className = `text-xs font-bold ${isGood ? 'text-emerald-400' : s === 'ASIA' ? 'text-amber-400' : 'text-red-400'}`;
  }

  const riskEl = document.getElementById('sessionRiskMult');
  if (riskEl && mc.sessionParams) riskEl.innerText = `×${mc.sessionParams.riskMult}`;

  const evEl = document.getElementById('eventRisk');
  if (evEl) {
    const er = mc.eventRiskLevel || 'LOW';
    evEl.innerText = er;
    evEl.className = `text-xs font-bold ${er === 'HIGH' ? 'text-red-400' : er === 'MEDIUM' ? 'text-amber-400' : 'text-emerald-400'}`;
  }

  const neEl = document.getElementById('nextEvent');
  if (neEl) neEl.innerText = mc.nextEventName || 'Tidak ada';

  const frEl = document.getElementById('fundingRate');
  if (frEl) {
    const fr = mc.fundingRate;
    frEl.innerText = fr != null ? `${(fr * 100).toFixed(4)}%` : '—';
  }

  const oiEl = document.getElementById('oiChange');
  if (oiEl) {
    const oi = mc.oiChangePct;
    oiEl.innerText = oi != null ? `${(oi * 100).toFixed(2)}%` : '—';
    oiEl.className = `text-xs font-bold ${oi > 0 ? 'text-emerald-400' : oi < 0 ? 'text-red-400' : 'text-white'}`;
  }

  const fgEl = document.getElementById('fearGreed');
  if (fgEl) fgEl.innerText = mc.fearGreed != null ? `${mc.fearGreed} (${mc.fearGreedLabel})` : '—';

  const corrEl = document.getElementById('correlation');
  if (corrEl) corrEl.innerText = mc.correlation != null ? mc.correlation.toFixed(2) : '—';

  const atrEl = document.getElementById('atrVal');
  if (atrEl) atrEl.innerText = mc.atr ? `$${mc.atr.toFixed(2)}` : '—';

  const regEl = document.getElementById('regime');
  if (regEl) regEl.innerText = mc.regime || '—';

  const supEl = document.getElementById('support');
  const resEl = document.getElementById('resistance');
  if (supEl) supEl.innerText = mc.support ? fmtUsd(mc.support) : '—';
  if (resEl) resEl.innerText = mc.resistance ? fmtUsd(mc.resistance) : '—';

  const divEl = document.getElementById('rsiDivergence');
  if (divEl) {
    const div = mc.rsiDivergence || 'none';
    divEl.innerText = div === 'none' ? '—' : div.toUpperCase();
    divEl.className = `text-xs font-bold ${div === 'bullish' ? 'text-emerald-400' : div === 'bearish' ? 'text-red-400' : 'text-white'}`;
  }

  const cpEl = document.getElementById('candlePattern');
  if (cpEl) {
    const cp = mc.candlePattern || 'none';
    cpEl.innerText = cp === 'none' ? '—' : cp.replace(/_/g, ' ').toUpperCase();
  }

  const vrEl = document.getElementById('volumeRatio');
  if (vrEl) vrEl.innerText = mc.volumeRatio ? `${mc.volumeRatio}×` : '—';
}

// ==================== RENDER: DYNAMIC PARAMS ====================
function renderDynamicParams(p) {
  if (!p) return;
  const maEl = document.getElementById('paramMinAlign');
  const mcEl = document.getElementById('paramMinConf');
  const kEl = document.getElementById('paramKelly');
  const tpEl = document.getElementById('paramTpMult');
  const slEl = document.getElementById('paramSlMult');
  if (maEl) maEl.innerText = `${p.minAlignment}/100`;
  if (mcEl) mcEl.innerText = `${Math.round(p.minConfidence * 100)}%`;
  if (kEl) kEl.innerText = p.kellyFraction.toFixed(2);
  if (tpEl) tpEl.innerText = `${p.atrTpMult.toFixed(1)}×`;
  if (slEl) slEl.innerText = `${p.atrSlMult.toFixed(1)}×`;
}

// ==================== RENDER: CALIBRATION ====================
function renderCalibration(c) {
  if (!c) return;
  const render = (band) => {
    const b = c[band];
    if (!b) return '—';
    const total = b.wins + b.losses;
    if (total === 0) return '—';
    const wr = (b.wins / total * 100).toFixed(0);
    return `${wr}% (${b.wins}W/${b.losses}L)`;
  };
  const lEl = document.getElementById('calibLow');
  const mEl = document.getElementById('calibMid');
  const hEl = document.getElementById('calibHigh');
  if (lEl) lEl.innerText = render('low');
  if (mEl) mEl.innerText = render('mid');
  if (hEl) hEl.innerText = render('high');
}

// ==================== RENDER: BEST PATTERNS ====================
function renderBestPatterns(patterns, stats) {
  const list = document.getElementById('bestPatternsList');
  const count = document.getElementById('patternCount');
  if (!list) return;

  if (count && stats) count.innerText = `${stats.totalPatterns || 0} patterns`;

  if (!patterns || patterns.length === 0) {
    list.innerHTML = '<p class="text-xs text-gray-500 text-center py-4">Belum ada data.</p>';
  } else {
    list.innerHTML = patterns.map((p, i) => {
      const wr = Math.round(p.winrate * 100);
      const color = wr >= 60 ? 'text-emerald-400' : wr >= 45 ? 'text-amber-400' : 'text-red-400';
      const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      return `
        <div class="bg-gray-900/70 rounded-lg p-2 border border-gray-800">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] font-bold text-white">${emoji} Pattern #${i + 1}</span>
            <span class="text-xs font-bold ${color}">${wr}%</span>
          </div>
          <p class="text-[9px] text-gray-500 truncate">${p.sig}</p>
          <div class="flex justify-between text-[9px] text-gray-500 mt-0.5">
            <span>${p.wins}W / ${p.losses}L</span>
            <span>total ${p.total}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  if (stats && stats.sessionPerformance) {
    const renderSess = (key) => {
      const s = stats.sessionPerformance[key];
      if (!s) return '—';
      const total = s.wins + s.losses;
      if (total === 0) return '—';
      const wr = (s.wins / total * 100).toFixed(0);
      return `${wr}% (${s.wins}W/${s.losses}L)`;
    };
    const asiaEl = document.getElementById('sessionAsia');
    const londonEl = document.getElementById('sessionLondon');
    const nyEl = document.getElementById('sessionNY');
    if (asiaEl) asiaEl.innerText = renderSess('ASIA');
    if (londonEl) londonEl.innerText = renderSess('LONDON');
    if (nyEl) nyEl.innerText = renderSess('NY');
  }
}

// ==================== RENDER: METRICS ====================
function renderMetrics(m, streak, wr) {
  if (!m) return;
  const sh = document.getElementById('metricSharpe');
  const pf = document.getElementById('metricPF');
  const aw = document.getElementById('metricAvgWin');
  const al = document.getElementById('metricAvgLoss');
  const dd = document.getElementById('metricMaxDD');
  const st = document.getElementById('metricStreak');

  if (sh) sh.innerText = m.sharpe ?? '—';
  if (pf) pf.innerText = m.profitFactor ?? '—';
  if (aw) aw.innerText = m.avgWin != null ? `$${m.avgWin}` : '—';
  if (al) al.innerText = m.avgLoss != null ? `$${m.avgLoss}` : '—';
  if (dd) dd.innerText = m.maxDrawdown != null ? `${m.maxDrawdown}%` : '—';
  if (st && streak) st.innerText = `${streak.wins}W / ${streak.losses}L`;
}

// ==================== RENDER: ACTIVE TRADES ====================
function renderActiveTrades(trades, currentPrice) {
  const card = document.getElementById('activeTradesCard');
  const list = document.getElementById('activeTradesList');
  const countEl = document.getElementById('activeTradesCount');
  if (!card || !list) return;

  const arr = Array.isArray(trades) ? trades : [];
  if (countEl) countEl.innerText = arr.length;

  if (arr.length === 0) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const price = parseFloat(currentPrice) || 0;

  list.innerHTML = arr.map(t => {
    const isBuy = t.type === 'BUY';
    const diff = isBuy ? (price - t.entryPrice) : (t.entryPrice - price);
    const pnl = (t.notional || 0) * (diff / t.entryPrice);
    const color = pnl >= 0 ? 'text-emerald-400' : 'text-red-400';
    return `
      <div class="flex justify-between items-center p-2.5 bg-gray-900/70 rounded-xl border border-gray-800 text-xs">
        <div class="flex items-center space-x-2">
          <span class="w-9 h-6 rounded-md flex items-center justify-center font-bold text-[10px] ${isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}">${t.type}</span>
          <div>
            <span class="font-semibold text-white">${t.lot} lot</span>
            <span class="text-gray-400 block text-[10px]">Entry: ${fmtUsd(t.entryPrice)}</span>
          </div>
        </div>
        <span class="font-bold ${color}">${pnl >= 0 ? '+' : '-'}${fmtUsd(Math.abs(pnl))}</span>
      </div>
    `;
  }).join('');
}

// ==================== RENDER: HISTORY ====================
function renderHistoryTable(history) {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (!Array.isArray(history) || history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-3 text-center text-gray-500 italic">Belum ada riwayat.</td></tr>`;
    return;
  }

  tbody.innerHTML = history.map(item => {
    const typeStr = item.type || '';
    const isBuy = typeStr.includes('BUY');
    const isSell = typeStr.includes('SELL');
    const isClose = typeStr.includes('CLOSE') || typeStr.includes('SL') || typeStr.includes('TP') || typeStr.includes('CHANDELIER');
    const typeColor = isBuy ? 'text-emerald-400' : isSell ? 'text-rose-400' : 'text-amber-400';

    let pnlText = '-';
    let pnlColor = 'text-gray-400';
    if (isClose && Number.isFinite(item.pnl)) {
      const pnl = Number(item.pnl);
      pnlText = `${pnl >= 0 ? '+' : '-'}${fmtUsd(Math.abs(pnl))}`;
      pnlColor = pnl >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold';
    }

    return `
      <tr class="border-b border-gray-800/30 hover:bg-gray-800/20">
        <td class="py-2 px-2 text-gray-400">${item.time || '-'}</td>
        <td class="py-2 px-2 font-semibold ${typeColor}">${typeStr}</td>
        <td class="py-2 px-2">${fmtUsd(parseFloat(item.open))}${item.close && item.close !== '-' ? ' ➔ ' + fmtUsd(parseFloat(item.close)) : ''}</td>
        <td class="py-2 px-2 ${pnlColor}">${pnlText}</td>
        <td class="py-2 px-2 font-bold text-white">${fmtUsd(item.balanceAfter)}</td>
      </tr>
    `;
  }).join('');
}

// ==================== RENDER: MARKET MEMORY ====================
function renderMarketMemory(memories) {
  const container = document.getElementById('marketMemoryList');
  const countEl = document.getElementById('memoryCount');
  if (!container) return;

  const arr = Array.isArray(memories) ? memories : [];
  if (countEl) countEl.innerText = `${arr.length}/10`;

  if (arr.length === 0) {
    container.innerHTML = '<p class="text-xs text-gray-500 text-center py-4">Belum ada memori.</p>';
    return;
  }

  const reversed = [...arr].reverse();
  container.innerHTML = reversed.map(m => {
    const act = (m.decision || '').toUpperCase();
    let color = 'text-gray-400 bg-gray-500/10';
    if (act.includes('BUY')) color = 'text-emerald-400 bg-emerald-500/10';
    else if (act.includes('SELL')) color = 'text-red-400 bg-red-500/10';
    else if (act.includes('CLOSE')) color = 'text-blue-400 bg-blue-500/10';

    const pnlStr = m.pnl || '$0.00';
    const pnlCls = pnlStr.includes('-') ? 'text-red-400' : 'text-emerald-400';

    return `
      <div class="p-2 bg-gray-900/60 rounded-lg border border-gray-800">
        <div class="flex justify-between items-center mb-1">
          <span class="text-[9px] px-1.5 py-0.5 rounded font-bold ${color}">${m.decision}</span>
          <span class="text-[9px] text-gray-500">${m.time}</span>
        </div>
        <p class="text-[10px] text-gray-400 leading-snug line-clamp-2">${m.reasoning || ''}</p>
        <div class="flex justify-between text-[9px] text-gray-500 mt-1">
          <span>RSI ${m.rsi} • ${fmtUsd(parseFloat(m.price))}</span>
          <span class="${pnlCls}">${pnlStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ==================== BACKTEST & RESET ====================
async function runBacktest(interval, limit) {
  const resultEl = document.getElementById('backtestResult');
  if (resultEl) resultEl.innerHTML = '<span class="text-amber-400">⏳ Menjalankan backtest...</span>';

  const key = localStorage.getItem('controlKey') || '';
  const url = `/api/backtest?interval=${interval}&limit=${limit}${key ? '&key=' + encodeURIComponent(key) : ''}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success || !json.result) {
      if (resultEl) resultEl.innerHTML = '<span class="text-red-400">❌ Backtest gagal</span>';
      return;
    }
    const r = json.result;
    const wrColor = r.winrate >= 50 ? 'text-emerald-400' : r.winrate >= 40 ? 'text-amber-400' : 'text-red-400';
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="grid grid-cols-2 gap-2 text-left">
          <div class="bg-gray-900/70 rounded p-2 border border-gray-800">
            <div class="text-[8px] text-gray-500">Winrate</div>
            <div class="text-sm font-bold ${wrColor}">${r.winrate}%</div>
          </div>
          <div class="bg-gray-900/70 rounded p-2 border border-gray-800">
            <div class="text-[8px] text-gray-500">Total PnL</div>
            <div class="text-sm font-bold ${r.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">$${r.totalPnl}</div>
          </div>
          <div class="bg-gray-900/70 rounded p-2 border border-gray-800">
            <div class="text-[8px] text-gray-500">Trades</div>
            <div class="text-sm font-bold text-white">${r.trades}</div>
          </div>
          <div class="bg-gray-900/70 rounded p-2 border border-gray-800">
            <div class="text-[8px] text-gray-500">Profit Factor</div>
            <div class="text-sm font-bold text-white">${r.profitFactor ?? '—'}</div>
          </div>
        </div>
        <div class="text-[9px] text-gray-500 mt-2">${r.wins}W / ${r.losses}L • ${interval} × ${limit} candles</div>
      `;
    }
  } catch (e) {
    if (resultEl) resultEl.innerHTML = '<span class="text-red-400">❌ Error: ' + e.message + '</span>';
  }
}

async function resetBot() {
  if (!confirm('Reset bot ke $10,000? Semua history akan dihapus.')) return;
  const key = localStorage.getItem('controlKey') || '';
  const url = `/api/reset${key ? '?key=' + encodeURIComponent(key) : ''}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.success) { showToast('Bot direset', 'success'); setTimeout(syncWithServer, 500); }
    else showToast(json.message || 'Gagal');
  } catch (e) { showToast('Error: ' + e.message); }
}

// ==================== UPTIME TICKER ====================
setInterval(() => {
  if (isRunning && startTime) {
    const sec = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const el = document.getElementById('botUptime');
    if (el) el.innerText = `${h}j ${m}m`;
  }
}, 1000);

// ==================== POLLING ====================
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(syncWithServer, 8000);   // 8 detik (dari 5)
  syncWithServer();
}

// ==================== BOOT ====================
initTabs();
startPolling();
