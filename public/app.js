let pollInterval = null;
let isRunning = false;

// --- 1. INISIALISASI CHART.JS (FOREX EUR/USD) ---
const ctx = document.getElementById('tradingChart')?.getContext('2d');
let tradingChart = null;

if (ctx) {
    tradingChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'EUR/USD Rate',
                data: [],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.35,
                pointRadius: 2,
                pointBackgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(31, 41, 55, 0.4)' }, ticks: { color: '#9ca3af', font: { size: 9 } } },
                y: { grid: { color: 'rgba(31, 41, 55, 0.4)' }, ticks: { color: '#9ca3af', font: { size: 9 } } }
            },
            animation: { duration: 300 }
        }
    });
}

// --- 2. EVENT LISTENERS TOMBOL BOT ---
document.getElementById('btn-run')?.addEventListener('click', async () => {
    try {
        const res = await fetch('/api/start-bot');
        const data = await res.json();
        if (data.success) {
            setBotUIState(true);
            startPolling();
        }
    } catch (e) {
        console.error("Gagal menyalakan bot:", e);
    }
});

document.getElementById('btn-stop')?.addEventListener('click', async () => {
    try {
        const res = await fetch('/api/stop-bot');
        const data = await res.json();
        if (data.success) {
            setBotUIState(false);
        }
    } catch (e) {
        console.error("Gagal mematikan bot:", e);
    }
});

const clearHistoryBtn = document.getElementById('btn-clear-history');
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        localStorage.clear();
        location.reload();
    });
}

// --- 3. KONTROL STATE UI ---
function setBotUIState(running) {
    isRunning = running;
    const btnRun = document.getElementById('btn-run');
    const btnStop = document.getElementById('btn-stop');
    const statusText = document.getElementById('ai-status-text');

    if (running) {
        btnRun?.classList.add('hidden');
        btnStop?.classList.remove('hidden');
        if (statusText) statusText.innerText = "🤖 Bot Orion AI aktif di Server Cloud 24/7!";
    } else {
        btnRun?.classList.remove('hidden');
        btnStop?.classList.add('hidden');
        if (statusText) statusText.innerText = "Siklus dihentikan.";
        if (pollInterval) clearInterval(pollInterval);
    }
}

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(syncWithServer, 3000); // Poll setiap 3 detik
    syncWithServer();
}

