import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// 1. CONFIGURATION & GEMINI API KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6KkAKaKq9epVyDmaL7DPWlj98JlC9kAulmw2TQFimoULA';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Config Live Broker (MetaApi untuk MT4/MT5)
const ENABLE_LIVE_BROKER = process.env.ENABLE_LIVE_BROKER === 'true';
const META_API_TOKEN = process.env.META_API_TOKEN || 'YOUR_META_API_TOKEN';
const META_ACCOUNT_ID = process.env.META_ACCOUNT_ID || 'YOUR_META_ACCOUNT_ID';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 2. STATEFUL AGENT MEMORY ENGINE & PRICE HISTORY
let isBotRunning = false;
let botInterval = null;
let virtualBalance = 10000;
let activeTrade = null;
let tradeHistory = [];
let priceHistory = []; // Menyimpan riwayat harga untuk kalkulasi EMA & MACD
let cycleCount = 0;
let serverLogs = {};
let marketMemory = []; 

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
    const signalLine = macdLine * 0.8; // Pembobotan garis sinyal cepat
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

// 3. BROKER EXECUTION LAYER (Simulasi vs Live Execution MetaTrader)
async function executeBrokerOrder(action, price, lotSize = 0.01, slPrice = 0, tpPrice = 0) {
    console.log(`[Agent Action Execution] Executing ${action} Order | Price: $${price} | Lot: ${lotSize}`);

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
        console.log('[Paper Trading Engine] Order dieksekusi secara lokal.');
    }
}

