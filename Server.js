import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// ================== CONFIG & VALIDATION ==================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("FATAL: GEMINI_API_KEY tidak diset.");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
  apiVersion: 'v1',
  httpOptions: {
    headers: { 'x-goog-api-key': GEMINI_API_KEY },
  },
});

const SYMBOL = 'BTCUSDT';
const DISPLAY = 'BTC/USDT';
const CC_FSYM = 'BTC';
const CC_TSYMS = 'USDT';

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.0-flash'];

const ENABLE_LIVE_BROKER = process.env.ENABLE_LIVE_BROKER === 'true';
const META_API_TOKEN = process.env.META_API_TOKEN || '';
const META_ACCOUNT_ID = process.env.META_ACCOUNT_ID || '';
const META_API_BASE = process.env.META_API_BASE || 'https://mt-client-api-v1.agiliumtrade.ai';
const CONTROL_API_KEY = process.env.CONTROL_API_KEY || '';

if (ENABLE_LIVE_BROKER && (!META_API_TOKEN || !META_ACCOUNT_ID)) {
  console.error("FATAL: ENABLE_LIVE_BROKER=true tapi META_API_TOKEN / META_ACCOUNT_ID kosong.");
  process.exit(1);
}

// ================== CONSTANTS ==================
const LOOP_INTERVAL_MS = 25000;
const MAX_ACTIVE_TRADES = 3;
const MAX_PRICE_HISTORY = 100;
const MAX_MARKET_MEMORY = 10;
const MAX_TRADE_HISTORY = 25;

const RISK_PER_TRADE = 0.05;
const TAKER_FEE = 0.001;
const SLIPPAGE = 0.0002;

const STOP_LOSS_PCT = -0.015;
const TAKE_PROFIT_PCT = 0.03;

const FALLBACK_PROFIT_CLOSE_PCT = 0.008;
const FALLBACK_LOSS_CLOSE_PCT = -0.012;

const RSI_PERIOD = 14;
const EMA_FAST = 12;
const EMA_SLOW = 26;
const EMA_SIGNAL = 9;
const MAX_CONSECUTIVE_FAILURES = 5;

// ================== STATE ==================
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
let consecutiveFailures = 0;
let lastGeminiStatus = 'unknown';
let lastCloseEvent = null;   // <-- emotion trigger untuk frontend

// ================== HELPERS ==================
function applySlippage(price, side) {
  return side === 'BUY' ? price * (1 + SLIPPAGE) : price * (1 - SLIPPAGE);
}

