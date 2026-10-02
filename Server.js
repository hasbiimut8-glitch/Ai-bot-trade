import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const ai = new GoogleGenAI({ apiKey: 'AQ.Ab8RN6KkAKaKq9epVyDmaL7DPWlj98JlC9kAulmw2TQFimoULA' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// State / Status Bot Forex di Server Cloud
let isBotRunning = false;
let botInterval = null;
let virtualBalance = 10000;
let tradeHistory = [];
let activeTrades = [];
let serverLogs = {};
let cycleCount = 0;

// Fungsi inti untuk ambil data Forex & AI Gemini yang dioptimalkan
async function runForexBotCycle() {
    cycleCount++;
    try {
        // Mengambil kurs EUR/USD terbaru
        const forexRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
        const forexData = await forexRes.json();
        let eurUsdPrice = forexData.rates.USD;
        
        // Menambahkan sedikit variasi volatilitas sintetis yang sehat agar chart dan PnL bergerak aktif
        const marketNoise = (Math.sin(cycleCount * 1.5) * 0.0012) + ((Math.random() - 0.48) * 0.0008);
        eurUsdPrice += marketNoise;
        
        const forexChange = (marketNoise * 100).toFixed(2);

        // PROMPT AI FOREX
        const prompt = `
Analisis pasar Forex (EUR/USD) saat ini:
- Harga Kurs: $${eurUsdPrice.toFixed(4)}
- Tren Pendek: ${parseFloat(forexChange) >= 0 ? 'Bullish' : 'Bearish'}

Aturan:
1. Tentukan "BUY", "SELL", atau "HOLD" secara tegas berdasarkan tren.
2. Format jawaban: Kata pertama "BUY", "SELL", atau "HOLD", diikuti titik, lalu alasan 1 kalimat singkat.
`;
        
        let aiAnalysisText = "Analisis pasar Forex diproses...";
        let actionDecision = "HOLD";

        try {
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            if (aiResponse.text) {
                aiAnalysisText = aiResponse.text;
                const textUpper = aiResponse.text.toUpperCase();
                
                if (textUpper.includes("BUY") && !textUpper.includes("NO BUY")) {
                    actionDecision = "BUY";
                } else if (textUpper.includes("SELL") && !textUpper.includes("NO SELL")) {
                    actionDecision = "SELL";
                } else {
                    actionDecision = "HOLD";
                }
            }
        } catch (e) {
            console.warn("AI fallback:", e.message);
            actionDecision = parseFloat(forexChange) >= 0 ? "BUY" : "SELL";
        }

        // Kelola Active Trades & Timer Auto-Close (Durasi 3 menit / 180 detik agar lebih dinamis)
        for (let i = activeTrades.length - 1; i >= 0; i--) {
            let trade = activeTrades[i];
            trade.timeLeft -= 30; 

            if (trade.timeLeft <= 0) {
                // Perhitungan PnL Forex dengan scaling leverage virtual yang lebih terasa (misal 200x untuk magnifikasi pips)
                let priceDiff = (trade.type === "BUY") ? (eurUsdPrice - trade.entryPrice) : (trade.entryPrice - eurUsdPrice);
                let profitPercentage = (priceDiff / trade.entryPrice) * 100 * 200; 
                let pnlResult = (trade.amount * profitPercentage) / 100;
                
                // Batasi max loss/win agar simulasi tetap realistis
                if (pnlResult > 150) pnlResult = 120 + Math.random() * 30;
                if (pnlResult < -150) pnlResult = -100 - Math.random() * 30;

                virtualBalance += pnlResult;
                if (virtualBalance < 0) virtualBalance = 0;

                const closeRecord = {
                    time: new Date().toLocaleTimeString(),
                    type: `CLOSE (${trade.type})`,
                    open: trade.entryPrice.toFixed(4),
                    close: eurUsdPrice.toFixed(4),
                    pnl: pnlResult,
                    balanceAfter: virtualBalance
                };
                tradeHistory.unshift(closeRecord);
                if (tradeHistory.length > 25) tradeHistory.pop();

                activeTrades.splice(i, 1);
            }
        }

        // Eksekusi Buka Posisi (Modal $1,000 per posisi, durasi 180 detik)
        const tradeAmount = 1000; 
        const durationSeconds = 180; 

        if ((actionDecision === "BUY" || actionDecision === "SELL") && virtualBalance >= tradeAmount && activeTrades.length < 2) {
            const newTrade = {
                type: actionDecision,
                amount: tradeAmount,
                entryPrice: eurUsdPrice,
                timeLeft: durationSeconds
            };
            activeTrades.push(newTrade);

            const openRecord = {
                time: new Date().toLocaleTimeString(),
                type: `OPEN ${actionDecision}`,
                open: eurUsdPrice.toFixed(4),
                close: eurUsdPrice.toFixed(4),
                pnl: 0,
                balanceAfter: virtualBalance
            };
            tradeHistory.unshift(openRecord);
            if (tradeHistory.length > 25) tradeHistory.pop();
        }

        serverLogs = {
            price: eurUsdPrice.toFixed(4),
            change: parseFloat(forexChange),
            analysis: aiAnalysisText,
            decision: actionDecision,
            balance: virtualBalance,
            tradeHistory: tradeHistory,
            activeTradesCount: activeTrades.length,
            timestamp: new Date().toLocaleTimeString()
        };

        console.log(`[Forex Loop #${cycleCount}] EUR/USD: $${eurUsdPrice.toFixed(4)} | Aksi: ${actionDecision} | Saldo: $${virtualBalance.toFixed(2)}`);
    } catch (error) {
        console.error("Error pada loop server forex:", error.message);
    }
}

app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("🤖 Bot Forex EUR/USD Diaktifkan.");
        await runForexBotCycle();
        if (botInterval) clearInterval(botInterval);
        botInterval = setInterval(runForexBotCycle, 30000);
    }
    res.json({ success: true, message: "Bot Forex aktif!" });
});

app.get('/api/stop-bot', (req, res) => {
    isBotRunning = false;
    if (botInterval) clearInterval(botInterval);
    console.log("⏹ Bot Forex dihentikan.");
    res.json({ success: true, message: "Bot dihentikan." });
});

app.get('/api/bot-status', (req, res) => {
    res.json({
        running: isBotRunning,
        data: serverLogs
    });
});

app.listen(port, () => {
    console.log(`Server Forex berjalan di port ${port}`);
});
