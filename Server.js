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

// Endpoint untuk menyalakan bot 24/7 di server
app.get('/api/start-bot', (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("🤖 Bot trading 24/7 dijalankan (Interval 30s, Trade 3m, Perhitungan Saldo Akurat).");
        
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

                // 2. Analisis AI Seimbang (Boleh HOLD tapi tetap aktif)
                const prompt = `Analisis harga Bitcoin saat ini: $${btcPrice} (Perubahan 24 jam: ${btcChange}%). Sebagai trader profesional, tentukan arah 3 menit ke depan. Utamakan memilih "BUY" atau "SELL" jika ada peluang fluktuasi, dan gunakan "HOLD" hanya jika pasar benar-benar datar/sangat berisiko. Jawab dengan format kata pertama: BUY, SELL, atau HOLD, diikuti alasan singkat 1 kalimat.`;
                
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
                        
                        if (textUpper.includes("BUY") && !textUpper.includes("NO BUY")) {
                            actionDecision = "BUY";
                        } else if (textUpper.includes("SELL") && !textUpper.includes("NO SELL")) {
                            actionDecision = "SELL";
                        } else {
                            actionDecision = "HOLD";
                        }
                    }
                } catch (e) {
                    console.warn("AI fallback server:", e.message);
                    actionDecision = btcChange >= 0 ? "BUY" : "SELL";
                }

                // Pengaman: Jika AI memilih HOLD 3 kali berturut-turut, paksa ambil keputusan
                if (actionDecision === "HOLD") {
                    consecutiveHolds++;
                    if (consecutiveHolds >= 3) {
                        actionDecision = btcChange >= 0 ? "BUY" : "SELL";
                        aiAnalysisText += ` (Dipaksa aktif karena terlalu banyak HOLD)`;
                        consecutiveHolds = 0;
                    }
                } else {
                    consecutiveHolds = 0;
                }

                // 3. Kelola Active Trades & Timer Auto-Close (Durasi 3 menit / 180 detik)
                for (let i = activeTrades.length - 1; i >= 0; i--) {
                    let trade = activeTrades[i];
                    trade.timeLeft -= 30; // Berkurang 30 detik tiap loop

                    if (trade.timeLeft <= 0) {
                        let diff = (trade.type === "BUY") ? (btcPrice - trade.entryPrice) : (trade.entryPrice - btcPrice);
                        let profitPercentage = (diff / trade.entryPrice) * 100 * 2; // Leverage 2x
                        let pnlResult = (trade.amount * profitPercentage) / 100;
                        
                        // RUMUS DIPERBAIKI: Modal awal dikembalikan utuh ditambah/dikurangi PnL
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

                // 4. Eksekusi Buka Posisi (Modal dipotong sementara saat Open)
                const tradeAmount = 100;
                const durationSeconds = 180; // 3 Menit

                if ((actionDecision === "BUY" || actionDecision === "SELL") && virtualBalance >= tradeAmount && activeTrades.length < 2) {
                    virtualBalance -= tradeAmount; // Potong saldo untuk modal posisi aktif
                    
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
                    activeTradesCount: activeTrades.length,
                    timestamp: new Date().toLocaleTimeString()
                };

                console.log(`[Loop #${cycleCount}] BTC: $${btcPrice} | Aksi: ${actionDecision} | Saldo: $${virtualBalance.toFixed(2)}`);
            } catch (error) {
                console.error("Error pada loop server:", error.message);
            }
        }, 30000); // 30 Detik
    }
    res.json({ success: true, message: "Bot aktif di server dengan perhitungan saldo akurat!" });
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
                            