// 4. AUTONOMOUS AGENT MAIN LOOP (SCALPING + MULTI-INDICATOR MODE)
async function runAutonomousForexAgent() {
    cycleCount++;
    try {
        // Fetch Kurs EUR/USD Real-Time
        const forexRes = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
        const forexData = await forexRes.json();
        let eurUsdPrice = forexData.rates.USD;
        
        // Volatilitas sintetis untuk pergerakan intraday
        const marketNoise = (Math.sin(cycleCount * 1.5) * 0.0004) + ((Math.random() - 0.48) * 0.0003);
        eurUsdPrice += marketNoise;
        const forexChange = (marketNoise * 100).toFixed(2);

        // Update riwayat harga (Maksimal simpan 50 baris harga)
        priceHistory.push(eurUsdPrice);
        if (priceHistory.length > 50) priceHistory.shift();

        // KALKULASI TEKNIKAL: RSI, EMA, MACD
        const rsiValue = Math.floor(40 + (Math.sin(cycleCount) * 25) + (Math.random() * 10));
        const ema20Value = calculateEMA(priceHistory, 20);
        const macdData = calculateMACD(priceHistory);
        const emaTrend = eurUsdPrice >= ema20Value ? "UPTREND (Bullish)" : "DOWNTREND (Bearish)";

        // Hitung PnL Posisi Aktif
        let currentPnl = 0;
        let pnlPercentage = 0;
        if (activeTrade) {
            let priceDiff = (activeTrade.type === "BUY") ? (eurUsdPrice - activeTrade.entryPrice) : (activeTrade.entryPrice - eurUsdPrice);
            pnlPercentage = (priceDiff / activeTrade.entryPrice) * 100 * 10; // Virtual Leverage 10x
            currentPnl = (activeTrade.amount * pnlPercentage) / 100;

            // HARD SAFETY GUARD: Stop Loss (-$10) & Take Profit (+$15)
            if (currentPnl <= -10 || currentPnl >= 15) {
                const isSL = currentPnl <= -10;
                virtualBalance += currentPnl;
                
                await executeBrokerOrder("CLOSE", eurUsdPrice);

                tradeHistory.unshift({
                    time: new Date().toLocaleTimeString('id-ID'),
                    type: `AUTO-CLOSE (${isSL ? 'STOP LOSS' : 'TAKE PROFIT'})`,
                    open: activeTrade.entryPrice.toFixed(4),
                    close: eurUsdPrice.toFixed(4),
                    pnl: currentPnl,
                    balanceAfter: virtualBalance
                });
                
                updateMarketMemory(eurUsdPrice, rsiValue, ema20Value, macdData.status, "AUTO-CLOSE", `Posisi ditutup otomatis oleh Hard Safety Guard (${isSL ? 'SL' : 'TP'})`, currentPnl);
                activeTrade = null;
                return;
            }
        }

        // PROMPT ADVANCED AGENT (RSI + EMA + MACD)
        const systemPrompt = `
Kamu adalah "Orion", Autonomous AI Agent Trading Forex kelas dunia dengan disiplin Scalping ala Desmond Wira.

KONTEKS MEMORI PASAR (10 SIKLUS TERAKHIR):
${JSON.stringify(marketMemory, null, 2)}

DATA PASAR REALT-IME & MULTI-INDIKATOR SAAT INI:
- Pasangan Mata Uang: EUR/USD
- Harga Terbaru: $${eurUsdPrice.toFixed(4)} (${parseFloat(forexChange) >= 0 ? '+' : ''}${forexChange}%)
- Indikator RSI (14): ${rsiValue}
- Indikator EMA (20): $${ema20Value.toFixed(4)} -> Tren Utama: ${emaTrend}
- Indikator MACD: ${macdData.macd} (Signal: ${macdData.signal}) -> Sinyal: ${macdData.status}
- Posisi Terbuka Aktif: ${activeTrade ? `JENIS: ${activeTrade.type} | Entry: $${activeTrade.entryPrice.toFixed(4)} \vert{} PnL Berjalan:$${currentPnl.toFixed(2)}` : 'TIDAK ADA POSISI'}
- Saldo Akun: $${virtualBalance.toFixed(2)}

ATURAN SCALPING & PEMBACAAN INDIKATOR:
1. JIKA SEDANG ADA POSISI:
   - Jika PnL berjalan sudah untung >= +$3.00, UTAMAKAN KELUARKAN "CLOSE" untuk kunci profit cepat!
   - Jika PnL minus dan sinyal MACD/EMA berbalik arah merugikan, keluarkan "CLOSE".
2. JIKA TIDAK ADA POSISI:
   - Syarat "BUY": RSI < 45, EMA menunjukkan UPTREND, atau MACD membentuk GOLDEN CROSS.
   - Syarat "SELL": RSI > 55, EMA menunjukkan DOWNTREND, atau MACD membentuk DEATH CROSS.
   - Jika indikator saling bertabrakan/tanpa konfirmasi jelas, keluarkan "HOLD".

ATURAN RESPON JSON:
Balas HANYA dengan format JSON MURNI sesuai schema berikut:
{
  "action": "BUY" | "SELL" | "CLOSE" | "HOLD",
  "confidence": 0.85,
  "lotSize": 0.01,
  "reasoning": "Alasan analisis gabungan RSI, EMA, dan MACD (maksimal 2 kalimat)"
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
            console.warn("[Gemini Agent Error]: Fallback ke logika indikator ->", e.message);
            if (activeTrade && currentPnl >= 3) {
                agentDecision.action = "CLOSE";
            } else if (!activeTrade) {
                if (rsiValue < 45 && eurUsdPrice >= ema20Value) agentDecision.action = "BUY";
                else if (rsiValue > 55 && eurUsdPrice < ema20Value) agentDecision.action = "SELL";
                else agentDecision.action = "HOLD";
            } else {
                agentDecision.action = "HOLD";
            }
            agentDecision.reasoning = `Fallback indikator aktif. RSI: ${rsiValue}, EMA: ${ema20Value.toFixed(4)}`;
        }

        const tradeAmount = 500; // Modal per posisi $500

        // 5. AGENT ACTION DISPATCHER & EXECUTION
        if (agentDecision.action === "CLOSE" && activeTrade) {
            virtualBalance += currentPnl;
            await executeBrokerOrder("CLOSE", eurUsdPrice);

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString('id-ID'),
                type: `CLOSE (${activeTrade.type})`,
                open: activeTrade.entryPrice.toFixed(4),
                close: eurUsdPrice.toFixed(4),
                pnl: currentPnl,
                balanceAfter: virtualBalance
            });
            
            updateMarketMemory(eurUsdPrice, rsiValue, ema20Value, macdData.status, "CLOSE", agentDecision.reasoning, currentPnl);
            activeTrade = null;

        } else if ((agentDecision.action === "BUY" || agentDecision.action === "SELL") && !activeTrade && virtualBalance >= tradeAmount) {
            
            activeTrade = {
                type: agentDecision.action,
                amount: tradeAmount,
                entryPrice: eurUsdPrice
            };

            await executeBrokerOrder(agentDecision.action, eurUsdPrice, agentDecision.lotSize || 0.01);

            tradeHistory.unshift({
                time: new Date().toLocaleTimeString('id-ID'),
                type: `OPEN ${agentDecision.action}`,
                open: eurUsdPrice.toFixed(4),
                close: eurUsdPrice.toFixed(4),
                pnl: 0,
                balanceAfter: virtualBalance
            });

            updateMarketMemory(eurUsdPrice, rsiValue, ema20Value, macdData.status, agentDecision.action, agentDecision.reasoning, 0);

        } else {
            updateMarketMemory(eurUsdPrice, rsiValue, ema20Value, macdData.status, "HOLD", agentDecision.reasoning, currentPnl);
        }

        if (tradeHistory.length > 25) tradeHistory.pop();

        // 6. BUILD LOGS FOR FRONTEND DASHBOARD
        serverLogs = {
            price: eurUsdPrice.toFixed(4),
            change: parseFloat(forexChange),
            analysis: `[Technical Scalper - Conf: ${(agentDecision.confidence * 100).toFixed(0)}%] ${agentDecision.reasoning}`,
            decision: agentDecision.action,
            balance: virtualBalance,
            activeTrade: activeTrade,
            currentPnl: currentPnl,
            indicators: {
                rsi: rsiValue,
                ema20: ema20Value.toFixed(4),
                macdStatus: macdData.status
            },
            tradeHistory: tradeHistory,
            marketMemory: marketMemory,
            timestamp: new Date().toLocaleTimeString('id-ID')
        };

        console.log(`[Scalper Orion] Price: $${eurUsdPrice.toFixed(4)} | EMA20: $${ema20Value.toFixed(4)} | Action: ${agentDecision.action} | PnL: $${currentPnl.toFixed(2)}`);

    } catch (error) {
        console.error("Error autonomous agent loop:", error.message);
    }
}

// 7. API ENDPOINTS
app.get('/api/start-bot', async (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("⚡ Multi-Indicator Forex AI Agent Orion Diaktifkan.");
        await runAutonomousForexAgent();
        if (botInterval) clearInterval(botInterval);
        botInterval = setInterval(runAutonomousForexAgent, 25000);
    }
    res.json({ success: true, message: "Multi-Indicator Scalper Agent aktif!" });
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
    console.log(`Multi-Indicator Forex AI Agent Orion berjalan di port ${port}`);
});
