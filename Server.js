import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// API Key Google Gemini
const ai = new GoogleGenAI({ apiKey: 'AQ.Ab8RN6KkAKaKq9epVyDmaL7DPWlj98JlC9kAulmw2TQFimoULA' });

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
        
        // Pergerakan harga sintetis yang lebih halus
        const marketNoise = (Math.sin(cycleCount * 1.5) * 0.0004) + ((Math.random() - 0.48) * 0.0003);
        eurUsdPrice += marketNoise;
        const forexChange = (marketNoise * 100).toFixed(2);

        // Hitung PnL posisi aktif saat ini (jika ada)
        let currentPnl = 0;
        let pnlPercentage = 0;
        if (activeTrade) {
            let priceDiff = (activeTrade.type === "BUY") ? (eurUsdPrice - activeTrade.entryPrice) : (activeTrade.entryPrice - eurUsdPrice);
            
            // Leverage virtual 10x agar PnL terkontrol & tidak memicu loss ribuan dolar
            pnlPercentage = (priceDiff / activeTrade.entryPrice) * 100 * 10; 
            currentPnl = (activeTrade.amount * pnlPercentage) / 100;

            // PROTEKSI MANDIRI: Auto Stop Loss (-$50) & Take Profit (+$100)
            if (currentPnl <= -50 || currentPnl >= 100) {
                const isSL = currentPnl <= -50;
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
                console.log(`[Money Management] Posisi ditutup otomatis via ${isSL ? 'Stop Loss' : 'Take Profit'}. PnL: $${currentPnl.toFixed(2)}`);
            }
        }

        // Ambil 3 riwayat transaksi terakhir sebagai "Memori Belajar" Gemini
        const recentHistory = tradeHistory.slice(0, 3).map(h => `${h.type} di ${h.open}, hasil PnL: $${h.pnl ? h.pnl.toFixed(2) : 0}`).join(' | ') || "Belum ada riwayat.";

        // PROMPT AI: PERSONA DESMOND WIRA (FULL-TIME TRADER EXPERT & DISIPLIN)
        const prompt = `
Kamu adalah "Orion", seorang Full-Time Trader Forex profesional dan berpengalaman dengan filosofi trading ala Desmond Wira ("Smart Traders Not Gamblers").

FILOSOFI & MANAJEMEN RISIKO KAMU:
1. TRADING BUKAN JUDI: Selalu prioritaskan perlindungan modal (Capital Preservation). Jangan pernah membuka posisi tanpa alasan teknikal/dinamika harga yang kuat.
2. DISIPLIN & OBJEKTIF: Analisis pergerakan EUR/USD secara dingin dan profesional. Hindari emosi atau terburu-buru.
3. KONDISI PASAR SAAT INI:
   - Harga Kurs EUR/USD: $${eurUsdPrice.toFixed(4)}
   - Dinamika Perubahan Tren: ${parseFloat(forexChange) >= 0 ? '+' : ''}${forexChange}%
   - Status Posisi Aktif: ${activeTrade ? `SEDANG MEMBUKA ${activeTrade.type} di harga $${activeTrade.entryPrice.toFixed(4)} (PnL berjalan:$${currentPnl.toFixed(2)})` : 'TIDAK ADA POSISI (Siap eksekusi jika ada setup bagus)'}
   - Evaluasi Transaksi Terakhir: ${recentHistory}

PETUNJUK EKSEKUSI TRADING PLAN:
- Jika TIDAK ADA POSISI: Cari setup high probability. Jika tren mendukung, putuskan "BUY" atau "SELL". Jika pasar tidak jelas/risk-to-reward buruk, pilih "HOLD" demi mengamankan modal.
- Jika SEDANG ADA POSISI: Evaluasi PnL berjalan. Jika sudah mencapai target profit wajar atau tren berbalik arah merugikan, putuskan "CLOSE". Jika masih sesuai jalur analisa, pilih "HOLD".
- Format Jawaban: Kata pertama WAJIB salah satu dari: "BUY", "SELL", "CLOSE", atau "HOLD", diikuti titik, lalu berikan analisis singkat dingin ala Desmond Wira (maksimal 2 kalimat).
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
        const tradeAmount = 500; // Modal per posisi $500 (Aman untuk modal $10.000)

        // 1. Jika Gemini memutuskan CLOSE posisi aktif
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
        // 2. Jika Gemini memutuskan BUKA POSISI BARU (BUY / SELL) dan belum ada posisi aktif
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

        console.log(`[Orion Trader] Harga: $${eurUsdPrice.toFixed(4)} | Keputusan: ${actionDecision} | PnL: $${currentPnl.toFixed(2)}`);
    } catch (error) {
        console.error("Error autonomous loop:", error.message);
    }
}

app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("🤖 Bot Full-Autonomous Orion (Desmond Wira Mode) Diaktifkan.");
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
    console.log(`Server Autonomous Forex Orion berjalan di port ${port}`);
});
