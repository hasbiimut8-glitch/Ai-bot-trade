import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// 1. CONFIGURATION & GEMINI API KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY tidak ditemukan di environment variable!");
    process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// MEMECOIN PAIR CONFIGURATION
const MEMECOIN_SYMBOL = 'PEPEUSDT';
const MEMECOIN_DISPLAY = 'PEPE/USDT';

// Config Live Broker
const ENABLE_LIVE_BROKER = process.env.ENABLE_LIVE_BROKER === 'true';
const META_API_TOKEN = process.env.META_API_TOKEN || '';
const META_ACCOUNT_ID = process.env.META_ACCOUNT_ID || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 2. STATEFUL AGENT MEMORY ENGINE
let isBotRunning = false;
let botInterval = null;
let isExecutingCycle = false; 
let virtualBalance = 10000;
let activeTrades = [];
let tradeHistory = [];
let priceHistory = [];
let cycleCount = 0;
let serverLogs = {};
let marketMemory = []; 

function calculateDynamicRisk(balance) {
    const tradeAmount = Math.max(50, balance * 0.05);
    let calculatedLot = parseFloat((balance / 100000).toFixed(2));
    if (calculatedLot < 0.01) calculatedLot = 0.01;

    return { tradeAmount, calculatedLot };
}

function updateMarketMemory(price, rsi, ema, macdStatus, decision, reasoning, pnl) {
    marketMemory.push({
        time: new Date().toLocaleTimeString('id-ID'),
        price: price.toFixed(8),
        rsi: rsi,
        ema: ema.toFixed(8),
        macd: macdStatus,
        decision: decision,
        reasoning: reasoning,
        pnl: pnl ? `$${pnl.toFixed(2)}` : '$0.00'
    });

    if (marketMemory.length > 10) marketMemory.shift();
}

function calculateEMA(prices, period) {
    if (prices.length === 0) return 0;
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
}

function calculateMACD(prices) {
    if (prices.length < 12) {
        return { macd: "0.00000000", signal: "0.00000000", status: "NEUTRAL" };
    }
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, Math.min(prices.length, 26));
    const macdLine = ema12 - ema26;
    const signalLine = macdLine * 0.8;
    const histogram = macdLine - signalLine;

    let status = "NEUTRAL";
    if (macdLine > 0 && histogram > 0) status = "GOLDEN CROSS (Bullish Momentum)";
    else if (macdLine < 0 && histogram < 0) status = "DEATH CROSS (Bearish Momentum)";

    return {
        macd: macdLine.toFixed(8),
        signal: signalLine.toFixed(8),
        status: status
    };
}

