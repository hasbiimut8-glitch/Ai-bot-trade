let pollInterval = null;
let isRunning = false;

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

// Tombol Jalankan Bot
document.getElementById('btn-run').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/start-bot');
        const data = await res.json();
        if (data.success) {
            isRunning = true;
            document.getElementById('btn-run').classList.add('hidden');
            document.getElementById('btn-stop').classList.remove('hidden');
            document.getElementById('ai-status-text').innerText = "🤖 Bot aktif di Server Cloud 24/7!";
            
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(syncWithServer, 5000);
            syncWithServer();
        }
    } catch (e) {
        console.error("Gagal menyalakan bot:", e);
    }
});

// Tombol Berhenti
document.getElementById('btn-stop').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/stop-bot');
        const data = await res.json();
        if (data.success) {
            stopWorkflowUI();
        }
    } catch (e) {
        console.error("Gagal mematikan bot:", e);
    }
});

function stopWorkflowUI() {
    isRunning = false;
    clearInterval(pollInterval);
    document.getElementById('btn-run').classList.remove('hidden');
    document.getElementById('btn-stop').classList.add('hidden');
    document.getElementById('ai-status-text').innerText = "Siklus dihentikan.";
}

// Fungsi menarik data terbaru dari server backend sekaligus menyalakan animasi n8n
async function syncWithServer() {
    try {
        const res = await fetch('/api/bot-status');
        const result = await res.json();
        
        if (result.running && result.data) {
            const { price, change, analysis, decision, balance, tradeHistory } = result.data;
            
            // 1. Jalankan animasi kotak n8n (Node 1 ke Node 4) agar visualnya hidup
            triggerWorkflowNodesAnimation();

            // 2. Update UI Harga, Chart, & Status AI
            updateLiveChart(price);
            document.getElementById('crypto-price').innerText = `$${price.toLocaleString()}`;
            const changeEl = document.getElementById('crypto-change');
            changeEl.innerText = `${change >= 0 ? '+' : ''}${change}%`;
            changeEl.className = `text-[11px] font-semibold ${change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
            
            document.getElementById('virtual-pnl').innerText = `$${balance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            document.getElementById('ai-status-text').innerText = `💡 Sinyal: ${decision} | AI: ${analysis.slice(0, 35)}...`;

            // Update badge posisi BUY/SELL/HOLD
            updatePositionUI(decision);

            // Update Tabel Riwayat
            renderHistoryTable(tradeHistory);
        }
    } catch (err) {
        console.warn("Gagal sinkronisasi data server.");
    }
}
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
            <td class="py-2 px-2">$${item.open.toLocaleString()}</td>
            <td class="py-2 px-2 ${pnlColor}">${pnlFormatted}</td>
            <td class="py-2 px-2 font-bold text-white">$${item.balanceAfter.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        `;
        tbody.appendChild(tr);
    });
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

// Tombol Hapus Riwayat
document.getElementById('btn-clear-history').addEventListener('click', () => {
    localStorage.clear();
    location.reload();
});
