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

// Fungsi inti untuk ambil data Forex & AI Gemini
async function runForexBotCycle() {
    cycleCount++;
    try {
        // Menggunakan API publik gratis untuk kurs mata uang (EUR ke USD)
        const forexRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
        const forexData = await forexRes.json();
        const eurUsdPrice = forexData.rates.USD;
        
        // Simulasi perubahan harian persentase (karena endpoint bebas, kita buat variasi tren berdasarkan digit terakhir atau random stabil)
        // Atau kita pakai logika analisis AI murni berdasarkan harga saat ini
        const randomChange = (Math.sin(cycleCount) * 0.15).toFixed(2); // Variasi kecil realistis ala forex
        const forexChange = parseFloat(randomChange);

        // PROMPT AI KHUSUS FOREX (EUR/USD)
        const prompt = `
Analisis kondisi pasar Forex (EUR/USD) saat ini secara ketat untuk mencari peluang profit:
- Harga Kurs EUR/USD terkini: $${eurUsdPrice.toFixed(4)}
- Perkiraan tren jangka pendek: ${forexChange >= 0 ? 'Bullish / Menguat' : 'Bearish / Melemah'}

Aturan Perdagangan Forex:
1. Pasar Forex sangat dipengaruhi oleh likuiditas dan kestabilan tren. 
2. Jika tren indikasi naik, prioritaskan "BUY". Jika turun, prioritaskan "SELL".
3. Jika pasar terlalu datar/konsolidasi, pilih "HOLD".
4. Jawab HANYA dengan format kata pertama: "BUY", "SELL", atau "HOLD", diikuti titik, lalu alasan singkat maksimal 1 kalimat.
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
                
                if (textUpper.startsWith("BUY") || (textUpper.includes("BUY") && !textUpper.includes("NO BUY"))) {
                    actionDecision = "BUY";
                } else if (textUpper.startsWith("SELL") || (textUpper.includes("SELL") && !textUpper.includes("NO SELL"))) {
                    actionDecision = "SELL";
                } else {
                    actionDecision = "HOLD";
                }
            }
        } catch (e) {
            console.warn("AI fallback forex:", e.message);
            actionDecision = forexChange >= 0 ? "BUY" : "SELL";
        }

        // Kelola Active Trades & Timer Auto-Close (Durasi diperpanjang jadi 5 menit / 300 detik agar tren forex sempat jalan)
        for (let i = activeTrades.length - 1; i >= 0; i--) {
            let trade = activeTrades[i];
            trade.timeLeft -= 30; // Berkurang 30 detik tiap loop

            if (trade.timeLeft <= 0) {
                // Perhitungan selisih harga forex (karena nilainya kecil misal 1.0850, kita kalikan faktor scaling profit forex)
                let priceDiff = (trade.type === "BUY") ? (eurUsdPrice - trade.entryPrice) : (trade.entryPrice - eurUsdPrice);
                let profitPercentage = (priceDiff / trade.entryPrice) * 100 * 50; // Leverage virtual forex lebih tinggi (misal 50x)
                let pnlResult = (trade.amount * profitPercentage) / 100;
                
                let returnedCapital = trade.amount + pnlResult;
                if (returnedCapital < 0) returnedCapital = 0;

                virtualBalance += returnedCapital;

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

        // Eksekusi Buka Posisi Forex (Modal $2,500)
        const tradeAmount = 2500; 
        const durationSeconds = 300; // 5 menit per posisi untuk Forex

        if ((actionDecision === "BUY" || actionDecision === "SELL") && virtualBalance >= tradeAmount && activeTrades.length < 1) {
            virtualBalance -= tradeAmount; 
            
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
            change: forexChange,
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
        console.log("🤖 Bot Forex EUR/USD 24/7 dijalankan.");
        
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
