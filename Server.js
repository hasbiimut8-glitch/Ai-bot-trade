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

// State / Status Bot di Server Cloud
let isBotRunning = false;
let botInterval = null;
let virtualBalance = 10000;
let tradeHistory = [];
let activeTrades = [];
let serverLogs = {};
let cycleCount = 0;

// Fungsi inti untuk ambil data pasar & AI dengan Strategi Lebih Agresif
async function runBotCycle() {
    cycleCount++;
    try {
        const marketRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
        const marketData = await marketRes.json();
        const btcPrice = marketData.bitcoin.usd;
        const btcChange = parseFloat(marketData.bitcoin.usd_24h_change.toFixed(2));

        // PROMPT AI LEBIH AGRESIF & SELEKTIF
        const prompt = `
Analisis kondisi pasar Bitcoin saat ini secara ketat untuk mencari peluang profit maksimal:
- Harga BTC terkini: $${btcPrice}
- Perubahan tren 24 Jam: ${btcChange}%

Aturan Perdagangan Agresif:
1. Jika perubahan 24 jam POSITIF (> 0%) dan grafik sedang naik, fokus cari momen "BUY".
2. Jika perubahan 24 jam NEGATIF (< 0%) dan grafik sedang turun, fokus cari momen "SELL".
3. Jangan ragu memilih "BUY" atau "SELL" jika tren terlihat jelas. Hanya jawab "HOLD" jika pasar benar-benar stagnan atau sangat berisiko.
4. Jawab HANYA dengan format kata pertama: "BUY", "SELL", atau "HOLD", diikuti titik, lalu alasan singkat maksimal 1 kalimat.
`;
        
        let aiAnalysisText = "Analisis pasar diproses...";
        let actionDecision = "HOLD";

        try {
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            if (aiResponse.text) {
                aiAnalysisText = aiResponse.text;
                const textUpper = aiResponse.text.toUpperCase();
                
                if (textUpper.startsWith("BUY") || (textUpper.includes("BUY") && !textUpper.includes("NO BUY"))) {
                    actionDecision = "BUY";
                } else if (textUpper.startsWith("SELL") || (textUpper.includes("SELL") && !textUpper.includes("NO SELL"))) {
                    actionDecision = "SELL";
                } else {
                    actionDecision = "HOLD";
                }
            }
        } catch (e) {
            console.warn("AI fallback server:", e.message);
            actionDecision = btcChange >= 0 ? "BUY" : "SELL";
        }

        // Lapisan Pengaman (Override Sistem) agar tidak salah arah ekstrem
        if (btcChange > 0 && actionDecision === "SELL") {
            actionDecision = "HOLD";
            aiAnalysisText += " [Override Sistem: Pasar Hijau, SELL ditolak]";
        } else if (btcChange < 0 && actionDecision === "BUY") {
            actionDecision = "HOLD";
            aiAnalysisText += " [Override Sistem: Pasar Merah, BUY ditolak]";
        }

        // 3. Kelola Active Trades & Timer Auto-Close (Durasi 3 menit / 180 detik)
        for (let i = activeTrades.length - 1; i >= 0; i--) {
            let trade = activeTrades[i];
            trade.timeLeft -= 30; // Berkurang 30 detik tiap loop

            if (trade.timeLeft <= 0) {
                let diff = (trade.type === "BUY") ? (btcPrice - trade.entryPrice) : (trade.entryPrice - btcPrice);
                let profitPercentage = (diff / trade.entryPrice) * 100 * 2; // Leverage 2x
                let pnlResult = (trade.amount * profitPercentage) / 100;
                
                let returnedCapital = trade.amount + pnlResult;
                if (returnedCapital < 0) returnedCapital = 0;

                virtualBalance += returnedCapital;

                const closeRecord = {
                    time: new Date().toLocaleTimeString(),
                    type: `CLOSE (${trade.type})`,
                    open: trade.entryPrice,
                    close: btcPrice,
                    pnl: pnlResult,
                    balanceAfter: virtualBalance
                };
                tradeHistory.unshift(closeRecord);
                if (tradeHistory.length > 25) tradeHistory.pop();

                activeTrades.splice(i, 1);
            }
        }

        // 4. Eksekusi Buka Posisi (Modal Dinaikkan ke $2,500 agar profit lebih terasa)
        const tradeAmount = 2500; 
        const durationSeconds = 180; 

        if ((actionDecision === "BUY" || actionDecision === "SELL") && virtualBalance >= tradeAmount && activeTrades.length < 1) {
            virtualBalance -= tradeAmount; 
            
            const newTrade = {
                type: actionDecision,
                amount: tradeAmount,
                entryPrice: btcPrice,
                timeLeft: durationSeconds
            };
            activeTrades.push(newTrade);

            const openRecord = {
                time: new Date().toLocaleTimeString(),
                type: `OPEN ${actionDecision}`,
                open: btcPrice,
                close: btcPrice,
                pnl: 0,
                balanceAfter: virtualBalance
            };
            tradeHistory.unshift(openRecord);
            if (tradeHistory.length > 25) tradeHistory.pop();
        }

        serverLogs = {
            price: btcPrice,
            change: btcChange,
            analysis: aiAnalysisText,
            decision: actionDecision,
            balance: virtualBalance,
            tradeHistory: tradeHistory,
            activeTradesCount: activeTrades.length,
            timestamp: new Date().toLocaleTimeString()
        };

        console.log(`[Loop #${cycleCount}] BTC: $${btcPrice} (${btcChange}%) | Aksi: ${actionDecision} | Saldo: $${virtualBalance.toFixed(2)}`);
    } catch (error) {
        console.error("Error pada loop server:", error.message);
    }
}

app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("🤖 Bot trading 24/7 dijalankan dengan Strategi Agresif ($2,500).");
        
        await runBotCycle();

        if (botInterval) clearInterval(botInterval);
        botInterval = setInterval(runBotCycle, 30000);
    }
    res.json({ success: true, message: "Bot aktif dengan strategi baru!" });
});

app.get('/api/stop-bot', (req, res) => {
    isBotRunning = false;
    if (botInterval) clearInterval(botInterval);
    console.log("⏹ Bot server dihentikan.");
    res.json({ success: true, message: "Bot dihentikan." });
});

app.get('/api/bot-status', (req, res) => {
    res.json({
        running: isBotRunning,
        data: serverLogs
    });
});

app.listen(port, () => {
    console.log(`Server berjalan di port ${port}`);
});
