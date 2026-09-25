const HISAM_API_KEY = "hisam_sk_32957c76fde29b928a93e4ab97f5156d94aa0a0fbe6b7002";
const HISAM_ENDPOINT = "https://hisam-ai-madura.lovable.app/api/public/v1/chat";

let loopInterval = null;
let isRunning = false;
let virtualBalance = 10000; // Modal awal $10,000
let tradeHistory = [];
let activeTrades = []; // Daftar posisi trading yang sedang berjalan dengan timer

// Load riwayat transaksi dari localStorage saat pertama kali buka
function loadTradeHistory() {
    const saved = localStorage.getItem('hisam_trade_history');
    const savedBalance = localStorage.getItem('hisam_virtual_balance');
    if (saved) {
        try { tradeHistory = JSON.parse(saved); } catch(e) { tradeHistory = []; }
    }
    if (savedBalance) {
        virtualBalance = parseFloat(savedBalance) || 10000;
    }
    renderHistoryTable();
    updateBalanceDisplay();
}
loadTradeHistory();

function updateBalanceDisplay() {
    const pnlEl = document.getElementById('virtual-pnl');
    if (pnlEl) {
        pnlEl.innerText = `$${virtualBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }
}

// Tombol hapus riwayat
document.getElementById('btn-clear-history').addEventListener('click', () => {
    tradeHistory = [];
    virtualBalance = 10000;
    activeTrades = [];
    localStorage.removeItem('hisam_trade_history');
    localStorage.setItem('hisam_virtual_balance', virtualBalance);
    renderHistoryTable();
    updateBalanceDisplay();
    document.getElementById('bot-position').innerText = "MEMANTAU";
    document.getElementById('bot-position').className = "text-xs font-bold text-blue-400";
});

// Inisialisasi Chart.js
const ctx = document.getElementById('tradingChart').getContext('2d');
const tradingChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'BTC/USDT Price',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: 2,
            pointBackgroundColor: '#10b981'
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Tombol Jalankan Bot (Menghubungkan ke Server Cloud Backend)
document.getElementById('btn-run').addEventListener('click', async () => {
    if (isRunning) return;
    
    try {
        const response = await fetch('/api/start-bot');
        const data = await response.json();
        if (data.success) {
            isRunning = true;
            document.getElementById('btn-run').classList.add('hidden');
            document.getElementById('btn-stop').classList.remove('hidden');
            document.getElementById('ai-status-text').innerText = "🤖 Bot aktif berjalan 24/7!";
            
            // Jalankan siklus pertama kali secara langsung
            runWorkflowCycle();
            
            // Set interval agar siklus berulang otomatis setiap 5 detik
            if (loopInterval) clearInterval(loopInterval);
            loopInterval = setInterval(() => {
                if (isRunning) {
                    runWorkflowCycle();
                }
            }, 5000);
        }
    } catch (e) {
        console.error("Gagal menyalakan bot ke server:", e);
        document.getElementById('ai-status-text').innerText = "⚠️ Gagal terhubung ke server.";
    }
});
// Tombol Berhentikan Bot
document.getElementById('btn-stop').addEventListener('click', async () => {
    try {
        const response = await fetch('/api/stop-bot');
        const data = await response.json();
        if (data.success) {
            stopWorkflow();
        }
    } catch (e) {
        console.error("Gagal mematikan bot:", e);
    }
});

function stopWorkflow() {
    isRunning = false;
    clearInterval(loopInterval);
    document.getElementById('btn-run').classList.remove('hidden');
    document.getElementById('btn-stop').classList.add('hidden');
    document.getElementById('ai-status-text').innerText = "Siklus dihentikan.";
    resetAllNodes();
    resetArrows();
}

// Sinkronisasi data real-time dari server backend
async function fetchServerStatus() {
    if (!isRunning) return;
    try {
        const res = await fetch('/api/bot-status');
        const data = await res.json();
        if (data.latestLog) {
            const { price, change, analysis } = data.latestLog;
            updateLiveChart(price);
            updateActiveTrades(price);

            document.getElementById('crypto-price').innerText = `$${price.toLocaleString()}`;
            const changeEl = document.getElementById('crypto-change');
            changeEl.innerText = `${change >= 0 ? '+' : ''}${change}%`;
            changeEl.className = `text-[11px] font-semibold ${change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
            document.getElementById('ai-status-text').innerText = `💡 AI: ${analysis.slice(0, 45)}...`;
        }
    } catch (err) {
        console.warn("Gagal sinkronisasi status dengan server.");
    }
}

