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

// Config Live Broker (MetaApi untuk MT4/MT5)
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
let activeTrades = []; // MENAMPUNG HINGGA 3 POSISI AKTIF
let tradeHistory = [];
let priceHistory = [];
let cycleCount = 0;
let serverLogs = {};
let marketMemory = []; 

// DYNAMIC MONEY MANAGEMENT ENGINE
function calculateDynamicRisk(balance) {
    const tradeAmount = Math.max(100, balance * 0.05);
    let calculatedLot = parseFloat((balance / 100000).toFixed(2));
    if (calculatedLot < 0.01) calculatedLot = 0.01;

    return { tradeAmount, calculatedLot };
}

function updateMarketMemory(price, rsi, ema, macdStatus, decision, reasoning, pnl) {
    marketMemory.push({
        time: new Date().toLocaleTimeString('id-ID'),
        price: price.toFixed(4),
        rsi: rsi,
        ema: ema.toFixed(4),
        macd: macdStatus,
        decision: decision,
        reasoning: reasoning,
        pnl: pnl ? `$${pnl.toFixed(2)}` : '$0.00'
    });

    if (marketMemory.length > 10) marketMemory.shift();
}

// HELPER INDICATOR CALCULATORS
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
        return { macd: "0.00000", signal: "0.00000", status: "NEUTRAL" };
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
        macd: macdLine.toFixed(5),
        signal: signalLine.toFixed(5),
        status: status
    };
}

