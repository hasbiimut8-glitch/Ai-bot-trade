import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Gunakan environment variable agar API Key aman & tidak bocor di GitHub
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'AQ.Ab8RN6KkAKaKq9epVyDmaL7DPWlj98JlC9kAulmw2TQFimoULA' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// State / Status Bot Full-Autonomous
let isBotRunning = false;
let botInterval = null;
let virtualBalance = 10000;
let tradeHistory = [];
let activeTrade = null; // Fokus ke 1 posisi utama yang dikendalikan penuh oleh Gemini
let serverLogs = {};
let cycleCount = 0;

async function runAutonomousForexBot() {
    cycleCount++;
    try {
        // Ambil data kurs EUR/USD terbaru
        const forexRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
        const forexData = await forexRes.json();
        let eurUsdPrice = forexData.rates.USD;
        
        // Tambahkan volatilitas sintetis yang lebih halus
        const marketNoise = (Math.sin(cycleCount * 1.5) * 0.0004) + ((Math.random() - 0.48) * 0.0003);
        eurUsdPrice += marketNoise;
        const forexChange = (marketNoise * 100).toFixed(2);

        // Hitung PnL posisi aktif saat ini (jika ada)
        let currentPnl = 0;
        let pnlPercentage = 0;
        if (activeTrade) {
            let priceDiff = (activeTrade.type === "BUY") ? (eurUsdPrice - activeTrade.entryPrice) : (activeTrade.entryPrice - eurUsdPrice);
            
            // PERBAIKAN: Leverage disesuaikan ke 10x agar PnL tidak membengkak ribuan dolar
            pnlPercentage = (priceDiff / activeTrade.entryPrice) * 100 * 10; 
            currentPnl = (activeTrade.amount * pnlPercentage) / 100;

            // HARD PROTECTION: Auto Stop Loss (-$50) & Take Profit (+$100) otomatis di Backend
            if (currentPnl <= -50 || currentPnl >= 100) {
                const isSL = currentPnl <= -50;
                virtualBalance += currentPnl;
                if (virtualBalance < 0) virtualBalance = 0;

                tradeHistory.unshift({
                    time: new Date().toLocaleTimeString(),
                    type: `AUTO-CLOSE (${isSL ? 'STOP LOSS' : 'TAKE PROFIT'})`,
                    open: activeTrade.entryPrice.toFixed(4),
                    close: eurUsdPrice.toFixed(4),
                    pnl: currentPnl,
                    balanceAfter: virtualBalance
                });
                if (tradeHistory.length > 25) tradeHistory.pop();
                activeTrade = null;
                console.log(`[Auto-Protection] Posisi ditutup otomatis via ${isSL ? 'Stop Loss' : 'Take Profit'}. PnL: $${currentPnl.toFixed(2)}`);
            }
        }

        // Ambil 3 riwayat transaksi terakhir sebagai "Memori Belajar" Gemini
        const recentHistory = tradeHistory.slice(0, 3).map(h => `${h.type} di ${h.open}, hasil PnL: $${h.pnl ? h.pnl.toFixed(2) : 0}`).join(' | ') || "Belum ada riwayat.";

        // PROMPT AI FULL AUTONOMOUS & AGRESIF
        const prompt = `
Kamu adalah AI Agent Autonomous Trader profesional di pasar Forex (EUR/USD).
- Harga Kurs Saat Ini: $${eurUsdPrice.toFixed(4)}
- Perubahan Tren: ${parseFloat(forexChange) >= 0 ? '+' : ''}${forexChange}%
- Status Posisi Kamu Saat Ini: ${activeTrade ? `SEDANG MEMBUKA ${activeTrade.type} di harga $${activeTrade.entryPrice.toFixed(4)} (PnL sementara:$${currentPnl.toFixed(2)})` : 'TIDAK ADA POSISI (Bebas masuk)'}
- Memori / Riwayat Evaluasi Terakhir: ${recentHistory}

ATURAN UTAMA (WAJIB DITAATI):
1. Bersikaplah **AGRESIF**. Jangan terlalu banyak memilih HOLD kecuali pasar benar-benar stagnan total. Cari peluang cuan setiap ada pergerakan kecil.
2. Jika KAMU TIDAK ADA POSISI, putuskan secara tegas: ketik "BUY" atau "SELL" di kata pertama untuk membuka posisi baru.
3. Jika KAMU SEDANG ADA POSISI, evaluasi kinerjamu. Jika sudah untung atau jika tren berbalik merugikan berdasarkan memori evaluasi, kamu BEBAS memutuskan untuk mengetik "CLOSE" di kata pertama untuk menutup posisi, atau biarkan tetap jalan jika masih potensial.
4. Format Jawaban: Kata pertama HARUS salah satu dari: "BUY", "SELL", atau "CLOSE", atau "HOLD", diikuti titik, lalu berikan alasan singkat analisismu.
`;

        let aiAnalysisText = "Analisis otonom diproses...";
        let actionDecision = "HOLD";

        try {
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            if (aiResponse.text) {
                aiAnalysisText = aiResponse.text;
                const textUpper = aiResponse.text.toUpperCase();
                
                if (textUpper.startsWith("BUY")) actionDecision = "BUY";
                else if (textUpper.startsWith("SELL")) actionDecision = "SELL";
                else if (textUpper.startsWith("CLOSE")) actionDecision = "CLOSE";
                else actionDecision = "HOLD";
            }
        } catch (e) {
            console.warn("AI fallback error:", e.message);
            actionDecision = activeTrade ? "CLOSE" : (parseFloat(forexChange) >= 0 ? "BUY" : "SELL");
        }

        // EKSEKUSI KEPUTUSAN OTONOM GEMINI
        const tradeAmount = 500; // Modal posisi $500 (lebih aman dibanding $1000)

        // 1. Jika Gemini memutuskan CLOSE posisi aktif
        if (actionDecision === "CLOSE" && activeTrade) {
            virtualBalance += currentPnl;
            if (virtualBalance < 0) virtualBalance = 0;

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString(),
                type: `CLOSE (${activeTrade.type})`,
                open: activeTrade.entryPrice.toFixed(4),
                close: eurUsdPrice.toFixed(4),
                pnl: currentPnl,
                balanceAfter: virtualBalance
            });
            if (tradeHistory.length > 25) tradeHistory.pop();
            activeTrade = null;
        } 
        // 2. Jika Gemini memutuskan BUKA POSISI BARU (BUY / SELL) dan belum ada posisi aktif
        else if ((actionDecision === "BUY" || actionDecision === "SELL") && !activeTrade && virtualBalance >= tradeAmount) {
            activeTrade = {
                type: actionDecision,
                amount: tradeAmount,
                entryPrice: eurUsdPrice
            };

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString(),
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
            timestamp: new Date().toLocaleTimeString()
        };

        console.log(`[Autonomous Bot] Harga: $${eurUsdPrice.toFixed(4)} | Keputusan AI: ${actionDecision} | PnL: $${currentPnl.toFixed(2)}`);
    } catch (error) {
        console.error("Error autonomous loop:", error.message);
    }
}

app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("🤖 Bot Full-Autonomous Diaktifkan.");
        await runAutonomousForexBot();
        if (botInterval) clearInterval(botInterval);
        botInterval = setInterval(runAutonomousForexBot, 25000);
    }
    res.json({ success: true, message: "Bot Autonomous aktif!" });
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
    console.log(`Server Autonomous Forex berjalan di port ${port}`);
});