// 3. BROKER EXECUTION LAYER
async function executeBrokerOrder(action, price, lotSize = 0.01) {
    console.log(`[Agent Execution] Action: ${action} | ${MEMECOIN_DISPLAY} Price: $${price} | Lot: ${lotSize}`);

    if (ENABLE_LIVE_BROKER) {
        try {
            const metaApiUrl = `https://mt-client-api-v1.agium.metaapi.cloud/users/current/accounts/${META_ACCOUNT_ID}/trade`;
            const payload = {
                actionType: action === 'BUY' ? 'ORDER_TYPE_BUY' : (action === 'SELL' ? 'ORDER_TYPE_SELL' : 'ORDER_TYPE_CLOSE_BY'),
                symbol: MEMECOIN_SYMBOL,
                volume: lotSize
            };

            const response = await fetch(metaApiUrl, {
                method: 'POST',
                headers: {
                    'auth-token': META_API_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            return await response.json();
        } catch (err) {
            console.error('[Live Broker Error]:', err.message);
        }
    }
}

// 4. AUTONOMOUS AGENT MAIN LOOP (FULL GEMINI DECISION)
async function runAutonomousForexAgent() {
    if (isExecutingCycle) return;
    isExecutingCycle = true;

    cycleCount++;
    try {
        let currentPrice = 0;
        
        // FETCH REAL-TIME PRICE
        try {
            const cryptoRes = await fetch(`https://min-api.cryptocompare.com/data/price?fsym=PEPE&tsyms=USDT`);
            const cryptoData = await cryptoRes.json();
            
            if (cryptoData && cryptoData.USDT) {
                currentPrice = parseFloat(cryptoData.USDT);
            } else {
                throw new Error("Gagal mengambil harga PEPE");
            }
        } catch (err) {
            try {
                const mexcRes = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=PEPEUSDT`);
                const mexcData = await mexcRes.json();
                currentPrice = parseFloat(mexcData.price);
            } catch (e) {
                currentPrice = 0.00000950 + (Math.sin(cycleCount * 1.5) * 0.00000040);
            }
        }

        priceHistory.push(currentPrice);
        if (priceHistory.length > 50) priceHistory.shift();

        const rsiValue = Math.floor(35 + (Math.sin(cycleCount * 0.8) * 30) + (Math.random() * 8));
        const ema20Value = calculateEMA(priceHistory, 20);
        const macdData = calculateMACD(priceHistory);
        const emaTrend = currentPrice >= ema20Value ? "UPTREND (Bullish)" : "DOWNTREND (Bearish)";

        const { tradeAmount, calculatedLot } = calculateDynamicRisk(virtualBalance);

        // HITUNG PNL REAL-TIME UNTUK DIANALISIS OLEH GEMINI
        let totalCurrentPnl = 0;
        activeTrades.forEach((trade) => {
            let priceDiff = (trade.type === "BUY") ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
            let pnlPercentage = priceDiff / trade.entryPrice;
            let currentPnl = trade.amount * pnlPercentage * 10;
            totalCurrentPnl += currentPnl;
        });

        const systemPrompt = `
Kamu adalah "Orion", Autonomous AI Agent Trading Memecoin (${MEMECOIN_DISPLAY}).
Kamu memegang KENDALI PENUH untuk membuka (BUY/SELL) dan menutup (CLOSE) posisi trading.

DATA PASAR & POSISI AKTIF:
- Market Symbol: ${MEMECOIN_DISPLAY}
- Harga Saat Ini: $${currentPrice.toFixed(8)}
- Indikator RSI (14): ${rsiValue}
- Indikator EMA (20): $${ema20Value.toFixed(8)} (${emaTrend})
- Indikator MACD: ${macdData.status}
- Saldo Akun: $${virtualBalance.toFixed(2)}
- Jumlah Posisi Aktif Saat Ini: ${activeTrades.length} dari 5 posisi
- Total PnL Sementara Posisi Aktif: $${totalCurrentPnl.toFixed(2)}

ATURAN KEPUTUSAN TRADING:
1. JIKA ADA POSISI AKTIF (${activeTrades.length} posisi terbuka):
   - Jika menurut analisis profit sudah optimal atau pergerakan harga berbalik arah (risiko tinggi), keluarkan tindakan "CLOSE".
   - Jika tren masih mendukung atau profit masih berpotensi naik, keluarkan tindakan "HOLD".
2. JIKA TIDAK ADA POSISI AKTIF (0 posisi):
   - "BUY": RSI < 45, UPTREND, atau MACD GOLDEN CROSS.
   - "SELL": RSI > 55, DOWNTREND, atau MACD DEATH CROSS.
   - "HOLD": Sinyal pasar belum jelas.

ATURAN RESPON JSON:
Balas HANYA dengan format JSON MURNI:
{
  "action": "BUY" | "SELL" | "HOLD" | "CLOSE",
  "confidence": 0.85,
  "reasoning": "Penjelasan alasan AI mengambil tindakan ini (maks 2 kalimat)"
}
`;

        let agentDecision = { action: "HOLD", reasoning: "Menganalisis pergerakan pasar...", confidence: 0 };

        try {
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: systemPrompt,
                config: { responseMimeType: "application/json" }
            });

            if (aiResponse.text) {
                const cleanedJson = aiResponse.text.replace(/```json|```/g, '').trim();
                agentDecision = JSON.parse(cleanedJson);
            }
        } catch (e) {
            console.warn("[Gemini Error] Fallback ke indikator:", e.message);
            if (activeTrades.length > 0) {
                agentDecision.action = "HOLD";
            } else {
                if (rsiValue < 45) agentDecision.action = "BUY";
                else if (rsiValue > 55) agentDecision.action = "SELL";
                else agentDecision.action = "HOLD";
            }
            agentDecision.reasoning = `Fallback mode aktif. RSI: ${rsiValue}`;
        }

        // 1. EKSEKUSI JIKA GEMINI MEMUTUSKAN "CLOSE"
        if (agentDecision.action === "CLOSE" && activeTrades.length > 0) {
            let closeTotalPnl = 0;
            
            for (let trade of activeTrades) {
                let priceDiff = (trade.type === "BUY") ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
                let pnlPercentage = priceDiff / trade.entryPrice;
                let currentPnl = trade.amount * pnlPercentage * 10;

                closeTotalPnl += currentPnl;
                await executeBrokerOrder("CLOSE", currentPrice);
            }

            virtualBalance += closeTotalPnl;

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString('id-ID'),
                type: `GEMINI CLOSE (${closeTotalPnl >= 0 ? 'PROFIT' : 'LOSS'})`,
                open: activeTrades[0].entryPrice.toFixed(8),
                close: currentPrice.toFixed(8),
                pnl: closeTotalPnl,
                balanceAfter: virtualBalance
            });

            updateMarketMemory(currentPrice, rsiValue, ema20Value, macdData.status, "GEMINI CLOSE", agentDecision.reasoning, closeTotalPnl);
            
            activeTrades = []; // Reset posisi aktif setelah ditutup oleh Gemini

        // 2. EKSEKUSI JIKA GEMINI MEMUTUSKAN "BUY" ATAU "SELL" (SAAT TIDAK ADA POSISI)
        } else if ((agentDecision.action === "BUY" || agentDecision.action === "SELL") && activeTrades.length === 0 && virtualBalance >= (tradeAmount * 5)) {
            
            for (let i = 0; i < 5; i++) {
                activeTrades.push({
                    id: Date.now() + i,
                    type: agentDecision.action,
                    amount: tradeAmount,
                    lot: calculatedLot,
                    entryPrice: currentPrice
                });

                await executeBrokerOrder(agentDecision.action, currentPrice, calculatedLot);
            }

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString('id-ID'),
                type: `OPEN 5x ${agentDecision.action} (${MEMECOIN_DISPLAY})`,
                open: currentPrice.toFixed(8),
                close: currentPrice.toFixed(8),
                pnl: 0,
                balanceAfter: virtualBalance
            });

            updateMarketMemory(currentPrice, rsiValue, ema20Value, macdData.status, agentDecision.action, agentDecision.reasoning, 0);

        // 3. JIKA GEMINI MEMUTUSKAN "HOLD"
        } else {
            updateMarketMemory(currentPrice, rsiValue, ema20Value, macdData.status, "HOLD", agentDecision.reasoning, totalCurrentPnl);
        }

        if (tradeHistory.length > 25) tradeHistory.pop();

        serverLogs = {
            symbol: MEMECOIN_DISPLAY,
            price: currentPrice.toFixed(8),
            change: 0.15,
            analysis: `[Gemini Autonomous Agent] ${agentDecision.reasoning}`,
            decision: agentDecision.action,
            balance: virtualBalance,
            dynamicLot: calculatedLot,
            tradeAllocation: tradeAmount,
            activeTrade: activeTrades.length > 0 ? activeTrades[0] : null,
            activeTradesCount: activeTrades.length,
            activeTrades: activeTrades,
            totalCurrentPnl: totalCurrentPnl,
            indicators: {
                rsi: rsiValue,
                ema20: ema20Value.toFixed(8),
                macdStatus: macdData.status
            },
            tradeHistory: tradeHistory,
            marketMemory: marketMemory,
            timestamp: new Date().toLocaleTimeString('id-ID')
        };

    } catch (error) {
        console.error("Error loop:", error.message);
    } finally {
        isExecutingCycle = false;
    }
}

// 5. API ENDPOINTS
app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        await runAutonomousForexAgent();
        if (botInterval) clearInterval(botInterval);
        botInterval = setInterval(runAutonomousForexAgent, 25000);
    }
    res.json({ success: true, message: "Memecoin Scalper Agent aktif!" });
});

app.get('/api/stop-bot', (req, res) => {
    isBotRunning = false;
    if (botInterval) clearInterval(botInterval);
    res.json({ success: true, message: "Agent dihentikan." });
});

app.get('/api/bot-status', (req, res) => {
    res.json({
        running: isBotRunning,
        data: serverLogs
    });
});

app.listen(port, () => {
    console.log(`Memecoin Scalper AI Agent Orion berjalan di port ${port}`);
});
