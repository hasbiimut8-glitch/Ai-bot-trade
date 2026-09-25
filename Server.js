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
let consecutiveHolds = 0;

// Fungsi inti untuk ambil data pasar & AI dengan Prompt Super Detail
async function runBotCycle() {
    cycleCount++;
    try {
        const marketRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
        const marketData = await marketRes.json();
        const btcPrice = marketData.bitcoin.usd;
        const btcChange = parseFloat(marketData.bitcoin.usd_24h_change.toFixed(2));

        // PROMPT SUPER DETAIL & OBJEKTIF
        const prompt = `
Analisis kondisi pasar Bitcoin saat ini secara ketat:
- Harga BTC terkini: $${btcPrice}
- Perubahan tren 24 Jam: ${btcChange}%

Aturan Mutlak Analisis:
1. Jika perubahan 24 jam bernilai POSITIF (> 0%), prioritaskan "BUY" atau "HOLD". DILARANG keras memilih "SELL" kecuali ada indikasi pembalikan arah yang sangat ekstrem.
2. Jika perubahan 24 jam bernilai NEGATIF (< 0%), prioritaskan "SELL" atau "HOLD". DILARANG keras memilih "BUY" kecuali ada indikasi pantulan (*rebound*) yang kuat.
3. Jika pasar bergerak datar atau ragu-ragu, WAJIB jawab "HOLD" agar tidak salah buka posisi.
4. Jawab HANYA dengan format kata pertama: "BUY", "SELL", atau "HOLD", diikuti titik, lalu berikan alasan singkat maksimal 1 kalimat.
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
                
                // Ekstraksi keputusan yang lebih ketat
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
            // Fallback berdasarkan data real-time, bukan paksaan
            actionDecision = btcChange >= 0 ? "BUY" : "SELL";
        }

        // Filter tambahan: Jika data CoinGecko hijau (positif) tapi AI bandel kasih SELL, override jadi HOLD atau BUY
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

        // 4. Eksekusi Buka Posisi (Maksimal 1 Posisi, Modal $1,000)
        const tradeAmount = 1000; 
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
        console.log("🤖 Bot trading 24/7 dijalankan dengan Prompt Super Detail.");
        
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
             