async function runWorkflowCycle() {
    if (!isRunning) return;
    resetAllNodes();
    resetArrows();
    cycleCount = (typeof cycleCount === 'undefined' ? 0 : cycleCount) + 1;

    try {
        // --- LANGKAH 1: Ambil Data Market ---
        activateNode(1, 'blue');
        highlightArrow('arrow-1', true);
        
        const marketRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true");
        const marketData = await marketRes.json();
        const btcPrice = marketData.bitcoin.usd;
        const btcChange = marketData.bitcoin.usd_24h_change.toFixed(2);

        updateLiveChart(btcPrice);
        updateActiveTrades(btcPrice);

        document.getElementById('crypto-price').innerText = `$${btcPrice.toLocaleString()}`;
        const changeEl = document.getElementById('crypto-change');
        changeEl.innerText = `${btcChange >= 0 ? '+' : ''}${btcChange}%`;
        changeEl.className = `text-[11px] font-semibold ${btcChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

        await sleep(800);
        deactivateNode(1, 'blue');
        highlightArrow('arrow-1', false);
        if (!isRunning) return;

        // --- LANGKAH 2: AI Analisis ---
        activateNode(2, 'emerald');
        highlightArrow('arrow-2', true);
        document.getElementById('ai-status-text').innerText = "🧠 Hisam AI menganalisis market...";

        let aiAnalysisText = "Analisis stabil terpantau.";
        try {
            const aiRes = await fetch(HISAM_ENDPOINT, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${HISAM_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    message: `Analisis market Bitcoin di harga $${btcPrice}. Berikan keputusan singkat.`,
                    mode: "fast",
                }),
            });
            const aiData = await aiRes.json();
            if (aiData.reply) aiAnalysisText = aiData.reply;
        } catch (e) {
            console.warn("AI Endpoint fallback digunakan.");
        }
        
        await sleep(800);
        deactivateNode(2, 'emerald');
        highlightArrow('arrow-2', false);
        if (!isRunning) return;

        // --- LANGKAH 3: Render UI & Grafik ---
        activateNode(3, 'purple');
        highlightArrow('arrow-3', true);
        document.getElementById('ai-status-text').innerText = "📈 Merender ulang UI & Grafik...";

        await sleep(700);
        deactivateNode(3, 'purple');
        highlightArrow('arrow-3', false);
        if (!isRunning) return;

        // --- LANGKAH 4: Eksekusi Transaksi Otomatis ---
        activateNode(4, 'cyan');
        
        let actionDecision = "HOLD";
        const mod = cycleCount % 4;
        if (mod === 1) actionDecision = "BUY";
        else if (mod === 2) actionDecision = "HOLD";
        else if (mod === 3) actionDecision = "SELL";
        else actionDecision = "HOLD";

        document.getElementById('ai-status-text').innerText = `💡 Sinyal: ${actionDecision} | AI: ${aiAnalysisText.slice(0, 30)}...`;

        const tradeAmount = 100; // Modal per transaksi otomatis ($100)
        const durationSeconds = 15; // Durasi auto-close

        if (actionDecision === "BUY" || actionDecision === "SELL") {
            if (virtualBalance >= tradeAmount) {
                virtualBalance -= tradeAmount;
                updateBalanceDisplay();

                const newTrade = {
                    id: Date.now(),
                    type: actionDecision,
                    amount: tradeAmount,
                    entryPrice: btcPrice,
                    timeLeft: durationSeconds,
                    totalTime: durationSeconds
                };

                activeTrades.push(newTrade);
                saveTradeToHistory(`OPEN ${actionDecision}`, btcPrice, btcPrice, 0);

                if (actionDecision === "BUY") {
                    highlightSignalCard('buy', 'Sinyal Aktif');
                    document.getElementById('bot-position').innerText = "BUY (LONG)";
                    document.getElementById('bot-position').className = "text-xs font-bold text-emerald-400";
                } else {
                    highlightSignalCard('sell', 'Sinyal Aktif');
                    document.getElementById('bot-position').innerText = "SELL (SHORT)";
                    document.getElementById('bot-position').className = "text-xs font-bold text-rose-400";
                }
            } else {
                document.getElementById('ai-status-text').innerText = "⚠️ Saldo tidak cukup untuk buka posisi!";
            }
        } else {
            highlightSignalCard('hold', 'Sinyal Aktif');
            document.getElementById('bot-position').innerText = "HOLD (PANTAU)";
            document.getElementById('bot-position').className = "text-xs font-bold text-amber-400";
        }

        localStorage.setItem('hisam_virtual_balance', virtualBalance);
        await sleep(900);
        deactivateNode(4, 'cyan');

    } catch (error) {
        console.error("Error:", error);
        document.getElementById('ai-status-text').innerText = "⚠️ Gangguan koneksi API.";
    }
}

// Fungsi Mengelola Timer & Auto-Close Posisi Berjalan
function updateActiveTrades(currentBtcPrice) {
    if (activeTrades.length === 0) return;

    for (let i = activeTrades.length - 1; i >= 0; i--) {
        let trade = activeTrades[i];
        trade.timeLeft -= 5;

        if (trade.timeLeft <= 0) {
            let diff = (trade.type === "BUY") ? (currentBtcPrice - trade.entryPrice) : (trade.entryPrice - currentBtcPrice);
            let profitPercentage = (diff / trade.entryPrice) * 100 * 2; // Leverage 2x
            let pnlResult = (trade.amount * profitPercentage) / 100;
            
            let finalReturn = trade.amount + pnlResult;
            if (finalReturn < 0) finalReturn = 0;

            virtualBalance += finalReturn;
            updateBalanceDisplay();

            saveTradeToHistory(`CLOSE (${trade.type})`, trade.entryPrice, currentBtcPrice, pnlResult);
            activeTrades.splice(i, 1);
        }
    }
    localStorage.setItem('hisam_virtual_balance', virtualBalance);
}

function saveTradeToHistory(type, openPr, closePr, pnl) {
    const record = {
        time: new Date().toLocaleTimeString(),
        type: type,
        open: openPr,
        close: closePr,
        pnl: pnl,
        balanceAfter: virtualBalance
    };
    tradeHistory.unshift(record);
    if (tradeHistory.length > 25) tradeHistory.pop();
    localStorage.setItem('hisam_trade_history', JSON.stringify(tradeHistory));
    renderHistoryTable();
}

function renderHistoryTable() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    if (tradeHistory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-3 text-center text-gray-500 italic">Belum ada riwayat transaksi.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    tradeHistory.forEach(item => {
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
            <td class="py-2 px-2">$${item.open.toLocaleString()}</td>
            <td class="py-2 px-2 ${pnlColor}">${pnlFormatted}</td>
            <td class="py-2 px-2 font-bold text-white">$${item.balanceAfter.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        `;
        tbody.appendChild(tr);
    });
}

