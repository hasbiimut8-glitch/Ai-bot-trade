// ==================== STATE ====================
let isRunning = false;
let startTime = null;
let pollInterval = null;
let tradingChart = null;
let lastFetchOk = true;
let lastSeenCloseTs = 0;

// ==================== UTILITIES ====================
function fmtUsd(n, decimals = 2) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '$0.00';
  return '$' + num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
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

  // Restart animasi pop
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

// ==================== CHART.JS INIT ====================
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
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { color: 'rgba(31, 41, 55, 0.4)' },
          ticks: { color: '#9ca3af', font: { size: 9 } }
        },
        y: {
          grid: { color: 'rgba(31, 41, 55, 0.4)' },
          ticks: { color: '#9ca3af', font: { size: 9 } }
        }
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
  const t = `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes().toString().padStart(2, '0')}:${now
    .getSeconds().toString().padStart(2, '0')}`;

  if (tradingChart.data.labels.length > 20) {
    tradingChart.data.labels.shift();
    tradingChart.data.datasets[0].data.shift();
  }
  tradingChart.data.labels.push(t);
  tradingChart.data.datasets[0].data.push(price);
  tradingChart.update();
}

// ==================== BOT TOGGLE ====================
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
    console.error(e);
  }
});

const clearHistoryBtn = document.getElementById('btn-clear-history');
clearHistoryBtn?.addEventListener('click', () => {
  localStorage.clear();
  location.reload();
});

// ==================== UI STATE ====================
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
    if (chartStatus) {
      chartStatus.innerText = 'Live';
      chartStatus.className = 'text-emerald-400';
    }
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
    if (chartStatus) {
      chartStatus.innerText = 'Standby';
      chartStatus.className = 'text-gray-500';
    }
    document.getElementById('botUptime').innerText = '0j 0m';
  }
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(syncWithServer, 5000);
  syncWithServer();
}

// ==================== SYNC WITH SERVER ====================
async function syncWithServer() {
  try {
    const res = await fetch('/api/bot-status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (json.running !== isRunning) {
      setBotUIState(json.running);
    }
    if (!lastFetchOk) {
      lastFetchOk = true;
      showToast('Koneksi pulih', 'success');
    }
    if (json.data) renderData(json.data);
  } catch (err) {
    if (lastFetchOk) {
      lastFetchOk = false;
      showToast('Koneksi ke server gagal');
    }
    console.warn('Sync error:', err);
  }
}