function calculateEMA(prices, period) {
  if (!prices || prices.length === 0) return 0;
  if (prices.length < period) return prices.reduce((a, b) => a + b, 0) / prices.length;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateMACDSeries(prices) {
  if (!prices || prices.length < EMA_SLOW + EMA_SIGNAL) return null;
  const macdSeries = [];
  for (let i = EMA_SLOW; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    macdSeries.push(calculateEMA(slice, EMA_FAST) - calculateEMA(slice, EMA_SLOW));
  }
  if (macdSeries.length < EMA_SIGNAL) return null;
  const signal = calculateEMA(macdSeries, EMA_SIGNAL);
  const macd = macdSeries[macdSeries.length - 1];
  const histogram = macd - signal;
  let status = 'NEUTRAL';
  if (macd > 0 && histogram > 0) status = 'GOLDEN CROSS (Bullish Momentum)';
  else if (macd < 0 && histogram < 0) status = 'DEATH CROSS (Bearish Momentum)';
  return { macd, signal, histogram, status };
}

function calculateDynamicRisk(balance, currentPrice) {
  const tradeAmount = Math.max(50, balance * RISK_PER_TRADE);
  let lot = parseFloat((tradeAmount / currentPrice).toFixed(6));
  if (lot < 0.001) lot = 0.001;
  return { tradeAmount, calculatedLot: lot };
}

function computeUnrealizedPnl(currentPrice) {
  let total = 0;
  for (const t of activeTrades) {
    const diff = t.type === 'BUY' ? (currentPrice - t.entryPrice) : (t.entryPrice - currentPrice);
    total += t.notional * (diff / t.entryPrice);
  }
  return total;
}

function computeNetPnl(trade, exitPrice) {
  const grossDiff = trade.type === 'BUY' ? (exitPrice - trade.entryPrice) : (trade.entryPrice - exitPrice);
  const grossPnl = trade.notional * (grossDiff / trade.entryPrice);
  const entryFee = trade.notional * TAKER_FEE;
  const exitFee = (trade.notional + grossPnl) * TAKER_FEE;
  return { grossPnl, netPnl: grossPnl - entryFee - exitFee };
}

function updateMarketMemory({ price, rsi, ema, macdStatus, decision, reasoning, pnl }) {
  marketMemory.push({
    time: new Date().toLocaleTimeString('id-ID'),
    price: price.toFixed(2),
    rsi: rsi === null ? 'N/A' : rsi.toFixed(2),
    ema: ema.toFixed(2),
    macd: macdStatus,
    decision,
    reasoning,
    pnl: pnl != null ? `$${pnl.toFixed(2)}` : '$0.00'
  });
  if (marketMemory.length > MAX_MARKET_MEMORY) marketMemory.shift();
}

// ---- EMOTION EVENT ----
function setCloseEvent(pnl, source) {
  const isProfit = pnl >= 0;
  lastCloseEvent = {
    type: isProfit ? 'PROFIT' : 'LOSS',
    pnl: parseFloat(pnl.toFixed(2)),
    message: isProfit ? 'Horee!!! Berhasil profit' : 'Yaah!! Gagal nih aku coba lagi ya',
    source: source || 'GEMINI',
    timestamp: Date.now()
  };
}

// ================== AUTH ==================
function requireAuth(req, res, next) {
  if (!CONTROL_API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== CONTROL_API_KEY) return res.status(401).json({ success: false, message: 'Unauthorized' });
  next();
}

// ================== PRICE FETCH ==================
async function fetchPrice() {
  try {
    const r = await fetch(`https://min-api.cryptocompare.com/data/price?fsym=${CC_FSYM}&tsyms=${CC_TSYMS}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) { const d = await r.json(); if (d && Number.isFinite(d.USDT)) return parseFloat(d.USDT); }
  } catch {}
  try {
    const r = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${SYMBOL}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) { const d = await r.json(); const p = parseFloat(d?.price); if (Number.isFinite(p)) return p; }
  } catch {}
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${SYMBOL}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) { const d = await r.json(); const p = parseFloat(d?.price); if (Number.isFinite(p)) return p; }
  } catch {}
  throw new Error('Semua sumber harga BTC gagal.');
}

// ================== BROKER ==================
async function executeBrokerOpen(action, price, lot) {
  if (!ENABLE_LIVE_BROKER) return { ok: true, positionId: `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, simulated: true };
  try {
    const url = `${META_API_BASE}/users/current/accounts/${META_ACCOUNT_ID}/trade`;
    const payload = { actionType: action === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL', symbol: SYMBOL, volume: lot };
    const r = await fetch(url, { method: 'POST', headers: { 'auth-token': META_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.message || `HTTP ${r.status}` };
    const positionId = data.positionId || data.orderId || data.order?.id || data.position?.id;
    if (!positionId) return { ok: false, error: 'Broker tidak mengembalikan positionId' };
    return { ok: true, positionId, raw: data };
  } catch (err) { return { ok: false, error: err.message }; }
}

async function executeBrokerClose(positionId) {
  if (!ENABLE_LIVE_BROKER) return { ok: true, simulated: true };
  try {
    const url = `${META_API_BASE}/users/current/accounts/${META_ACCOUNT_ID}/trade`;
    const payload = { actionType: 'POSITION_CLOSE_ID', positionId };
    const r = await fetch(url, { method: 'POST', headers: { 'auth-token': META_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.message || `HTTP ${r.status}` };
    return { ok: true, raw: data };
  } catch (err) { return { ok: false, error: err.message }; }
}

// ================== SL/TP AUTOCLOSE ==================
async function checkStopLossTakeProfit(currentPrice) {
  if (activeTrades.length === 0) return { closed: false, pnl: 0 };
  let closedPnl = 0;
  const remaining = [];
  let anyClosed = false;

  for (const trade of activeTrades) {
    const diff = trade.type === 'BUY' ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
    const pct = diff / trade.entryPrice;

    if (pct <= STOP_LOSS_PCT || pct >= TAKE_PROFIT_PCT) {
      const reason = pct <= STOP_LOSS_PCT ? 'SL' : 'TP';
      const result = await executeBrokerClose(trade.positionId);
      if (!result.ok) { console.error(`[${reason}] Gagal close ${trade.positionId}: ${result.error}`); remaining.push(trade); continue; }
      const { netPnl } = computeNetPnl(trade, currentPrice);
      closedPnl += netPnl;
      anyClosed = true;
      tradeHistory.unshift({
        time: new Date().toLocaleTimeString('id-ID'),
        type: `${reason} ${trade.type} (${(pct * 100).toFixed(2)}%)`,
        open: trade.entryPrice.toFixed(2),
        close: currentPrice.toFixed(2),
        pnl: netPnl,
        balanceAfter: virtualBalance + closedPnl
      });
    } else remaining.push(trade);
  }

  activeTrades = remaining;
  if (anyClosed) {
    virtualBalance += closedPnl;
    setCloseEvent(closedPnl, 'SL/TP');
  }
  return { closed: anyClosed, pnl: closedPnl };
}

// ================== GEMINI CALL ==================
async function callGeminiWithRetry(systemPrompt) {
  let lastError = null;
  for (const modelName of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: systemPrompt,
          config: { responseMimeType: 'application/json' }
        });
        if (response.text) {
          const cleaned = response.text.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed.action === 'string') {
            return { ok: true, decision: parsed, model: modelName, attempts: attempt };
          }
        }
        lastError = new Error('Respons tidak valid');
      } catch (e) {
        lastError = e;
        const msg = e.message || '';
        const isRetryable = msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('high demand') || msg.includes('overloaded');
        console.warn(`[Gemini][${modelName}][attempt ${attempt}] ${msg.slice(0, 120)}`);
        if (!isRetryable) break;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  }
  return { ok: false, error: lastError };
}

// ================== FALLBACK ==================
function fallbackDecision(currentPrice, rsiValue, macdText, rsiText) {
  const decision = { action: 'HOLD', reasoning: '', confidence: 0 };
  if (activeTrades.length > 0) {
    const avgEntry = activeTrades.reduce((s, t) => s + t.entryPrice, 0) / activeTrades.length;
    const isBuy = activeTrades[0].type === 'BUY';
    const diff = isBuy ? (currentPrice - avgEntry) : (avgEntry - currentPrice);
    const pct = diff / avgEntry;

    if (pct >= FALLBACK_PROFIT_CLOSE_PCT) {
      decision.action = 'CLOSE';
      decision.reasoning = `Fallback: auto-close profit +${(pct * 100).toFixed(2)}%`;
    } else if (pct <= FALLBACK_LOSS_CLOSE_PCT) {
      decision.action = 'CLOSE';
      decision.reasoning = `Fallback: auto-close SL ${(pct * 100).toFixed(2)}%`;
    } else {
      decision.action = 'HOLD';
      decision.reasoning = `Fallback HOLD. Posisi ${(pct * 100).toFixed(2)}% (RSI=${rsiText})`;
    }
  } else {
    if (rsiValue !== null && rsiValue < 45) { decision.action = 'BUY'; decision.reasoning = `Fallback BUY. RSI=${rsiText}, ${macdText}`; }
    else if (rsiValue !== null && rsiValue > 55) { decision.action = 'SELL'; decision.reasoning = `Fallback SELL. RSI=${rsiText}, ${macdText}`; }
    else { decision.action = 'HOLD'; decision.reasoning = `Fallback HOLD. RSI=${rsiText}, ${macdText}`; }
  }
  return decision;
}

// ================== MAIN LOOP ==================
async function runAutonomousAgent() {
  if (isExecutingCycle) return;
  isExecutingCycle = true;
  cycleCount++;

  try {
    let currentPrice;
    try {
      currentPrice = await fetchPrice();
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      console.warn(`[Price] Gagal (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err.message}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        isBotRunning = false;
        if (botInterval) { clearInterval(botInterval); botInterval = null; }
      }
      return;
    }

    priceHistory.push(currentPrice);
    if (priceHistory.length > MAX_PRICE_HISTORY) priceHistory.shift();

    await checkStopLossTakeProfit(currentPrice);

    const rsiValue = calculateRSI(priceHistory, RSI_PERIOD);
    const ema20Value = calculateEMA(priceHistory, 20);
    const macdData = calculateMACDSeries(priceHistory);
    const emaTrend = currentPrice >= ema20Value ? 'UPTREND (Bullish)' : 'DOWNTREND (Bearish)';
    const rsiText = rsiValue === null ? 'Belum cukup data' : rsiValue.toFixed(2);
    const macdText = macdData ? macdData.status : 'Belum cukup data';

    const { tradeAmount, calculatedLot } = calculateDynamicRisk(virtualBalance, currentPrice);
    const totalCurrentPnl = computeUnrealizedPnl(currentPrice);

    const systemPrompt = `
Kamu adalah "Orion", Autonomous AI Trading Agent AGRESIF untuk Bitcoin (${DISPLAY}).
Target: maksimalkan frekuensi entry untuk scalping cepat.

DATA PASAR & POSISI:
- Harga: $${currentPrice.toFixed(2)}
- RSI (14): ${rsiText}
- EMA (20): $${ema20Value.toFixed(2)} (${emaTrend})
- MACD: ${macdText}
- Saldo: $${virtualBalance.toFixed(2)}
- Posisi aktif: ${activeTrades.length} dari ${MAX_ACTIVE_TRADES}
- Unrealized PnL: $${totalCurrentPnl.toFixed(2)}

ATURAN AGRESIF:
1. Jika ada posisi aktif:
   - "CLOSE" SEGERA jika profit ≥ +1.5% atau loss ≤ −1%.
   - "HOLD" hanya jika tren sangat kuat searah posisi.
2. Jika TIDAK ada posisi — PRIORITASKAN ENTRY:
   - "BUY" jika RSI < 55 ATAU MACD histogram positif ATAU harga > EMA20.
   - "SELL" jika RSI > 45 ATAU MACD histogram negatif ATAU harga < EMA20.
   - "HOLD" HANYA jika sinyal benar-benar saling bertentangan.
3. Agresif tapi disiplin: setiap entry harus punya alasan teknikal jelas.

Balas HANYA JSON MURNI:
{
  "action": "BUY" | "SELL" | "HOLD" | "CLOSE",
  "confidence": 0.85,
  "reasoning": "maks 2 kalimat"
}
`;

    let agentDecision = { action: 'HOLD', reasoning: 'Menunggu sinyal...', confidence: 0 };
    const geminiResult = await callGeminiWithRetry(systemPrompt);

    if (geminiResult.ok) {
      agentDecision = geminiResult.decision;
      lastGeminiStatus = 'ok';
    } else {
      console.warn('[Gemini] Semua model & retry gagal, pakai fallback.');
      agentDecision = fallbackDecision(currentPrice, rsiValue, macdText, rsiText);
      lastGeminiStatus = 'fallback';
    }

    // Eksekusi CLOSE
    if (agentDecision.action === 'CLOSE' && activeTrades.length > 0) {
      let closedCount = 0;
      let closeTotalPnl = 0;
      const closedTrades = [];
      for (const trade of [...activeTrades]) {
        const result = await executeBrokerClose(trade.positionId);
        if (!result.ok) { console.error(`[Close] Gagal ${trade.positionId}: ${result.error}`); continue; }
        const { netPnl } = computeNetPnl(trade, currentPrice);
        closeTotalPnl += netPnl;
        closedTrades.push(trade);
        closedCount++;
      }

      if (closedCount > 0) {
        virtualBalance += closeTotalPnl;
        activeTrades = activeTrades.filter(t => !closedTrades.includes(t));
        tradeHistory.unshift({
          time: new Date().toLocaleTimeString('id-ID'),
          type: `GEMINI CLOSE ${closedCount}x (${closeTotalPnl >= 0 ? 'PROFIT' : 'LOSS'})`,
          open: closedTrades[0].entryPrice.toFixed(2),
          close: currentPrice.toFixed(2),
          pnl: closeTotalPnl,
          balanceAfter: virtualBalance
        });
        updateMarketMemory({
          price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
          decision: 'CLOSE', reasoning: agentDecision.reasoning, pnl: closeTotalPnl
        });
        // 🔥 Trigger emosi robot
        setCloseEvent(closeTotalPnl, 'GEMINI');
      }
    } else if ((agentDecision.action === 'BUY' || agentDecision.action === 'SELL') && activeTrades.length === 0) {
      const totalExposure = tradeAmount * MAX_ACTIVE_TRADES;
      if (virtualBalance >= totalExposure) {
        const openedTrades = [];
        for (let i = 0; i < MAX_ACTIVE_TRADES; i++) {
          const entryPrice = applySlippage(currentPrice, agentDecision.action);
          const result = await executeBrokerOpen(agentDecision.action, entryPrice, calculatedLot);
          if (!result.ok) { console.error(`[Open] Gagal: ${result.error}`); continue; }
          virtualBalance -= tradeAmount * TAKER_FEE;
          openedTrades.push({
            id: Date.now() + i,
            positionId: result.positionId,
            type: agentDecision.action,
            notional: tradeAmount,
            lot: calculatedLot,
            entryPrice,
            entryTs: Date.now()
          });
        }
        activeTrades.push(...openedTrades);
        if (openedTrades.length > 0) {
          tradeHistory.unshift({
            time: new Date().toLocaleTimeString('id-ID'),
            type: `OPEN ${openedTrades.length}x ${agentDecision.action} (${DISPLAY})`,
            open: openedTrades[0].entryPrice.toFixed(2),
            close: '-', pnl: 0, balanceAfter: virtualBalance
          });
          updateMarketMemory({
            price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
            decision: agentDecision.action, reasoning: agentDecision.reasoning, pnl: 0
          });
        }
      } else {
        updateMarketMemory({
          price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
          decision: 'HOLD', reasoning: 'Saldo tidak cukup.', pnl: totalCurrentPnl
        });
      }
    } else {
      updateMarketMemory({
        price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
        decision: 'HOLD', reasoning: agentDecision.reasoning, pnl: totalCurrentPnl
      });
    }

    if (tradeHistory.length > MAX_TRADE_HISTORY) tradeHistory.pop();

    serverLogs = {
      symbol: DISPLAY,
      price: currentPrice.toFixed(2),
      analysis: `[Orion] ${agentDecision.reasoning}`,
      decision: agentDecision.action,
      confidence: agentDecision.confidence ?? null,
      geminiStatus: lastGeminiStatus,
      balance: virtualBalance,
      dynamicLot: calculatedLot,
      tradeAllocation: tradeAmount,
      activeTradesCount: activeTrades.length,
      activeTrades,
      totalCurrentPnl,
      lastCloseEvent,   // <-- dikirim ke frontend
      indicators: {
        rsi: rsiValue === null ? null : parseFloat(rsiValue.toFixed(2)),
        ema20: ema20Value.toFixed(2),
        macd: macdData ? { macd: macdData.macd.toFixed(2), signal: macdData.signal.toFixed(2), histogram: macdData.histogram.toFixed(2) } : null,
        macdStatus: macdText,
        trend: emaTrend
      },
      tradeHistory,
      marketMemory,
      cycleCount,
      timestamp: new Date().toLocaleTimeString('id-ID')
    };
  } catch (error) {
    console.error('[Loop Error]:', error);
  } finally {
    isExecutingCycle = false;
  }
}

// ================== ROUTES ==================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/start-bot', requireAuth, async (req, res) => {
  if (!isBotRunning) {
    isBotRunning = true;
    consecutiveFailures = 0;
    await runAutonomousAgent();
    if (botInterval) clearInterval(botInterval);
    botInterval = setInterval(runAutonomousAgent, LOOP_INTERVAL_MS);
  }
  res.json({ success: true, message: 'Orion BTC aktif.' });
});

app.get('/api/stop-bot', requireAuth, (req, res) => {
  isBotRunning = false;
  if (botInterval) { clearInterval(botInterval); botInterval = null; }
  res.json({ success: true, message: 'Orion BTC dihentikan.' });
});

app.get('/api/force-close', requireAuth, async (req, res) => {
  if (activeTrades.length === 0) return res.json({ success: false, message: 'Tidak ada posisi aktif.' });
  try {
    const currentPrice = await fetchPrice();
    let totalPnl = 0, closedCount = 0;
    const closedTrades = [];
    for (const trade of [...activeTrades]) {
      const result = await executeBrokerClose(trade.positionId);
      if (!result.ok) { console.error(`[ForceClose] Gagal ${trade.positionId}: ${result.error}`); continue; }
      const { netPnl } = computeNetPnl(trade, currentPrice);
      totalPnl += netPnl;
      closedTrades.push(trade);
      closedCount++;
    }
    if (closedCount > 0) {
      virtualBalance += totalPnl;
      activeTrades = activeTrades.filter(t => !closedTrades.includes(t));
      tradeHistory.unshift({
        time: new Date().toLocaleTimeString('id-ID'),
        type: `MANUAL CLOSE ${closedCount}x (${totalPnl >= 0 ? 'PROFIT' : 'LOSS'})`,
        open: closedTrades[0].entryPrice.toFixed(2),
        close: currentPrice.toFixed(2),
        pnl: totalPnl, balanceAfter: virtualBalance
      });
      setCloseEvent(totalPnl, 'MANUAL');
    }
    res.json({ success: true, message: `${closedCount} posisi ditutup. PnL: $${totalPnl.toFixed(2)}`, closedCount, totalPnl });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/bot-status', (req, res) => {
  res.json({
    running: isBotRunning,
    data: serverLogs,
    state: {
      virtualBalance,
      activeTradesCount: activeTrades.length,
      isExecutingCycle,
      consecutiveFailures,
      geminiStatus: lastGeminiStatus
    }
  });
});

process.on('SIGINT', () => {
  console.log('\n[Shutdown] Menghentikan bot BTC...');
  isBotRunning = false;
  if (botInterval) clearInterval(botInterval);
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Orion BTC Agent berjalan di port ${port}`);
  console.log(`Live broker: ${ENABLE_LIVE_BROKER ? 'AKTIF ⚠️' : 'simulasi'}`);
  console.log(`Gemini models: ${GEMINI_MODELS.join(' → ')}`);
  if (!CONTROL_API_KEY) console.warn('[WARN] CONTROL_API_KEY tidak diset — endpoint kontrol terbuka!');
});