function activateNode(stepNum, color) {
    const card = document.getElementById(`node-${stepNum}`);
    if (card) card.classList.add(`node-active-${color}`);
}

function deactivateNode(stepNum, color) {
    const card = document.getElementById(`node-${stepNum}`);
    if (card) card.classList.remove(`node-active-${color}`);
}

function highlightArrow(arrowId, isActive) {
    const arrow = document.getElementById(arrowId);
    if (arrow) {
        if (isActive) arrow.classList.add('arrow-active');
        else arrow.classList.remove('arrow-active');
    }
}

function resetArrows() {
    ['arrow-1', 'arrow-2', 'arrow-3'].forEach(id => {
        const ar = document.getElementById(id);
        if (ar) ar.classList.remove('arrow-active');
    });
}

function resetAllNodes() {
    [1, 2, 3, 4].forEach(n => {
        const el = document.getElementById(`node-${n}`);
        if(el) el.className = (n===1||n===2?'col-span-3 ':'') + "node-box p-3 border-l-4 " + (n===1?'border-blue-500':n===2?'border-emerald-500':n===3?'border-purple-500 flex items-center gap-3':'border-cyan-500 flex flex-col justify-between');
    });
    ['buy', 'hold', 'sell'].forEach(type => {
        const card = document.getElementById(`card-${type}`);
        if(card) card.style.background = "#111827";
        const badge = document.getElementById(`badge-${type}`);
        if(badge) {
            badge.innerText = "Standby";
            badge.className = "text-[9px] font-semibold text-gray-500 bg-gray-900 px-2 py-0.5 rounded";
        }
    });
}

function highlightSignalCard(type, text) {
    const card = document.getElementById(`card-${type}`);
    const badge = document.getElementById(`badge-${type}`);
    if(card) card.style.background = type === 'buy' ? 'rgba(16, 185, 129, 0.2)' : type === 'hold' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(244, 63, 94, 0.2)';
    if(badge) {
        badge.innerText = text;
        badge.className = `text-[9px] font-bold px-2 py-0.5 rounded text-white ${type === 'buy' ? 'bg-emerald-600' : type === 'hold' ? 'bg-amber-600' : 'bg-rose-600'}`;
    }
}

function updateLiveChart(newPrice) {
    const now = new Date();
    const timeString = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
    
    if (tradingChart.data.labels.length > 8) {
        tradingChart.data.labels.shift();
        tradingChart.data.datasets[0].data.shift();
    }
    
    tradingChart.data.labels.push(timeString);
    tradingChart.data.datasets[0].data.push(newPrice);
    tradingChart.update();
}