// ==================== RENDER DATA ====================
function renderData(d) {
  // Harga & chart
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

  // Balance
  const balance = Number(d.balance) || 10000;
  const balanceDisplay = document.getElementById('balance-display');
  if (balanceDisplay) balanceDisplay.innerText = fmtUsd(balance, 2);

  // Dynamic Lot
  const lotEl = document.getElementById('dynamic-lot');
  if (lotEl && d.dynamicLot) lotEl.innerText = d.dynamicLot;

  // Profit
  const totalProfit = balance - 10000;
  const profitPct = ((totalProfit / 10000) * 100).toFixed(2);
  const profitText = `${totalProfit >= 0 ? '+' : '-'}${fmtUsd(Math.abs(totalProfit))}`;
  const profitColor = totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400';

  const pnlToday = document.getElementById('todayPnL');
  const pnlVirtual = document.getElementById('virtual-pnl');
  const profitPctEl = document.getElementById('profitPercentage');

  if (pnlToday) {
    pnlToday.innerText = profitText;
    pnlToday.className = `text-base font-bold ${profitColor}`;
  }
  if (pnlVirtual) {
    pnlVirtual.innerText = profitText;
    pnlVirtual.className = `text-base font-bold ${profitColor}`;
  }
  if (profitPctEl) {
    profitPctEl.innerText = `(${profitPct >= 0 ? '+' : ''}${profitPct}%)`;
    profitPctEl.className = `text-[10px] ${profitColor} bg-${totalProfit >= 0 ? 'emerald' : 'red'}-500/10 px-1 py-0.5 rounded font-semibold`;
  }

  // Unrealized PnL
  const unrealized = Number(d.totalCurrentPnl) || 0;
  const floatEl = document.getElementById('floating-pnl');
  if (floatEl) {
    floatEl.innerText = `${unrealized >= 0 ? '+' : '-'}${fmtUsd(Math.abs(unrealized))}`;
    floatEl.className = `text-base font-bold ${unrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`;
  }

  // Cycle count
  const cycleEl = document.getElementById('cycleCountText');
  if (cycleEl) cycleEl.innerText = `Siklus: ${d.cycleCount ?? 0}`;

  // Active pos indicator
  const posIndicator = document.getElementById('activePosIndicator');
  const activeCount = Number(d.activeTradesCount) || 0;
  if (posIndicator) {
    posIndicator.innerText = `Posisi: ${activeCount}`;
    posIndicator.className = `badge-pill ${
      activeCount > 0
        ? unrealized >= 0
          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
          : 'text-red-400 bg-red-500/10 border-red-500/20'
        : ''
    }`;
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
      if (s.includes('GOLDEN')) {
        macdEl.innerText = 'GOLDEN ⬆';
        macdEl.className = 'text-[10px] font-bold text-emerald-400 truncate block';
      } else if (s.includes('DEATH')) {
        macdEl.innerText = 'DEATH ⬇';
        macdEl.className = 'text-[10px] font-bold text-red-400 truncate block';
      } else if (s.includes('Belum')) {
        macdEl.innerText = 'WARMUP';
        macdEl.className = 'text-[10px] font-bold text-gray-400 truncate block';
      } else {
        macdEl.innerText = 'NEUTRAL';
        macdEl.className = 'text-[10px] font-bold text-indigo-400 truncate block';
      }
    }

    // Trend
    const trendBadge = document.getElementById('trendBadge');
    if (trendBadge && d.indicators.trend) {
      const isUp = d.indicators.trend.includes('UP');
      trendBadge.innerText = isUp ? '📈 UPTREND' : '📉 DOWNTREND';
      trendBadge.className = `badge-pill ${
        isUp
          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
          : 'text-red-400 bg-red-500/10 border-red-500/30'
      }`;
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

  // AI analysis text
  const aiText = document.getElementById('ai-status-text');
  if (aiText && d.analysis) aiText.innerText = d.analysis;

  // Active trades
  renderActiveTrades(d.activeTrades, d.price);

  // History
  renderHistoryTable(d.tradeHistory);

  // Market memory
  renderMarketMemory(d.marketMemory);

  // Last update
  const lu = document.getElementById('lastUpdate');
  if (lu && d.timestamp) lu.innerText = d.timestamp;

  // 🔥 Emotion reaction
  checkCloseEvent(d);
}

// ==================== RENDER: ACTIVE TRADES ====================
function renderActiveTrades(trades, currentPrice) {
  const card = document.getElementById('activeTradesCard');
  const list = document.getElementById('activeTradesList');
  const countEl = document.getElementById('activeTradesCount');
  if (!card || !list) return;

  const arr = Array.isArray(trades) ? trades : [];
  if (countEl) countEl.innerText = arr.length;

  if (arr.length === 0) {
    card.classList.add('hidden');
    return;
  }

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
          <span class="w-9 h-6 rounded-md flex items-center justify-center font-bold text-[10px] ${
            isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }">${t.type}</span>
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

// ==================== RENDER: HISTORY TABLE ====================
function renderHistoryTable(history) {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (!Array.isArray(history) || history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-3 text-center text-gray-500 italic">Belum ada riwayat transaksi.</td></tr>`;
    return;
  }

  tbody.innerHTML = history.map(item => {
    const typeStr = item.type || '';
    const isBuy = typeStr.includes('BUY');
    const isSell = typeStr.includes('SELL');
    const isClose = typeStr.includes('CLOSE') || typeStr.includes('SL') || typeStr.includes('TP');

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

// ==================== BOOT ====================
syncWithServer();
startPolling();