// --- 4. SINKRONISASI DATA SERVER DENGAN UI ---
async function syncWithServer() {
    try {
        const res = await fetch('/api/bot-status');
        const result = await res.json();
        
        // Auto-restore state tombol jika server sedang running (misal setelah refresh)
        if (result.running !== isRunning) {
            setBotUIState(result.running);
            if (result.running) startPolling();
        }

        if (result.data) {
            const { 
                price, 
                change, 
                analysis, 
                decision, 
                balance, 
                dynamicLot, 
                activeTrade, 
                currentPnl, 
                tradeHistory, 
                indicators 
            } = result.data;
            
            // 1. Update Harga & Live Chart
            if (price) {
                updateLiveChart(parseFloat(price));
                const priceEl = document.getElementById('crypto-price');
                if (priceEl) priceEl.innerText = `$${price}`;
            }

            // 2. Update Persentase Perubahan Harga
            if (change !== undefined) {
                const changeEl = document.getElementById('crypto-change');
                if (changeEl) {
                    const isPositive = parseFloat(change) >= 0;
                    changeEl.innerText = `${isPositive ? '+' : ''}${change}%`;
                    changeEl.className = `text-[11px] font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`;
                }
            }
            
            // 3. Update Saldo Akun (Balance)
            if (balance !== undefined) {
                const balanceEl = document.getElementById('virtual-pnl');
                if (balanceEl) {
                    balanceEl.innerText = `$${balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                }
            }

            // 4. Update Dynamic Lot (jika elemennya ada)
            const lotEl = document.getElementById('dynamic-lot');
            if (lotEl && dynamicLot) {
                lotEl.innerText = `${dynamicLot} Lot`;
            }

            // 5. Update Floating PnL & Posisi Aktif (jika elemennya ada)
            const floatingPnlEl = document.getElementById('floating-pnl');
            if (floatingPnlEl && currentPnl !== undefined) {
                const isProfit = currentPnl >= 0;
                floatingPnlEl.innerText = `${isProfit ? '+' : ''}$${currentPnl.toFixed(2)}`;
                floatingPnlEl.className = `font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`;
            }

            const activeTradeEl = document.getElementById('active-trade-info');
            if (activeTradeEl) {
                if (activeTrade) {
                    activeTradeEl.innerText = `${activeTrade.type} @ ${activeTrade.entryPrice} | SL: ${activeTrade.sl} | TP: ${activeTrade.tp}`;
                } else {
                    activeTradeEl.innerText = "Tidak ada posisi aktif";
                }
            }

            // 6. Update Indikator Teknikal (RSI, EMA, MACD)
            if (indicators) {
                const rsiEl = document.getElementById('ind-rsi');
                const emaEl = document.getElementById('ind-ema');
                const macdEl = document.getElementById('ind-macd');

                if (rsiEl) rsiEl.innerText = indicators.rsi;
                if (emaEl) emaEl.innerText = indicators.ema20;
                if (macdEl) macdEl.innerText = indicators.macdStatus;
            }

            // 7. Update Terminal Analisa AI
            if (analysis && decision) {
                const aiStatusEl = document.getElementById('ai-status-text');
                if (aiStatusEl) {
                    aiStatusEl.innerText = `💡 Sinyal: ${decision} | AI: ${analysis}`;
                }
            }

            // 8. Render Tabel Riwayat Transaksi
            renderHistoryTable(tradeHistory);
        }
    } catch (err) {
        console.warn("Gagal sinkronisasi data server:", err);
    }
}

// --- 5. RENDER TABEL RIWAYAT TRANSAKSI ---
function renderHistoryTable(history) {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    if (!history || history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-3 text-center text-gray-500 italic">Belum ada riwayat transaksi.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    history.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-800/30 hover:bg-gray-800/20";

        let pnlFormatted = "-";
        let pnlColor = "text-gray-400";

        if (item.type.includes("CLOSE")) {
            const isProfit = item.pnl >= 0;
            pnlFormatted = `${isProfit ? '+' : ''}$${item.pnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            pnlColor = isProfit ? "text-emerald-400 font-bold" : "text-rose-400 font-bold";
        }

        tr.innerHTML = `
            <td class="py-2 px-2 text-gray-400">${item.time}</td>
            <td class="py-2 px-2 font-semibold ${item.type.includes('BUY') ? 'text-emerald-400' : item.type.includes('SELL') ? 'text-rose-400' : 'text-amber-400'}">${item.type}</td>
            <td class="py-2 px-2">$${item.open}${item.close ? ' ➔ $' + item.close : ''}</td>
            <td class="py-2 px-2 ${pnlColor}">${pnlFormatted}</td>
            <td class="py-2 px-2 font-bold text-white">$${item.balanceAfter.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        `;
        tbody.appendChild(tr);
    });
}

// --- 6. UPDATE LIVE CHART ---
function updateLiveChart(newPrice) {
    if (!tradingChart) return;

    const now = new Date();
    const timeString = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0') + ':' + 
                       now.getSeconds().toString().padStart(2, '0');
    
    // Batasi grafik maksimal 12 data poin agar ringan
    if (tradingChart.data.labels.length > 12) {
        tradingChart.data.labels.shift();
        tradingChart.data.datasets[0].data.shift();
    }
    
    tradingChart.data.labels.push(timeString);
    tradingChart.data.datasets[0].data.push(newPrice);
    tradingChart.update();
}

// --- 7. PERTAMA KALI HALAMAN DIMUAT ---
syncWithServer();
