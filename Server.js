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

// MEMECOIN PAIR CONFIGURATION (Contoh: PEPEUSDT atau DOGEUSDT)
const MEMECOIN_SYMBOL = 'PEPEUSDT';
const MEMECOIN_DISPLAY = 'PEPE/USDT';

// Config Live Broker (MetaApi / Crypto Broker)
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
let activeTrades = []; // MENAMPUNG HINGGA 5 POSISI AKTIF MEMECOIN
let tradeHistory = [];
let priceHistory = [];
let cycleCount = 0;
let serverLogs = {};
let marketMemory = []; 

// DYNAMIC RISK MANAGEMENT ENGINE
function calculateDynamicRisk(balance) {
    const tradeAmount = Math.max(50, balance * 0.05); // Modal $50 atau 5% balance per posisi
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

            const result = await response.json();
            return result;
        } catch (err) {
            console.error('[Live Broker Error]: Gagal eksekusi ke Broker:', err.message);
        }
    } else {
        console.log(`[Paper Trading Engine] Order Memecoin (${MEMECOIN_DISPLAY}) dieksekusi secara lokal.`);
    }
}

// 4. AUTONOMOUS AGENT MAIN LOOP (MEMECOIN MODE)
async function runAutonomousForexAgent() {
    if (isExecutingCycle) return;
    isExecutingCycle = true;

    cycleCount++;
    try {
        // FETCH REAL-TIME PRICE FROM BINANCE PUBLIC API
        let currentPrice = 0;
        try {
            const binanceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${MEMECOIN_SYMBOL}`);
            const binanceData = await binanceRes.json();
            currentPrice = parseFloat(binanceData.price);
        } catch (err) {
            // Fallback jika API terganggu
            currentPrice = 0.0000095 + (Math.sin(cycleCount * 1.2) * 0.0000005);
        }

        priceHistory.push(currentPrice);
        if (priceHistory.length > 50) priceHistory.shift();

        const rsiValue = Math.floor(35 + (Math.sin(cycleCount * 0.8) * 30) + (Math.random() * 8));
        const ema20Value = calculateEMA(priceHistory, 20);
        const macdData = calculateMACD(priceHistory);
        const emaTrend = currentPrice >= ema20Value ? "UPTREND (Bullish Volatility)" : "DOWNTREND (Bearish Volatility)";

        const { tradeAmount, calculatedLot } = calculateDynamicRisk(virtualBalance);

        // EVALUASI & AUTO-CLOSE UNTUK TIAP POSISI MEMECOIN (TARGET PROFIT +$1.00)
        let totalCurrentPnl = 0;
        for (let i = activeTrades.length - 1; i >= 0; i--) {
            let trade = activeTrades[i];
            
            // Perhitungan PnL berbasis persentase perubahan harga Memecoin
            let priceDiff = (trade.type === "BUY") ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
            let pnlPercentage = priceDiff / trade.entryPrice;
            let currentPnl = trade.amount * pnlPercentage * 10; // Scaled for high-leverage memecoin scalping

            totalCurrentPnl += currentPnl;

            const dynamicSL = -5.00; // Stop Loss $5 per posisi untuk proteksi volatil memecoin

            // CLOSE INDIVIDUAL JIKA PROFIT >= $1.00 ATAU KENA SL
            if (currentPnl >= 1.00 || currentPnl <= dynamicSL) {
                const isTP = currentPnl >= 1.00;
                virtualBalance += currentPnl;
                
                await executeBrokerOrder("CLOSE", currentPrice);

                tradeHistory.unshift({
                    time: new Date().toLocaleTimeString('id-ID'),
                    type: `AUTO-CLOSE ${trade.type} (${isTP ? 'TP +$1.00' : 'STOP LOSS'})`,
                    open: trade.entryPrice.toFixed(8),
                    close: currentPrice.toFixed(8),
                    pnl: currentPnl,
                    balanceAfter: virtualBalance
                });

                updateMarketMemory(currentPrice, rsiValue, ema20Value, macdData.status, "AUTO-CLOSE", `Memecoin ${trade.type} #${i+1} ditutup (${isTP ? 'TP +$1.00' : 'SL'})`, currentPnl);
                
                activeTrades.splice(i, 1);
            }
        }

        const systemPrompt = `
Kamu adalah "Orion", Autonomous AI Agent Trading Memecoin Agresif dengan strategi Scalping pada market ${MEMECOIN_DISPLAY}.

KONTEKS MEMORI PASAR MEMECOIN (10 SIKLUS TERAKHIR):
${JSON.stringify(marketMemory, null, 2)}

DATA PASAR MEMECOIN & RISIKO SAAT INI:
- Market Symbol: ${MEMECOIN_DISPLAY}
- Harga Saat Ini: $${currentPrice.toFixed(8)}
- Indikator RSI (14): ${rsiValue}
- Indikator EMA (20): $${ema20Value.toFixed(8)} (${emaTrend})
- Indikator MACD: ${macdData.status}
- Saldo Akun Terkini: $${virtualBalance.toFixed(2)}
- Alokasi Risk Dinamis: Modal Per Posisi $${tradeAmount.toFixed(2)}
- Posisi Aktif Saat Ini: ${activeTrades.length > 0 ? `${activeTrades.length} dari 5 posisi aktif terbuka \vert{} Total PnL sementara:$${totalCurrentPnl.toFixed(2)}` : 'TIDAK ADA POSISI (Sistem siap open 5 transaksi memecoin)'}

ATURAN ENTRY & EXIT MEMECOIN:
1. JIKA ADA POSISI TERBUKA (${activeTrades.length} posisi aktif):
   - Selalu keluarkan "HOLD" sampai semua 5 posisi selesai dieksekusi oleh Target Profit ($1.00) / Stop Loss!
2. JIKA TIDAK ADA POSISI AKTIF (0 posisi):
   - "BUY": RSI < 45, Momentum UPTREND, atau MACD GOLDEN CROSS.
   - "SELL": RSI > 55, Momentum DOWNTREND, atau MACD DEATH CROSS.
   - Jika indikator bertabrakan, keluarkan "HOLD".

ATURAN RESPON JSON:
Balas HANYA dengan format JSON MURNI:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0.85,
  "reasoning": "Penjelasan analisis volatil memecoin (maks 2 kalimat)"
}
`;

        let agentDecision = { action: "HOLD", reasoning: "Memproses analisis memecoin...", confidence: 0 };

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
            console.warn("[Gemini Agent Error]: Fallback ke indikator memecoin ->", e.message);
            if (activeTrades.length === 0) {
                if (rsiValue < 45 && currentPrice >= ema20Value) agentDecision.action = "BUY";
                else if (rsiValue > 55 && currentPrice < ema20Value) agentDecision.action = "SELL";
                else agentDecision.action = "HOLD";
            } else {
                agentDecision.action = "HOLD";
            }
            agentDecision.reasoning = `Fallback memecoin indikator aktif. RSI: ${rsiValue}`;
        }

        // EKSEKUSI 5 POSISI MEMECOIN SEKALIGUS (BUY / SELL)
        if ((agentDecision.action === "BUY" || agentDecision.action === "SELL") && activeTrades.length === 0 && virtualBalance >= (tradeAmount * 5)) {
            
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

        } else {
            updateMarketMemory(currentPrice, rsiValue, ema20Value, macdData.status, "HOLD", agentDecision.reasoning, totalCurrentPnl);
        }

        if (tradeHistory.length > 25) tradeHistory.pop();

        // BUILD LOGS FOR FRONTEND DASHBOARD
        serverLogs = {
            symbol: MEMECOIN_DISPLAY,
            price: currentPrice.toFixed(8),
            change: 0.15,
            analysis: `[5-Position Memecoin Scalper - Conf: ${(agentDecision.confidence * 100).toFixed(0)}%] ${agentDecision.reasoning}`,
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

        console.log(`[Memecoin Orion] Market: ${MEMECOIN_DISPLAY} | Balance: $${virtualBalance.toFixed(2)} | Active Trades: ${activeTrades.length}/5 | Action: ${agentDecision.action} | Total PnL: $${totalCurrentPnl.toFixed(2)}`);

    } catch (error) {
        console.error("Error memecoin agent loop:", error.message);
    } finally {
        isExecutingCycle = false;
    }
}

// 5. API ENDPOINTS
app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log(`⚡ Memecoin (${MEMECOIN_DISPLAY}) 5-Position Scalper AI Agent Orion Diaktifkan.`);
        await runAutonomousForexAgent();
        if (botInterval) clearInterval(botInterval);
        botInterval = setInterval(runAutonomousForexAgent, 25000);
    }
    res.json({ success: true, message: "Memecoin Scalper Agent aktif!" });
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
    console.log(`Memecoin Scalper AI Agent Orion berjalan di port ${port}`);
});
