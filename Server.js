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

// Endpoint untuk menyalakan bot 24/7 di server
app.get('/api/start-bot', (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("🤖 Bot trading otomatis 24/7 dijalankan di Cloud Server Railway (Interval 30s, Trade 3m).");
        
        if (botInterval) clearInterval(botInterval);

        // Loop utama berjalan murni di server setiap 30 detik
        botInterval = setInterval(async () => {
            if (!isBotRunning) return;
            cycleCount++;

            try {
                // 1. Ambil Data Pasar
                const marketRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
                const marketData = await marketRes.json();
                const btcPrice = marketData.bitcoin.usd;
                const btcChange = marketData.bitcoin.usd_24h_change.toFixed(2);

                // 2. Analisis AI dengan fokus prediksi 3 menit ke depan
                const prompt = `Bertindaklah sebagai analis trading kripto profesional. Harga Bitcoin saat ini adalah $${btcPrice} dengan perubahan 24 jam sebesar ${btcChange}%. Analisis apakah dalam 3 menit ke depan harga Bitcoin cenderung akan NAIK (BUY), TURUN (SELL), atau STABIL/TIDAK PASTI (HOLD). Berikan keputusan dalam satu kata utama (BUY, SELL, atau HOLD) diikuti alasan singkat 1-2 kalimat.`;
                
                let aiAnalysisText = "Analisis stabil terpantau.";
                let actionDecision = "HOLD";

                try {
                    const aiResponse = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                    });
                    if (aiResponse.text) {
                        aiAnalysisText = aiResponse.text;
                        const textUpper = aiResponse.text.toUpperCase();
                        if (textUpper.includes("BUY")) actionDecision = "BUY";
                        else if (textUpper.includes("SELL")) actionDecision = "SELL";
                        else actionDecision = "HOLD";
                    }
                } catch (e) {
                    console.warn("AI fallback digunakan di server:", e.message);
                }

                // 3. Kelola Active Trades & Timer Auto-Close di Server (berkurang 30 detik tiap siklus)
                for (let i = activeTrades.length - 1; i >= 0; i--) {
                    let trade = activeTrades[i];
                    trade.timeLeft -= 30; // Berkurang 30 detik setiap loop

                    if (trade.timeLeft <= 0) {
                        let diff = (trade.type === "BUY") ? (btcPrice - trade.entryPrice) : (trade.entryPrice - btcPrice);
                        let profitPercentage = (diff / trade.entryPrice) * 100 * 2; // Leverage 2x
                        let pnlResult = (trade.amount * profitPercentage) / 100;
                        
                        let finalReturn = trade.amount + pnlResult;
                        if (finalReturn < 0) finalReturn = 0;

                        virtualBalance += finalReturn;

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

                // 4. Eksekusi Buka Posisi Berdasarkan Keputusan AI (Durasi auto-close 3 menit = 180 detik)
                const tradeAmount = 100;
                const durationSeconds = 180; // 3 Menit

                if ((actionDecision === "BUY" || actionDecision === "SELL") && virtualBalance >= tradeAmount) {
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

                // Simpan state terbaru ke server log
                serverLogs = {
                    price: btcPrice,
                    change: btcChange,
                    analysis: aiAnalysisText,
                    decision: actionDecision,
                    balance: virtualBalance,
                    tradeHistory: tradeHistory,
                    timestamp: new Date().toLocaleTimeString()
                };

                console.log(`[Server Loop #${cycleCount}] BTC: $${btcPrice} | Keputusan AI: ${actionDecision} | Saldo: $${virtualBalance.toFixed(2)}`);
            } catch (error) {
                console.error("Error pada loop server:", error.message);
            }
        }, 30000); // 30 Detik per siklus
    }
    res.json({ success: true, message: "Bot aktif di server dengan durasi 3 menit!" });
});

// Endpoint mematikan bot
app.get('/api/stop-bot', (req, res) => {
    isBotRunning = false;
    if (botInterval) clearInterval(botInterval);
    console.log("⏹ Bot server dihentikan.");
    res.json({ success: true, message: "Bot dihentikan." });
});

// Endpoint untuk ditarik oleh tampilan web (frontend)
app.get('/api/bot-status', (req, res) => {
    res.json({
        running: isBotRunning,
        data: serverLogs
    });
});

app.listen(port, () => {
    console.log(`Server berjalan di port ${port}`);
});