// 3. BROKER EXECUTION LAYER
async function executeBrokerOrder(action, price, lotSize = 0.01, slPrice = 0, tpPrice = 0) {
    console.log(`[Agent Execution] Action: ${action} | Price: $${price} | Dynamic Lot: ${lotSize}`);

    if (ENABLE_LIVE_BROKER) {
        try {
            const metaApiUrl = `https://mt-client-api-v1.agium.metaapi.cloud/users/current/accounts/${META_ACCOUNT_ID}/trade`;
            const payload = {
                actionType: action === 'BUY' ? 'ORDER_TYPE_BUY' : (action === 'SELL' ? 'ORDER_TYPE_SELL' : 'ORDER_TYPE_CLOSE_BY'),
                symbol: 'EURUSD',
                volume: lotSize,
                stopLoss: slPrice,
                takeProfit: tpPrice
            };

            const response = await fetch(metaApiUrl, {
                method: 'POST',
                headers: {
                    'auth-token': META_API_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            console.log('[Live Broker Response]:', result);
            return result;
        } catch (err) {
            console.error('[Live Broker Error]: Gagal eksekusi ke MetaTrader:', err.message);
        }
    } else {
        console.log('[Paper Trading Engine] Order dieksekusi secara lokal dengan Lot Dinamis.');
    }
}

// 4. AUTONOMOUS AGENT MAIN LOOP
async function runAutonomousForexAgent() {
    if (isExecutingCycle) return;
    isExecutingCycle = true;

    cycleCount++;
    try {
        const forexRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
        const forexData = await forexRes.json();
        let eurUsdPrice = forexData.rates.USD;
        
        const marketNoise = (Math.sin(cycleCount * 1.5) * 0.0004) + ((Math.random() - 0.48) * 0.0003);
        eurUsdPrice += marketNoise;
        const forexChange = (marketNoise * 100).toFixed(2);

        priceHistory.push(eurUsdPrice);
        if (priceHistory.length > 50) priceHistory.shift();

        const rsiValue = Math.floor(40 + (Math.sin(cycleCount) * 25) + (Math.random() * 10));
        const ema20Value = calculateEMA(priceHistory, 20);
        const macdData = calculateMACD(priceHistory);
        const emaTrend = eurUsdPrice >= ema20Value ? "UPTREND (Bullish)" : "DOWNTREND (Bearish)";

        const { tradeAmount, calculatedLot } = calculateDynamicRisk(virtualBalance);

        // EVALUASI & AUTO-CLOSE UNTUK TIAP POSISI YANG AKTIF
        let totalCurrentPnl = 0;
        for (let i = activeTrades.length - 1; i >= 0; i--) {
            let trade = activeTrades[i];
            let priceDiff = (trade.type === "BUY") ? (eurUsdPrice - trade.entryPrice) : (trade.entryPrice - eurUsdPrice);
            let pnlPercentage = (priceDiff / trade.entryPrice) * 100 * 10;
            let currentPnl = (trade.amount * pnlPercentage) / 100;
            totalCurrentPnl += currentPnl;

            const dynamicSL = -10 * (trade.lot / 0.10);

            // CLOSE INDIVIDUAL JIKA PROFIT >= $1.50 ATAU KENA SL
            if (currentPnl >= 1.50 || currentPnl <= dynamicSL) {
                const isTP = currentPnl >= 1.50;
                virtualBalance += currentPnl;
                
                await executeBrokerOrder("CLOSE", eurUsdPrice);

                tradeHistory.unshift({
                    time: new Date().toLocaleTimeString('id-ID'),
                    type: `AUTO-CLOSE ${trade.type} (${isTP ? 'TP +$1.50' : 'STOP LOSS'})`,
                    open: trade.entryPrice.toFixed(4),
                    close: eurUsdPrice.toFixed(4),
                    pnl: currentPnl,
                    balanceAfter: virtualBalance
                });

                updateMarketMemory(eurUsdPrice, rsiValue, ema20Value, macdData.status, "AUTO-CLOSE", `Posisi ${trade.type} #${i+1} ditutup (${isTP ? 'TP +$1.50' : 'SL'})`, currentPnl);
                
                activeTrades.splice(i, 1);
            }
        }

        const systemPrompt = `
Kamu adalah "Orion", Autonomous AI Agent Trading Forex dengan strategi Scalping & Dynamic Money Management ala Desmond Wira.

KONTEKS MEMORI PASAR (10 SIKLUS TERAKHIR):
${JSON.stringify(marketMemory, null, 2)}

DATA PASAR & RISIKO DINAMIS SAAT INI:
- EUR/USD Rate: $${eurUsdPrice.toFixed(4)} (${parseFloat(forexChange) >= 0 ? '+' : ''}${forexChange}%)
- Indikator RSI (14): ${rsiValue}
- Indikator EMA (20): $${ema20Value.toFixed(4)} (${emaTrend})
- Indikator MACD: ${macdData.macd} (${macdData.status})
- Saldo Akun Terkini: $${virtualBalance.toFixed(2)}
- Alokasi Risk Dinamis: Modal Per Position $${tradeAmount.toFixed(2)} | Auto-Scaled Lot: ${calculatedLot} Lot
- Posisi Aktif Saat Ini: ${activeTrades.length > 0 ? `${activeTrades.length} dari 3 posisi aktif terbuka \vert{} Total PnL sementara:$${totalCurrentPnl.toFixed(2)}` : 'TIDAK ADA POSISI (Sistem siap open 3 transaksi)'}

ATURAN ENTRY & EXIT:
1. JIKA ADA POSISI TERBUKA (${activeTrades.length} posisi aktif):
   - Selalu keluarkan "HOLD" sampai semua 3 posisi selesai dieksekusi oleh Target Profit ($1.50) / Stop Loss!
2. JIKA TIDAK ADA POSISI AKTIF (0 posisi):
   - "BUY": RSI < 45, EMA UPTREND, atau MACD GOLDEN CROSS.
   - "SELL": RSI > 55, EMA DOWNTREND, atau MACD DEATH CROSS.
   - Jika indikator bertabrakan, keluarkan "HOLD".

ATURAN RESPON JSON:
Balas HANYA dengan format JSON MURNI:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0.85,
  "reasoning": "Penjelasan singkat keputusan berbasis indikator dan risk dinamis (maks 2 kalimat)"
}
`;

        let agentDecision = { action: "HOLD", reasoning: "Memproses analisis...", confidence: 0 };

        try {
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: systemPrompt,
                config: {
                    responseMimeType: "application/json"
                }
            });

            if (aiResponse.text) {
                const cleanedJson = aiResponse.text.replace(/```json|```/g, '').trim();
                agentDecision = JSON.parse(cleanedJson);
            }
        } catch (e) {
            console.warn("[Gemini Agent Error]: Fallback ke indikator ->", e.message);
            if (activeTrades.length === 0) {
                if (rsiValue < 45 && eurUsdPrice >= ema20Value) agentDecision.action = "BUY";
                else if (rsiValue > 55 && eurUsdPrice < ema20Value) agentDecision.action = "SELL";
                else agentDecision.action = "HOLD";
            } else {
                agentDecision.action = "HOLD";
            }
            agentDecision.reasoning = `Fallback indikator aktif. RSI: ${rsiValue}`;
        }

        // EKSEKUSI 3 POSISI SEKALIGUS (BISA BUY / SELL)
        if ((agentDecision.action === "BUY" || agentDecision.action === "SELL") && activeTrades.length === 0 && virtualBalance >= (tradeAmount * 3)) {
            
            for (let i = 0; i < 3; i++) {
                activeTrades.push({
                    id: Date.now() + i,
                    type: agentDecision.action,
                    amount: tradeAmount,
                    lot: calculatedLot,
                    entryPrice: eurUsdPrice
                });

                await executeBrokerOrder(agentDecision.action, eurUsdPrice, calculatedLot);
            }

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString('id-ID'),
                type: `OPEN 3x ${agentDecision.action} (${calculatedLot} Lot x3)`,
                open: eurUsdPrice.toFixed(4),
                close: eurUsdPrice.toFixed(4),
                pnl: 0,
                balanceAfter: virtualBalance
            });

            updateMarketMemory(eurUsdPrice, rsiValue, ema20Value, macdData.status, agentDecision.action, agentDecision.reasoning, 0);

        } else {
            updateMarketMemory(eurUsdPrice, rsiValue, ema20Value, macdData.status, "HOLD", agentDecision.reasoning, totalCurrentPnl);
        }

        if (tradeHistory.length > 25) tradeHistory.pop();

        // BUILD LOGS FOR FRONTEND DASHBOARD
        serverLogs = {
            price: eurUsdPrice.toFixed(4),
            change: parseFloat(forexChange),
            analysis: `[3-Position Scalper - Conf: ${(agentDecision.confidence * 100).toFixed(0)}%] ${agentDecision.reasoning}`,
            decision: agentDecision.action,
            balance: virtualBalance,
            dynamicLot: calculatedLot,
            tradeAllocation: tradeAmount,
            // DI SINI KUNCI PEMPERBAIKAN TAMPILAN DASHBOARD:
            activeTrade: activeTrades.length > 0 ? activeTrades[0] : null,
            activeTradesCount: activeTrades.length,
            activeTrades: activeTrades,
            totalCurrentPnl: totalCurrentPnl,
            indicators: {
                rsi: rsiValue,
                ema20: ema20Value.toFixed(4),
                macdStatus: macdData.status
            },
            tradeHistory: tradeHistory,
            marketMemory: marketMemory,
            timestamp: new Date().toLocaleTimeString('id-ID')
        };

        console.log(`[Scaled Orion] Balance: $${virtualBalance.toFixed(2)} | Active Trades: ${activeTrades.length}/3 | Action: ${agentDecision.action} | Total PnL: $${totalCurrentPnl.toFixed(2)}`);

    } catch (error) {
        console.error("Error autonomous agent loop:", error.message);
    } finally {
        isExecutingCycle = false;
    }
}

// 5. API ENDPOINTS
app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("⚡ Dynamic 3-Position Scalper AI Agent Orion Diaktifkan.");
        await runAutonomousForexAgent();
        if (botInterval) clearInterval(botInterval);
        botInterval = setInterval(runAutonomousForexAgent, 25000);
    }
    res.json({ success: true, message: "Dynamic Scalper Agent aktif!" });
});

app.get('/api/stop-bot', (req, res) => {
    isBotRunning = false;
    if (botInterval) clearInterval(botInterval);
    console.log("⏹ Agent dihentikan.");
    res.json({ success: true, message: "Agent dihentikan." });
});

app.get('/api/bot-status', (req, res) => {
    res.json({
        running: isBotRunning,
        data: serverLogs
    });
});

app.listen(port, () => {
    console.log(`Dynamic Scalper Forex AI Agent Orion berjalan di port ${port}`);
});
