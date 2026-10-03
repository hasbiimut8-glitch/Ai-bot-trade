import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// API Key & Endpoint Hisam AI
const HISAM_API_KEY = 'hisam_sk_aeb18f6e3120e2e6713535b7662accb743681262635e2c97';
const HISAM_AI_URL = 'https://hisam-ai-madura.lovable.app/api/public/v1/chat';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// State / Status Bot Full-Autonomous
let isBotRunning = false;
let botInterval = null;
let virtualBalance = 10000;
let tradeHistory = [];
let activeTrade = null; // Fokus ke 1 posisi utama yang dikendalikan Hisam AI
let serverLogs = {};
let cycleCount = 0;

async function runAutonomousForexBot() {
    cycleCount++;
    try {
        // Ambil data kurs EUR/USD terbaru
        const forexRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
        const forexData = await forexRes.json();
        let eurUsdPrice = forexData.rates.USD;
        
        // Volatilitas sintetis halus untuk pergerakan harga
        const marketNoise = (Math.sin(cycleCount * 1.5) * 0.0004) + ((Math.random() - 0.48) * 0.0003);
        eurUsdPrice += marketNoise;
        const forexChange = (marketNoise * 100).toFixed(2);

        // Hitung Indikator RSI Sederhana (0 - 100)
        const rsiValue = Math.floor(40 + (Math.sin(cycleCount) * 25) + (Math.random() * 10));
        const rsiStatus = rsiValue > 60 ? "OVERBOUGHT (Siap SELL)" : (rsiValue < 40 ? "OVERSOLD (Siap BUY)" : "NEUTRAL");

        // Hitung PnL posisi aktif saat ini (jika ada)
        let currentPnl = 0;
        let pnlPercentage = 0;
        if (activeTrade) {
            let priceDiff = (activeTrade.type === "BUY") ? (eurUsdPrice - activeTrade.entryPrice) : (activeTrade.entryPrice - eurUsdPrice);
            
            // Leverage virtual 10x agar PnL terkontrol
            pnlPercentage = (priceDiff / activeTrade.entryPrice) * 100 * 10; 
            currentPnl = (activeTrade.amount * pnlPercentage) / 100;

            // HARD PROTECTION: Stop Loss (-$20) & Take Profit (+$30)
            if (currentPnl <= -20 || currentPnl >= 30) {
                const isSL = currentPnl <= -20;
                virtualBalance += currentPnl;
                if (virtualBalance < 0) virtualBalance = 0;

                tradeHistory.unshift({
                    time: new Date().toLocaleTimeString('id-ID'),
                    type: `AUTO-CLOSE (${isSL ? 'STOP LOSS' : 'TAKE PROFIT'})`,
                    open: activeTrade.entryPrice.toFixed(4),
                    close: eurUsdPrice.toFixed(4),
                    pnl: currentPnl,
                    balanceAfter: virtualBalance
                });
                if (tradeHistory.length > 25) tradeHistory.pop();
                activeTrade = null;
                console.log(`[Auto-Protect] Posisi ditutup otomatis via ${isSL ? 'Stop Loss' : 'Take Profit'}. PnL: $${currentPnl.toFixed(2)}`);
            }
        }

        // Ambil 3 riwayat transaksi terakhir sebagai memori evaluasi
        const recentHistory = tradeHistory.slice(0, 3).map(h => `${h.type} di ${h.open}, PnL: $${h.pnl ? h.pnl.toFixed(2) : 0}`).join(' | ') || "Belum ada riwayat.";

        // PROMPT PERSONA DESMOND WIRA UNTUK HISAM AI
        const prompt = `
Kamu adalah "Orion", Full-Time Forex Trader berpengalaman dengan filosofi Desmond Wira ("Smart Traders Not Gamblers").

DATA PASAR REAL-TIME:
- EUR/USD Rate: $${eurUsdPrice.toFixed(4)} (${parseFloat(forexChange) >= 0 ? '+' : ''}${forexChange}%)
- Indikator RSI (14): ${rsiValue} -> Status: ${rsiStatus}
- Posisi Aktif Saat Ini: ${activeTrade ? `${activeTrade.type} di $${activeTrade.entryPrice.toFixed(4)} (PnL berjalan:$${currentPnl.toFixed(2)})` : 'TIDAK ADA POSISI'}
- Evaluasi Terakhir: ${recentHistory}

ATURAN ENTRY & EXIT DISIPLIN:
1. Jika TIDAK ADA POSISI:
   - Jika RSI < 40 (OVERSOLD), sebutkan kata "BUY".
   - Jika RSI > 60 (OVERBOUGHT), sebutkan kata "SELL".
   - Jika RSI NEUTRAL (40-60), sebutkan kata "HOLD" untuk amankan modal.
2. Jika SEDANG ADA POSISI:
   - Jika PnL sudah positif/untung, sebutkan kata "CLOSE" untuk kuncikan profit.
   - Jika PnL minus tapi RSI masih mendukung, sebutkan kata "HOLD".

Sebutkan salah satu kata kunci keputusan utama (BUY, SELL, CLOSE, atau HOLD) dan berikan 1 kalimat analisis teknikal singkat.
`;

        let aiAnalysisText = "Hisam AI memproses analisis...";
        let actionDecision = "HOLD";

        // TEMBAK API HISAM AI
        try {
            const aiRes = await fetch(HISAM_AI_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${HISAM_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    message: prompt,
                    mode: "fast", // mode fast agar respon cepat
                }),
            });

            const data = await aiRes.json();
            console.log("[Hisam AI Response Raw]:", JSON.stringify(data)); // Log respon mentah di Railway

            if (data && data.reply) {
                aiAnalysisText = data.reply;
                const textUpper = data.reply.toUpperCase();
                
                // PARSING FLEKSIBEL: Cari kata kunci keputusan di seluruh isi teks balasan
                if (activeTrade && textUpper.includes("CLOSE")) {
                    actionDecision = "CLOSE";
                } else if (!activeTrade && textUpper.includes("BUY")) {
                    actionDecision = "BUY";
                } else if (!activeTrade && textUpper.includes("SELL")) {
                    actionDecision = "SELL";
                } else if (textUpper.includes("HOLD")) {
                    actionDecision = "HOLD";
                } else {
                    // Fallback jika tidak ditemukan kata kunci spesifik
                    actionDecision = activeTrade ? "HOLD" : (rsiValue < 40 ? "BUY" : (rsiValue > 60 ? "SELL" : "HOLD"));
                }
            } else {
                console.warn("Format respon Hisam AI tidak sesuai:", data);
            }
        } catch (e) {
            console.error("Hisam AI Fetch Error:", e.message);
            actionDecision = activeTrade ? "HOLD" : (parseFloat(forexChange) >= 0 ? "BUY" : "SELL");
        }

        // EKSEKUSI KEPUTUSAN HISAM AI
        const tradeAmount = 500; // Modal per posisi $500

        // 1. Jika Hisam AI memutuskan CLOSE
        if (actionDecision === "CLOSE" && activeTrade) {
            virtualBalance += currentPnl;
            if (virtualBalance < 0) virtualBalance = 0;

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString('id-ID'),
                type: `CLOSE (${activeTrade.type})`,
                open: activeTrade.entryPrice.toFixed(4),
                close: eurUsdPrice.toFixed(4),
                pnl: currentPnl,
                balanceAfter: virtualBalance
            });
            if (tradeHistory.length > 25) tradeHistory.pop();
            activeTrade = null;
        } 
        // 2. Jika Hisam AI memutuskan BUY / SELL saat tidak ada posisi
        else if ((actionDecision === "BUY" || actionDecision === "SELL") && !activeTrade && virtualBalance >= tradeAmount) {
            activeTrade = {
                type: actionDecision,
                amount: tradeAmount,
                entryPrice: eurUsdPrice
            };

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString('id-ID'),
                type: `OPEN ${actionDecision}`,
                open: eurUsdPrice.toFixed(4),
                close: eurUsdPrice.toFixed(4),
                pnl: 0,
                balanceAfter: virtualBalance
            });
            if (tradeHistory.length > 25) tradeHistory.pop();
        }

        serverLogs = {
            price: eurUsdPrice.toFixed(4),
            change: parseFloat(forexChange),
            analysis: aiAnalysisText,
            decision: actionDecision,
            balance: virtualBalance,
            activeTrade: activeTrade,
            currentPnl: currentPnl,
            tradeHistory: tradeHistory,
            timestamp: new Date().toLocaleTimeString('id-ID')
        };

        console.log(`[Hisam AI Orion] Harga: $${eurUsdPrice.toFixed(4)} | Keputusan: ${actionDecision} | PnL: $${currentPnl.toFixed(2)}`);
    } catch (error) {
        console.error("Error autonomous loop:", error.message);
    }
}

app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("🤖 Bot Orion berbasis Hisam AI Diaktifkan.");
        await runAutonomousForexBot();
        if (botInterval) clearInterval(botInterval);
        botInterval = setInterval(runAutonomousForexBot, 25000); // Eksekusi tiap 25 detik
    }
    res.json({ success: true, message: "Bot Hisam AI aktif!" });
});

app.get('/api/stop-bot', (req, res) => {
    isBotRunning = false;
    if (botInterval) clearInterval(botInterval);
    console.log("⏹ Bot dihentikan.");
    res.json({ success: true, message: "Bot dihentikan." });
});

app.get('/api/bot-status', (req, res) => {
    res.json({
        running: isBotRunning,
        data: serverLogs
    });
});

app.listen(port, () => {
    console.log(`Server Forex Hisam AI berjalan di port ${port}`);
});
