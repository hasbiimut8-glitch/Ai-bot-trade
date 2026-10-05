import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// ================== CONFIG ==================
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error("FATAL: GROQ_API_KEY tidak diset.");
  process.exit(1);
}

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';

const SYMBOL = 'BTCUSDT';
const ETH_SYMBOL = 'ETHUSDT';
const DISPLAY = 'BTC/USDT';

// 🔥 Model Groq VALID per Okt 2026 — llama-3.3-70b-versatile sudah deprecated
const GROQ_MODELS_PRIMARY = [
  'openai/gpt-oss-120b',
];
const GROQ_MODELS_FALLBACK = [
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
];

const ENABLE_LIVE_BROKER = process.env.ENABLE_LIVE_BROKER === 'true';
const META_API_TOKEN = process.env.META_API_TOKEN || '';
const META_ACCOUNT_ID = process.env.META_ACCOUNT_ID || '';
const META_API_BASE = process.env.META_API_BASE || 'https://mt-client-api-v1.agiliumtrade.ai';
const CONTROL_API_KEY = process.env.CONTROL_API_KEY || '';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_ENABLED = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID;

if (ENABLE_LIVE_BROKER && (!META_API_TOKEN || !META_ACCOUNT_ID)) {
  console.error("FATAL: ENABLE_LIVE_BROKER=true tapi token/kredensial kosong.");
  process.exit(1);
}

// ================== STRATEGI ==================
const LOOP_INTERVAL_MS = 600000;   // 10 menit

const MAX_ACTIVE_TRADES = 4;
const MAX_PRICE_HISTORY = 100;
const MAX_MARKET_MEMORY = 10;
const MAX_TRADE_HISTORY = 30;

const RISK_PER_TRADE = 0.02;
const TAKER_FEE = 0.0004;
const SLIPPAGE = 0.0002;

let dynamicParams = {
  atrSlMult: 1.5,
  atrTpMult: 2.5,
  minAlignment: 70,
  minConfidence: 0.65,
  kellyFraction: 0.25
};

const FALLBACK_SL_PCT = -0.010;
const FALLBACK_TP_PCT = 0.015;
const HARD_TP_CAP_PCT = 0.04;

const CHANDELIER_ATR_MULT = 2.0;
const CHANDELIER_ACTIVATION_PCT = 0.008;

const FALLBACK_PROFIT_CLOSE_PCT = 0.010;
const FALLBACK_LOSS_CLOSE_PCT = -0.010;

const MAX_CUMULATIVE_FEE_PCT = 0.03;
const DAILY_LOSS_LIMIT_PCT = 0.05;
const MAX_CONSECUTIVE_LOSSES_BEFORE_COOLDOWN = 2;

const KELLY_MIN_TRADES = 10;
const KELLY_MIN_SIZE = 0.005;
const KELLY_MAX_SIZE = 0.03;

const CONFIDENCE_HIGH = 0.75;
const CONFIDENCE_LOW = 0.4;

const RSI_PERIOD = 14;
const BB_PERIOD = 20;
const BB_STDDEV = 2;
const EMA_FAST = 12;
const EMA_SLOW = 26;
const EMA_SIGNAL = 9;
const ATR_PERIOD = 14;
const MAX_CONSECUTIVE_FAILURES = 5;

const SCALE_IN_STEPS = 2;
const SCALE_IN_DELAY_MS = 2000;

const HIGH_IMPACT_EVENTS = [];

// ================== QUOTA MANAGEMENT ==================
let geminiCache = {
  decision: null, price: 0, regime: '',
  rsiBand: '', alignmentBand: '', timestamp: 0
};
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_PRICE_THRESHOLD = 0.003;

let quotaCooldown = { active: false, until: 0, hits: 0 };
const COOLDOWN_AFTER_429_MS = 30 * 60 * 1000;
const COOLDOWN_AFTER_429_HITS_2_MS = 60 * 60 * 1000;
const COOLDOWN_AFTER_429_HITS_3_MS = 3 * 60 * 60 * 1000;

let dailyGeminiRequests = 0;
let dailyGeminiRequestsDate = new Date().toDateString();
const DAILY_REQUEST_LIMIT = 1200;
const MAX_REQUESTS_PER_HOUR = 60;
let hourlyRequests = [];

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
let lastCloseEvent = null;
let cumulativeFee = 0;
let cumulativeTrades = 0;
let geminiSuccessCount = 0;
let geminiFailCount = 0;
let geminiSkipCount = 0;

let consecutiveLosses = 0;
let consecutiveWins = 0;
let peakBalance = 10000;
let maxDrawdown = 0;
let allPnls = [];

let dailyStartBalance = 10000;
let dailyStartDate = new Date().toDateString();
let dailyPnl = 0;
let dailyTrades = 0;

let ensembleStats = {
  trend_follower: { wins: 0, losses: 0 },
  mean_reverter: { wins: 0, losses: 0 },
  momentum: { wins: 0, losses: 0 },
  breakout: { wins: 0, losses: 0 },
  order_flow: { wins: 0, losses: 0 }
};

let confidenceCalibration = {
  low: { wins: 0, losses: 0 },
  mid: { wins: 0, losses: 0 },
  high: { wins: 0, losses: 0 }
};

let patternStats = {
  bySignature: {},
  bySession: { ASIA: { wins: 0, losses: 0 }, LONDON: { wins: 0, losses: 0 }, NY: { wins: 0, losses: 0 } },
  byRegime: {}
};

let lastBacktest = null;

let marketContext = {
  atr: null, atrPct: null,
  htfTrend: 'unknown', htfChangePct: 0, htf1hTrend: 'unknown',
  volumeRatio: null,
  bbUpper: null, bbLower: null, bbMiddle: null, bbWidth: null, bbPosition: null,
  support: null, resistance: null,
  regime: 'unknown',
  fundingRate: null, openInterest: null, oiChangePct: null,
  fearGreed: null, fearGreedLabel: 'N/A',
  rsiDivergence: 'none', candlePattern: 'none',
  orderBookImbalance: null, orderBookBidWall: null, orderBookAskWall: null,
  cvd1m: null, cvdTrend: 'unknown',
  alignmentScore: null, alignmentDetails: {}, dominantDirection: 'NEUTRAL',
  session: 'unknown',
  nearestLongLiq: null, nearestShortLiq: null,
  ethTrend: 'unknown', correlation: null,
  eventRiskLevel: 'LOW', nextEventName: null,
  featureScore: 0
};

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
  let avgGain = gains / period, avgLoss = losses / period;
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

function calculateRSISeries(prices, period = 14) {
  if (prices.length < period + 1) return [];
  const rsis = [];
  for (let i = period; i < prices.length; i++) rsis.push(calculateRSI(prices.slice(0, i + 1), period));
  return rsis;
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
  if (macd > 0 && histogram > 0) status = 'GOLDEN CROSS (Bullish)';
  else if (macd < 0 && histogram < 0) status = 'DEATH CROSS (Bearish)';
  return { macd, signal, histogram, status };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

function calculateBollingerBands(prices, period = 20, mult = 2) {
  if (!prices || prices.length < period) return null;
  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, p) => s + Math.pow(p - sma, 2), 0) / period;
  const stddev = Math.sqrt(variance);
  return { upper: sma + mult * stddev, middle: sma, lower: sma - mult * stddev, width: (2 * mult * stddev) / sma };
}

function findSupportResistance(highs, lows, lookback = 50) {
  if (!highs || highs.length < 10) return { support: null, resistance: null };
  return { support: Math.min(...lows.slice(-lookback)), resistance: Math.max(...highs.slice(-lookback)) };
}

function detectMarketRegime(prices, atr) {
  if (prices.length < 30 || !atr) return 'unknown';
  const recent = prices.slice(-20);
  const older = prices.slice(-40, -20);
  if (older.length < 10) return 'unknown';
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const changePct = (recentAvg - olderAvg) / olderAvg;
  if (Math.abs(changePct) > 0.005) return changePct > 0 ? 'TRENDING_UP' : 'TRENDING_DOWN';
  return 'RANGING';
}

function detectRSIDivergence(prices, rsiSeries, lookback = 20) {
  if (prices.length < lookback + 5 || rsiSeries.length < lookback) return 'none';
  const priceSlice = prices.slice(-lookback);
  const rsiSlice = rsiSeries.slice(-lookback);
  const half = Math.floor(lookback / 2);
  const pRMin = Math.min(...priceSlice.slice(half)), pOMin = Math.min(...priceSlice.slice(0, half));
  const rRMin = Math.min(...rsiSlice.slice(half)), rOMin = Math.min(...rsiSlice.slice(0, half));
  const pRMax = Math.max(...priceSlice.slice(half)), pOMax = Math.max(...priceSlice.slice(0, half));
  const rRMax = Math.max(...rsiSlice.slice(half)), rOMax = Math.max(...rsiSlice.slice(0, half));
  if (pRMin < pOMin && rRMin > rOMin + 2) return 'bullish';
  if (pRMax > pOMax && rRMax < rOMax - 2) return 'bearish';
  return 'none';
}

function detectCandlePattern(klines) {
  if (!klines || klines.length < 3) return 'none';
  const c1 = klines[klines.length - 2], c2 = klines[klines.length - 1];
  const body = (k) => Math.abs(k.close - k.open);
  const range = (k) => k.high - k.low;
  const c2Body = body(c2), c2Range = range(c2);
  if (c2Range === 0) return 'none';
  const c2Upper = c2.high - Math.max(c2.open, c2.close);
  const c2Lower = Math.min(c2.open, c2.close) - c2.low;
  const bodyRatio = c2Body / c2Range;
  if (bodyRatio < 0.1) return 'doji';
  if (c2Lower > 2 * c2Body && c2Upper < c2Body * 0.5) return 'hammer';
  if (c2Upper > 2 * c2Body && c2Lower < c2Body * 0.5) return 'shooting_star';
  if (c1.close < c1.open && c2.close > c2.open && c2Body > body(c1) && c2.close > c1.open && c2.open < c1.close) return 'bullish_engulf';
  if (c1.close > c1.open && c2.close < c2.open && c2Body > body(c1) && c2.close < c1.open && c2.open > c1.close) return 'bearish_engulf';
  return 'none';
}

async function fetchOrderBook(limit = 100) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/depth?symbol=${SYMBOL}&limit=${limit}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      bids: d.bids.map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) })),
      asks: d.asks.map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }))
    };
  } catch { return null; }
}

function analyzeOrderBook(ob) {
  if (!ob) return null;
  const totalBidQty = ob.bids.reduce((s, b) => s + b.qty, 0);
  const totalAskQty = ob.asks.reduce((s, a) => s + a.qty, 0);
  const total = totalBidQty + totalAskQty;
  const imbalance = total > 0 ? (totalBidQty - totalAskQty) / total : 0;
  const topBids = [...ob.bids].sort((a, b) => b.qty - a.qty).slice(0, 3);
  const topAsks = [...ob.asks].sort((a, b) => b.qty - a.qty).slice(0, 3);
  return {
    imbalance: parseFloat(imbalance.toFixed(3)),
    bidWall: topBids[0] ? parseFloat(topBids[0].price.toFixed(2)) : null,
    askWall: topAsks[0] ? parseFloat(topAsks[0].price.toFixed(2)) : null
  };
}

function calculateCVD(klines) {
  if (!klines || klines.length < 10) return null;
  let cvd = 0;
  const series = [];
  for (const k of klines) {
    const range = k.high - k.low;
    let buyVol = 0, sellVol = 0;
    if (range > 0) {
      const closePos = (k.close - k.low) / range;
      buyVol = k.volume * closePos;
      sellVol = k.volume * (1 - closePos);
    }
    cvd += buyVol - sellVol;
    series.push(cvd);
  }
  const recent = series.slice(-10);
  const delta = recent[recent.length - 1] - recent[0];
  let trend = 'neutral';
  if (delta > 0 && Math.abs(delta) > Math.abs(cvd) * 0.05) trend = 'buying';
  else if (delta < 0 && Math.abs(delta) > Math.abs(cvd) * 0.05) trend = 'selling';
  return { cvd: parseFloat(cvd.toFixed(2)), trend };
}

function calculateAlignmentScore(tfs) {
  const weights = { '1m': 10, '5m': 15, '15m': 25, '1h': 30, '4h': 20 };
  let bullScore = 0, bearScore = 0, totalWeight = 0;
  const details = {};
  for (const [tf, data] of Object.entries(tfs)) {
    const w = weights[tf] || 10;
    totalWeight += w;
    let dir = 'neutral';
    if (data.trend === 'UP') { bullScore += w; dir = 'bull'; }
    else if (data.trend === 'DOWN') { bearScore += w; dir = 'bear'; }
    details[tf] = { trend: data.trend, direction: dir, weight: w, rsi: data.rsi != null ? parseFloat(data.rsi.toFixed(1)) : null };
  }
  const bullPct = totalWeight > 0 ? (bullScore / totalWeight) * 100 : 0;
  const bearPct = totalWeight > 0 ? (bearScore / totalWeight) * 100 : 0;
  return {
    bullAlignment: parseFloat(bullPct.toFixed(0)),
    bearAlignment: parseFloat(bearPct.toFixed(0)),
    maxAlignment: parseFloat(Math.max(bullPct, bearPct).toFixed(0)),
    dominantDirection: bullPct > bearPct ? 'BULL' : bearPct > bullPct ? 'BEAR' : 'NEUTRAL',
    details
  };
}

function detectSession() {
  const hour = new Date().getUTCHours();
  if (hour >= 13 && hour < 16) return 'LONDON_NY_OVERLAP';
  if (hour >= 7 && hour < 13) return 'LONDON';
  if (hour >= 16 && hour < 22) return 'NY';
  if (hour >= 0 && hour < 7) return 'ASIA';
  return 'OFF_HOURS';
}

function getSessionParams(session) {
  switch (session) {
    case 'LONDON_NY_OVERLAP': return { riskMult: 1.2, minConfidence: 0.6, allowTrade: true };
    case 'LONDON':
    case 'NY': return { riskMult: 1.0, minConfidence: 0.65, allowTrade: true };
    case 'ASIA': return { riskMult: 0.7, minConfidence: 0.75, allowTrade: true };
    default: return { riskMult: 0.5, minConfidence: 0.85, allowTrade: false };
  }
}

function detectLiquidationZones(klines) {
  if (!klines || klines.length < 20) return { zones: [], nearestLong: null, nearestShort: null };
  const zones = [];
  const recent = klines.slice(-30);
  for (let i = 0; i < recent.length - 1; i++) {
    const k = recent[i];
    const range = k.high - k.low;
    if (range === 0) continue;
    const upperWick = k.high - Math.max(k.open, k.close);
    const lowerWick = Math.min(k.open, k.close) - k.low;
    const body = Math.abs(k.close - k.open);
    if (upperWick > body * 2 && upperWick / range > 0.6) zones.push({ price: k.high, type: 'SHORT_LIQ', strength: parseFloat((upperWick / range).toFixed(2)) });
    if (lowerWick > body * 2 && lowerWick / range > 0.6) zones.push({ price: k.low, type: 'LONG_LIQ', strength: parseFloat((lowerWick / range).toFixed(2)) });
  }
  const currentPrice = klines[klines.length - 1].close;
  const longLiqs = zones.filter(z => z.type === 'LONG_LIQ' && z.price < currentPrice).sort((a, b) => b.price - a.price);
  const shortLiqs = zones.filter(z => z.type === 'SHORT_LIQ' && z.price > currentPrice).sort((a, b) => a.price - b.price);
  return { zones: zones.slice(-10), nearestLong: longLiqs[0]?.price ?? null, nearestShort: shortLiqs[0]?.price ?? null };
}

function trendFollowerSignal(ctx) {
  let score = 0;
  if (ctx.htf1hTrend === 'UP') score += 2;
  if (ctx.htf1hTrend === 'DOWN') score -= 2;
  if (ctx.htfTrend === 'UP') score += 1;
  if (ctx.htfTrend === 'DOWN') score -= 1;
  if (ctx.emaTrend === 'UPTREND') score += 1;
  if (ctx.emaTrend === 'DOWNTREND') score -= 1;
  if (ctx.regime === 'TRENDING_UP') score += 1;
  if (ctx.regime === 'TRENDING_DOWN') score -= 1;
  if (score >= 3) return { signal: 'BUY', strength: score / 6 };
  if (score <= -3) return { signal: 'SELL', strength: Math.abs(score) / 6 };
  return { signal: 'HOLD', strength: 0 };
}

function meanReverterSignal(ctx) {
  let score = 0;
  if (ctx.rsi < 35) score += 2;
  else if (ctx.rsi < 45) score += 1;
  if (ctx.rsi > 65) score -= 2;
  else if (ctx.rsi > 55) score -= 1;
  if (ctx.bbPosition != null) {
    if (ctx.bbPosition < 0.15) score += 2;
    else if (ctx.bbPosition < 0.3) score += 1;
    if (ctx.bbPosition > 0.85) score -= 2;
    else if (ctx.bbPosition > 0.7) score -= 1;
  }
  if (ctx.regime !== 'RANGING') score *= 0.5;
  if (score >= 3) return { signal: 'BUY', strength: score / 4 };
  if (score <= -3) return { signal: 'SELL', strength: Math.abs(score) / 4 };
  return { signal: 'HOLD', strength: 0 };
}

function momentumSignal(ctx) {
  let score = 0;
  if (ctx.macdStatus?.includes('GOLDEN')) score += 2;
  if (ctx.macdStatus?.includes('DEATH')) score -= 2;
  if (ctx.rsi > 55 && ctx.rsi < 70) score += 1;
  if (ctx.rsi < 45 && ctx.rsi > 30) score -= 1;
  if (ctx.cvdTrend === 'buying') score += 1;
  if (ctx.cvdTrend === 'selling') score -= 1;
  if (score >= 3) return { signal: 'BUY', strength: score / 5 };
  if (score <= -3) return { signal: 'SELL', strength: Math.abs(score) / 5 };
  return { signal: 'HOLD', strength: 0 };
}

function breakoutSignal(ctx, currentPrice) {
  let score = 0;
  const nearResistance = ctx.resistance && Math.abs(currentPrice - ctx.resistance) / ctx.resistance < 0.005;
  const nearSupport = ctx.support && Math.abs(currentPrice - ctx.support) / ctx.support < 0.005;
  const volumeHigh = ctx.volumeRatio > 1.5;
  if (nearResistance && volumeHigh) score += 2;
  if (nearSupport && volumeHigh) score -= 2;
  if (ctx.orderBookImbalance > 0.2) score += 1;
  if (ctx.orderBookImbalance < -0.2) score -= 1;
  if (score >= 2) return { signal: 'BUY', strength: score / 3 };
  if (score <= -2) return { signal: 'SELL', strength: Math.abs(score) / 3 };
  return { signal: 'HOLD', strength: 0 };
}

function orderFlowSignal(ctx) {
  let score = 0;
  if (ctx.cvdTrend === 'buying') score += 2;
  if (ctx.cvdTrend === 'selling') score -= 2;
  if (ctx.orderBookImbalance > 0.15) score += 1.5;
  if (ctx.orderBookImbalance < -0.15) score -= 1.5;
  if (ctx.oiChangePct > 0.02 && ctx.htfTrend === 'UP') score += 0.5;
  if (ctx.oiChangePct > 0.02 && ctx.htfTrend === 'DOWN') score -= 0.5;
  if (score >= 3) return { signal: 'BUY', strength: score / 4 };
  if (score <= -3) return { signal: 'SELL', strength: Math.abs(score) / 4 };
  return { signal: 'HOLD', strength: 0 };
}

function runEnsemble(ctx, currentPrice) {
  const signals = {
    trend_follower: trendFollowerSignal(ctx),
    mean_reverter: meanReverterSignal(ctx),
    momentum: momentumSignal(ctx),
    breakout: breakoutSignal(ctx, currentPrice),
    order_flow: orderFlowSignal(ctx)
  };
  const weights = { trend_follower: 1.3, mean_reverter: 0.9, momentum: 1.1, breakout: 1.0, order_flow: 1.2 };
  let buyScore = 0, sellScore = 0, totalWeight = 0;
  for (const [name, sig] of Object.entries(signals)) {
    const w = weights[name];
    totalWeight += w;
    if (sig.signal === 'BUY') buyScore += w * sig.strength;
    if (sig.signal === 'SELL') sellScore += w * sig.strength;
  }
  const buyPct = totalWeight > 0 ? (buyScore / totalWeight) * 100 : 0;
  const sellPct = totalWeight > 0 ? (sellScore / totalWeight) * 100 : 0;
  let consensus = 'HOLD';
  if (buyPct > 40 && buyPct > sellPct * 1.5) consensus = 'BUY';
  else if (sellPct > 40 && sellPct > buyPct * 1.5) consensus = 'SELL';
  return {
    consensus,
    buyPct: parseFloat(buyPct.toFixed(1)),
    sellPct: parseFloat(sellPct.toFixed(1)),
    signals,
    strength: consensus === 'BUY' ? buyPct : consensus === 'SELL' ? sellPct : 0
  };
}

function computeFeatureScore(ctx, ensemble) {
  const features = {
    alignment: (ctx.alignmentScore || 0) / 100,
    ensembleBuy: ensemble.buyPct / 100,
    ensembleSell: ensemble.sellPct / 100,
    rsiPosition: ctx.rsi != null ? 1 - Math.abs(ctx.rsi - 50) / 50 : 0.5,
    bbPosition: ctx.bbPosition != null ? 1 - Math.abs(ctx.bbPosition - 0.5) * 2 : 0.5,
    volume: Math.min(1, (ctx.volumeRatio || 1) / 2),
    orderBook: ctx.orderBookImbalance != null ? (ctx.orderBookImbalance + 1) / 2 : 0.5,
    cvd: ctx.cvdTrend === 'buying' ? 1 : ctx.cvdTrend === 'selling' ? 0 : 0.5,
    sessionBonus: ctx.session === 'LONDON_NY_OVERLAP' ? 1 : ctx.session === 'LONDON' || ctx.session === 'NY' ? 0.7 : ctx.session === 'ASIA' ? 0.4 : 0,
    regimeBonus: ctx.regime === 'TRENDING_UP' || ctx.regime === 'TRENDING_DOWN' ? 0.9 : 0.6
  };
  const weights = { alignment: 2.5, ensembleBuy: 2.0, rsiPosition: 1.0, bbPosition: 1.0, volume: 0.8, orderBook: 1.2, cvd: 1.3, sessionBonus: 0.7, regimeBonus: 0.8 };
  let maxScore = 0;
  for (const w of Object.values(weights)) maxScore += w;

  const buyFeatureScore = (features.alignment * 2.5 + features.ensembleBuy * 2.0 + features.rsiPosition * 1.0 +
    features.bbPosition * 1.0 + features.volume * 0.8 + features.orderBook * 1.2 +
    features.cvd * 1.3 + features.sessionBonus * 0.7 + features.regimeBonus * 0.8) / maxScore * 100;

  const sellFeatureScore = (features.alignment * 2.5 + features.ensembleSell * 2.0 + features.rsiPosition * 1.0 +
    features.bbPosition * 1.0 + features.volume * 0.8 + (1 - features.orderBook) * 1.2 +
    (1 - features.cvd) * 1.3 + features.sessionBonus * 0.7 + features.regimeBonus * 0.8) / maxScore * 100;

  return {
    buyScore: parseFloat(buyFeatureScore.toFixed(1)),
    sellScore: parseFloat(sellFeatureScore.toFixed(1)),
    features
  };
}

function checkEventRisk() {
  const today = new Date().toISOString().split('T')[0];
  if (HIGH_IMPACT_EVENTS.includes(today)) return { level: 'HIGH', name: 'High-impact event today', date: today };
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (HIGH_IMPACT_EVENTS.includes(tomorrow)) return { level: 'MEDIUM', name: 'Event besok', date: tomorrow };
  if (HIGH_IMPACT_EVENTS.includes(yesterday)) return { level: 'MEDIUM', name: 'Event kemarin', date: yesterday };
  return { level: 'LOW', name: null, date: null };
}

function calculateCorrelation(prices1, prices2) {
  if (!prices1 || !prices2 || prices1.length < 10 || prices2.length < 10) return null;
  const n = Math.min(prices1.length, prices2.length, 30);
  const p1 = prices1.slice(-n);
  const p2 = prices2.slice(-n);
  const returns1 = [], returns2 = [];
  for (let i = 1; i < n; i++) {
    returns1.push((p1[i] - p1[i - 1]) / p1[i - 1]);
    returns2.push((p2[i] - p2[i - 1]) / p2[i - 1]);
  }
  const mean1 = returns1.reduce((a, b) => a + b, 0) / returns1.length;
  const mean2 = returns2.reduce((a, b) => a + b, 0) / returns2.length;
  let cov = 0, var1 = 0, var2 = 0;
  for (let i = 0; i < returns1.length; i++) {
    cov += (returns1[i] - mean1) * (returns2[i] - mean2);
    var1 += Math.pow(returns1[i] - mean1, 2);
    var2 += Math.pow(returns2[i] - mean2, 2);
  }
  if (var1 === 0 || var2 === 0) return 0;
  return cov / Math.sqrt(var1 * var2);
}

function calculateKellySize(balance) {
  if (allPnls.length < KELLY_MIN_TRADES) return { size: RISK_PER_TRADE, reason: `Kurang data (${allPnls.length}/${KELLY_MIN_TRADES})` };
  const wins = allPnls.filter(p => p > 0);
  const losses = allPnls.filter(p => p <= 0);
  if (wins.length === 0 || losses.length === 0) return { size: RISK_PER_TRADE, reason: 'Imbalance' };
  const winRate = wins.length / allPnls.length;
  const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);
  const payoffRatio = avgWin / avgLoss;
  const kelly = winRate - (1 - winRate) / payoffRatio;
  let size = kelly * dynamicParams.kellyFraction;
  size = Math.max(KELLY_MIN_SIZE, Math.min(KELLY_MAX_SIZE, size));
  return { size, reason: `Kelly ${(kelly * 100).toFixed(2)}% × ${dynamicParams.kellyFraction}` };
}

function adjustSizeByRecentPerformance(baseAmount) {
  if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES_BEFORE_COOLDOWN) return { amount: baseAmount * 0.5, reason: `Cooldown (${consecutiveLosses}L)` };
  if (consecutiveWins >= 3) return { amount: baseAmount * 1.2, reason: `Hot (${consecutiveWins}W)` };
  return { amount: baseAmount, reason: 'Normal' };
}

function adjustSizeByConfidence(baseAmount, confidence) {
  if (confidence == null) return { amount: baseAmount };
  if (confidence >= CONFIDENCE_HIGH) return { amount: baseAmount * 2 };
  if (confidence <= CONFIDENCE_LOW) return { amount: baseAmount * 0.5 };
  return { amount: baseAmount };
}

function calculateDynamicRisk(balance, currentPrice, confidence, sessionMult = 1) {
  const kelly = calculateKellySize(balance);
  let baseAmount = balance * kelly.size;
  const perf = adjustSizeByRecentPerformance(baseAmount);
  const conf = adjustSizeByConfidence(perf.amount, confidence);
  const finalAmount = Math.max(50, conf.amount * sessionMult);
  let lot = parseFloat((finalAmount / currentPrice).toFixed(6));
  if (lot < 0.001) lot = 0.001;
  return {
    tradeAmount: finalAmount, calculatedLot: lot,
    kellyReason: kelly.reason, perfReason: perf.reason, sessionMult,
    finalSizePct: (finalAmount / balance * 100).toFixed(2)
  };
}

function calculateMetrics() {
  if (allPnls.length === 0) return { sharpe: null, profitFactor: null };
  const wins = allPnls.filter(p => p > 0);
  const losses = allPnls.filter(p => p <= 0);
  const totalWin = wins.reduce((a, b) => a + b, 0);
  const totalLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? Infinity : 0);
  const avgWin = wins.length > 0 ? totalWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
  const mean = allPnls.reduce((a, b) => a + b, 0) / allPnls.length;
  const variance = allPnls.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / allPnls.length;
  const stddev = Math.sqrt(variance);
  const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(252) : 0;
  return {
    sharpe: parseFloat(sharpe.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2))
  };
}

function calculateWinRate(limit = 20) {
  const closed = tradeHistory.filter(t => Number.isFinite(t.pnl) && t.pnl !== 0).slice(0, limit);
  if (closed.length === 0) return null;
  const wins = closed.filter(t => t.pnl > 0).length;
  return { wins, losses: closed.length - wins, total: closed.length, rate: wins / closed.length };
}

function updatePerformance(pnl) {
  allPnls.push(pnl);
  if (allPnls.length > 100) allPnls.shift();
  if (pnl > 0) { consecutiveWins++; consecutiveLosses = 0; }
  else { consecutiveLosses++; consecutiveWins = 0; }
  if (virtualBalance > peakBalance) peakBalance = virtualBalance;
  const dd = (peakBalance - virtualBalance) / peakBalance;
  if (dd > maxDrawdown) maxDrawdown = dd;
}

function recordConfidenceOutcome(confidence, isWin) {
  let band;
  if (confidence >= 0.75) band = 'high';
  else if (confidence >= 0.6) band = 'mid';
  else band = 'low';
  if (isWin) confidenceCalibration[band].wins++;
  else confidenceCalibration[band].losses++;
}

function getCalibratedConfidence(rawConfidence) {
  let band;
  if (rawConfidence >= 0.75) band = 'high';
  else if (rawConfidence >= 0.6) band = 'mid';
  else band = 'low';
  const c = confidenceCalibration[band];
  const total = c.wins + c.losses;
  if (total < 10) return rawConfidence;
  const actualRate = c.wins / total;
  return (rawConfidence + actualRate) / 2;
}

function tuneParameters() {
  if (allPnls.length < 20) return;
  const recent = allPnls.slice(-20);
  const wins = recent.filter(p => p > 0).length;
  const winrate = wins / recent.length;
  let changed = false;
  if (winrate < 0.4) {
    if (dynamicParams.minAlignment < 85) { dynamicParams.minAlignment += 5; changed = true; }
    if (dynamicParams.minConfidence < 0.8) { dynamicParams.minConfidence += 0.05; changed = true; }
    if (dynamicParams.kellyFraction > 0.1) { dynamicParams.kellyFraction -= 0.05; changed = true; }
  } else if (winrate > 0.65) {
    if (dynamicParams.minAlignment > 65) { dynamicParams.minAlignment -= 3; changed = true; }
    if (dynamicParams.minConfidence > 0.55) { dynamicParams.minConfidence -= 0.03; changed = true; }
    if (dynamicParams.kellyFraction < 0.35) { dynamicParams.kellyFraction += 0.02; changed = true; }
  }
  if (recent.length >= 10) {
    const avgWin = recent.filter(p => p > 0).reduce((a, b) => a + b, 0) / Math.max(1, wins);
    const avgLoss = Math.abs(recent.filter(p => p <= 0).reduce((a, b) => a + b, 0) / Math.max(1, recent.length - wins));
    if (avgWin > 0 && avgLoss > 0) {
      const ratio = avgWin / avgLoss;
      if (ratio < 1.2 && dynamicParams.atrTpMult < 4.0) { dynamicParams.atrTpMult += 0.1; changed = true; }
      if (ratio > 2.5 && dynamicParams.atrTpMult > 2.0) { dynamicParams.atrTpMult -= 0.1; changed = true; }
    }
  }
  if (changed) {
    console.log(`[AutoTune] align≥${dynamicParams.minAlignment}, conf≥${dynamicParams.minConfidence.toFixed(2)}, kelly=${dynamicParams.kellyFraction.toFixed(2)}, tpMult=${dynamicParams.atrTpMult.toFixed(1)}`);
  }
}

function backtestStrategy(klines, params = {}) {
  if (!klines || klines.length < 100) return null;
  const slMult = params.slMult ?? dynamicParams.atrSlMult;
  const tpMult = params.tpMult ?? dynamicParams.atrTpMult;
  const fee = TAKER_FEE * 2;
  const closes = klines.map(k => k.close);
  let trades = [];
  let position = null;
  let balance = 10000;
  const startBalance = 10000;

  for (let i = 50; i < klines.length; i++) {
    const price = closes[i];
    if (position) {
      const priceDiff = position.type === 'BUY' ? (price - position.entry) : (position.entry - price);
      const pct = priceDiff / position.entry;
      if (price <= position.sl || price >= position.tp || i === klines.length - 1) {
        const grossPnl = position.size * pct;
        const netPnl = grossPnl - position.size * fee;
        balance += netPnl;
        trades.push({ pnl: netPnl, reason: price <= position.sl ? 'SL' : 'TP' });
        position = null;
      }
      continue;
    }
    const slice = klines.slice(0, i + 1);
    const sliceCloses = slice.map(k => k.close);
    const rsi = calculateRSI(sliceCloses, 14);
    const ema20 = calculateEMA(sliceCloses, 20);
    const atr = calculateATR(slice.map(k => k.high), slice.map(k => k.low), sliceCloses, 14);
    if (!rsi || !atr) continue;
    let signal = null;
    if (rsi < 35 && price > ema20) signal = 'BUY';
    else if (rsi > 65 && price < ema20) signal = 'SELL';
    if (signal) {
      const size = balance * 0.02;
      const sl = signal === 'BUY' ? price - atr * slMult : price + atr * slMult;
      const tp = signal === 'BUY' ? price + atr * tpMult : price - atr * tpMult;
      position = { type: signal, entry: price, sl, tp, size };
    }
  }
  if (trades.length < 5) return null;
  const wins = trades.filter(t => t.pnl > 0).length;
  const totalPnl = balance - startBalance;
  const totalWin = trades.filter(t => t.pnl > 0).reduce((a, b) => a + b.pnl, 0);
  const totalLoss = Math.abs(trades.filter(t => t.pnl <= 0).reduce((a, b) => a + b.pnl, 0));
  return {
    trades: trades.length, wins, losses: trades.length - wins,
    winrate: parseFloat((wins / trades.length * 100).toFixed(1)),
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    profitFactor: totalLoss > 0 ? parseFloat((totalWin / totalLoss).toFixed(2)) : null,
    params: { slMult, tpMult }
  };
}

async function sendTelegram(message) {
  if (!TELEGRAM_ENABLED) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) { console.warn('[Telegram]', e.message); }
}

async function fetchKlines(symbol = SYMBOL, interval = '1m', limit = 60) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    return data.map(k => ({ open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }));
  } catch { return null; }
}

async function fetchFundingRate() {
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${SYMBOL}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return parseFloat(d.lastFundingRate);
  } catch { return null; }
}

async function fetchOpenInterest() {
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return parseFloat(d.openInterest);
  } catch { return null; }
}

async function fetchFearGreed() {
  try {
    const r = await fetch(`https://api.alternative.me/fng/?limit=1`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.data && d.data[0]) return { value: parseInt(d.data[0].value), label: d.data[0].value_classification };
    return null;
  } catch { return null; }
}

let prevOI = null;

async function updateMarketContext() {
  try {
    const [k1m, k5m, k15m, k1h, k4h, eth15m, funding, oi, fng, ob] = await Promise.all([
      fetchKlines(SYMBOL, '1m', 100), fetchKlines(SYMBOL, '5m', 60), fetchKlines(SYMBOL, '15m', 30),
      fetchKlines(SYMBOL, '1h', 24), fetchKlines(SYMBOL, '4h', 20), fetchKlines(ETH_SYMBOL, '15m', 30),
      fetchFundingRate(), fetchOpenInterest(), fetchFearGreed(), fetchOrderBook(100)
    ]);

    if (k1m && k1m.length >= 15) {
      const highs = k1m.map(k => k.high);
      const lows = k1m.map(k => k.low);
      const closes = k1m.map(k => k.close);
      const atr = calculateATR(highs, lows, closes, ATR_PERIOD);
      if (atr) { marketContext.atr = atr; marketContext.atrPct = atr / closes[closes.length - 1]; }
      if (k1m.length >= 20) {
        const recentVols = k1m.slice(-20).map(k => k.volume);
        const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
        marketContext.volumeRatio = k1m[k1m.length - 1].volume / avgVol;
      }
      const sr = findSupportResistance(highs, lows, 50);
      marketContext.support = sr.support;
      marketContext.resistance = sr.resistance;
      marketContext.regime = detectMarketRegime(closes, atr);
      const rsiSeries = calculateRSISeries(closes, RSI_PERIOD);
      marketContext.rsiDivergence = detectRSIDivergence(closes, rsiSeries, 20);
      marketContext.candlePattern = detectCandlePattern(k1m);
      const cvd = calculateCVD(k1m.slice(-60));
      if (cvd) { marketContext.cvd1m = cvd.cvd; marketContext.cvdTrend = cvd.trend; }
      const liq = detectLiquidationZones(k1m);
      marketContext.nearestLongLiq = liq.nearestLong;
      marketContext.nearestShortLiq = liq.nearestShort;
    }

    const tfData = {};
    const addTf = (arr, key, period) => {
      if (!arr) return;
      const closes = arr.map(k => k.close);
      const ema = calculateEMA(closes, period);
      tfData[key] = { trend: closes[closes.length - 1] > ema ? 'UP' : 'DOWN', rsi: calculateRSI(closes, 14) };
    };
    addTf(k1m, '1m', 20); addTf(k5m, '5m', 20); addTf(k15m, '15m', 20); addTf(k1h, '1h', 10); addTf(k4h, '4h', 10);

    if (Object.keys(tfData).length >= 3) {
      const alignment = calculateAlignmentScore(tfData);
      marketContext.alignmentScore = alignment.maxAlignment;
      marketContext.alignmentDetails = alignment.details;
      marketContext.dominantDirection = alignment.dominantDirection;
    }

    if (k15m && k15m.length >= 10) {
      const closes15 = k15m.map(k => k.close);
      const ema10 = calculateEMA(closes15, 10);
      const lastClose = closes15[closes15.length - 1];
      marketContext.htfChangePct = (lastClose - closes15[0]) / closes15[0];
      if (lastClose > ema10 && marketContext.htfChangePct > 0.002) marketContext.htfTrend = 'UP';
      else if (lastClose < ema10 && marketContext.htfChangePct < -0.002) marketContext.htfTrend = 'DOWN';
      else marketContext.htfTrend = 'FLAT';
    }

    if (k1h && k1h.length >= 10) {
      const closes1h = k1h.map(k => k.close);
      const ema10 = calculateEMA(closes1h, 10);
      const lastClose = closes1h[closes1h.length - 1];
      if (lastClose > ema10 * 1.002) marketContext.htf1hTrend = 'UP';
      else if (lastClose < ema10 * 0.998) marketContext.htf1hTrend = 'DOWN';
      else marketContext.htf1hTrend = 'FLAT';
    }

    marketContext.session = detectSession();

    if (ob) {
      const oba = analyzeOrderBook(ob);
      if (oba) {
        marketContext.orderBookImbalance = oba.imbalance;
        marketContext.orderBookBidWall = oba.bidWall;
        marketContext.orderBookAskWall = oba.askWall;
      }
    }

    if (funding !== null) marketContext.fundingRate = funding;
    if (oi !== null) {
      marketContext.openInterest = oi;
      if (prevOI !== null && prevOI > 0) marketContext.oiChangePct = (oi - prevOI) / prevOI;
      prevOI = oi;
    }
    if (fng) { marketContext.fearGreed = fng.value; marketContext.fearGreedLabel = fng.label; }

    if (eth15m && eth15m.length >= 10) {
      const ethCloses = eth15m.map(k => k.close);
      const ema10 = calculateEMA(ethCloses, 10);
      const lastClose = ethCloses[ethCloses.length - 1];
      marketContext.ethTrend = lastClose > ema10 ? 'UP' : 'DOWN';
      if (k15m) {
        const btcCloses = k15m.map(k => k.close);
        marketContext.correlation = calculateCorrelation(btcCloses, ethCloses);
      }
    }

    const eventRisk = checkEventRisk();
    marketContext.eventRiskLevel = eventRisk.level;
    marketContext.nextEventName = eventRisk.name;
  } catch (e) { console.warn('[MarketContext]', e.message); }
}

function calculateATRSLTP(entryPrice, side) {
  if (!marketContext.atr) {
    return {
      sl: side === 'BUY' ? entryPrice * (1 + FALLBACK_SL_PCT) : entryPrice * (1 - FALLBACK_SL_PCT),
      tp: side === 'BUY' ? entryPrice * (1 + FALLBACK_TP_PCT) : entryPrice * (1 - FALLBACK_TP_PCT)
    };
  }
  const slDist = marketContext.atr * dynamicParams.atrSlMult;
  const tpDist = marketContext.atr * dynamicParams.atrTpMult;
  return {
    sl: side === 'BUY' ? entryPrice - slDist : entryPrice + slDist,
    tp: side === 'BUY' ? entryPrice + tpDist : entryPrice - tpDist
  };
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
  return { grossPnl, netPnl: grossPnl - entryFee - exitFee, totalFee: entryFee + exitFee };
}

function updateMarketMemory({ price, rsi, ema, macdStatus, decision, reasoning, pnl }) {
  marketMemory.push({
    time: new Date().toLocaleTimeString('id-ID'),
    price: price.toFixed(2), rsi: rsi === null ? 'N/A' : rsi.toFixed(2),
    ema: ema.toFixed(2), macd: macdStatus, decision, reasoning,
    pnl: pnl != null ? `$${pnl.toFixed(2)}` : '$0.00'
  });
  if (marketMemory.length > MAX_MARKET_MEMORY) marketMemory.shift();
}

function setCloseEvent(pnl, source) {
  const isProfit = pnl >= 0;
  lastCloseEvent = {
    type: isProfit ? 'PROFIT' : 'LOSS',
    pnl: parseFloat(pnl.toFixed(2)),
    message: isProfit ? 'Horee!!! Berhasil profit' : 'Yaah!! Gagal nih aku coba lagi ya',
    source: source || 'AI', timestamp: Date.now()
  };
}

function checkDailyReset() {
  const today = new Date().toDateString();
  if (today !== dailyStartDate) {
    dailyStartDate = today; dailyStartBalance = virtualBalance; dailyPnl = 0; dailyTrades = 0;
  }
  if (today !== dailyGeminiRequestsDate) {
    dailyGeminiRequestsDate = today;
    dailyGeminiRequests = 0;
    hourlyRequests = [];
  }
}

function requireAuth(req, res, next) {
  if (!CONTROL_API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== CONTROL_API_KEY) return res.status(401).json({ success: false, message: 'Unauthorized' });
  next();
}

async function fetchPrice() {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${SYMBOL}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) { const d = await r.json(); const p = parseFloat(d?.price); if (Number.isFinite(p)) return p; }
  } catch {}
  try {
    const r = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${SYMBOL}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) { const d = await r.json(); const p = parseFloat(d?.price); if (Number.isFinite(p)) return p; }
  } catch {}
  throw new Error('Semua sumber harga BTC gagal.');
}

async function executeBrokerOpen(action, price, lot) {
  if (!ENABLE_LIVE_BROKER) return { ok: true, positionId: `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, simulated: true };
  try {
    const url = `${META_API_BASE}/users/current/accounts/${META_ACCOUNT_ID}/trade`;
    const payload = { actionType: action === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL', symbol: SYMBOL, volume: lot };
    const r = await fetch(url, { method: 'POST', headers: { 'auth-token': META_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.message || `HTTP ${r.status}` };
    const positionId = data.positionId || data.orderId || data.order?.id || data.position?.id;
    if (!positionId) return { ok: false, error: 'No positionId' };
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

async function checkStopLossTakeProfit(currentPrice) {
  if (activeTrades.length === 0) return { closed: false, pnl: 0, count: 0 };
  let closedPnl = 0;
  const remaining = [];
  let anyClosed = false, closedCount = 0;
  for (const trade of activeTrades) {
    const diff = trade.type === 'BUY' ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
    const pct = diff / trade.entryPrice;
    const { netPnl, totalFee } = computeNetPnl(trade, currentPrice);
    if (!trade.peakPct || pct > trade.peakPct) trade.peakPct = pct;
    if (!trade.peakPrice) trade.peakPrice = currentPrice;
    if (trade.type === 'BUY' && currentPrice > trade.peakPrice) trade.peakPrice = currentPrice;
    if (trade.type === 'SELL' && currentPrice < trade.peakPrice) trade.peakPrice = currentPrice;
    let hitSL = false, hitTP = false;
    if (trade.type === 'BUY') { hitSL = currentPrice <= trade.slPrice; hitTP = currentPrice >= trade.tpPrice; }
    else { hitSL = currentPrice >= trade.slPrice; hitTP = currentPrice <= trade.tpPrice; }
    const hitCap = pct >= HARD_TP_CAP_PCT;
    let hitChandelier = false;
    if (trade.peakPct >= CHANDELIER_ACTIVATION_PCT && marketContext.atr) {
      const dist = marketContext.atr * CHANDELIER_ATR_MULT;
      if (trade.type === 'BUY') hitChandelier = currentPrice <= trade.peakPrice - dist;
      else hitChandelier = currentPrice >= trade.peakPrice + dist;
    }
    if (hitTP || hitSL || hitCap || hitChandelier) {
      const reason = hitSL ? 'SL' : hitTP ? 'TP' : hitCap ? 'TP-CAP' : 'CHANDELIER';
      const result = await executeBrokerClose(trade.positionId);
      if (!result.ok) { remaining.push(trade); continue; }
      closedPnl += netPnl; cumulativeFee += totalFee; cumulativeTrades++; dailyTrades++; dailyPnl += netPnl;
      updatePerformance(netPnl);
      if (trade.confidence != null) recordConfidenceOutcome(trade.confidence, netPnl > 0);
      if (trade.signature) {
        recordPatternOutcome(trade.signature, netPnl > 0);
        if (trade.session && patternStats.bySession[trade.session]) {
          if (netPnl > 0) patternStats.bySession[trade.session].wins++;
          else patternStats.bySession[trade.session].losses++;
        }
        if (trade.regime) {
          if (!patternStats.byRegime[trade.regime]) patternStats.byRegime[trade.regime] = { wins: 0, losses: 0 };
          if (netPnl > 0) patternStats.byRegime[trade.regime].wins++;
          else patternStats.byRegime[trade.regime].losses++;
        }
      }
      if (trade.ensembleSignals) {
        for (const [name, sig] of Object.entries(trade.ensembleSignals)) {
          if (sig.signal === trade.type) {
            if (netPnl > 0) ensembleStats[name].wins++;
            else ensembleStats[name].losses++;
          }
        }
      }
      anyClosed = true; closedCount++;
      tradeHistory.unshift({
        time: new Date().toLocaleTimeString('id-ID'),
        type: `${reason} ${trade.type} (${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(2)}% • $${netPnl.toFixed(2)})`,
        open: trade.entryPrice.toFixed(2), close: currentPrice.toFixed(2),
        pnl: netPnl, balanceAfter: virtualBalance + closedPnl
      });
      sendTelegram(`${netPnl >= 0 ? '✅' : '❌'} <b>${reason} ${trade.type}</b>\nPnL: $${netPnl.toFixed(2)}\nBalance: $${(virtualBalance + closedPnl).toFixed(2)}`);
    } else {
      remaining.push(trade);
    }
  }
  activeTrades = remaining;
  if (anyClosed) {
    virtualBalance += closedPnl;
    setCloseEvent(closedPnl, 'TP/SL');
    tuneParameters();
  }
  return { closed: anyClosed, pnl: closedPnl, count: closedCount };
}

// ================== QUOTA MANAGEMENT ==================
function canCallGemini() {
  if (quotaCooldown.active && Date.now() < quotaCooldown.until) {
    return { ok: false, reason: `cooldown until ${new Date(quotaCooldown.until).toLocaleTimeString('id-ID')}` };
  }
  if (quotaCooldown.active && Date.now() >= quotaCooldown.until) {
    console.log('[Quota] Cooldown selesai.');
    quotaCooldown.active = false;
    quotaCooldown.hits = 0;
  }
  if (dailyGeminiRequests >= DAILY_REQUEST_LIMIT) {
    return { ok: false, reason: `daily limit ${DAILY_REQUEST_LIMIT}` };
  }
  const oneHourAgo = Date.now() - 3600000;
  hourlyRequests = hourlyRequests.filter(t => t > oneHourAgo);
  if (hourlyRequests.length >= MAX_REQUESTS_PER_HOUR) {
    return { ok: false, reason: `hourly limit ${MAX_REQUESTS_PER_HOUR}` };
  }
  return { ok: true };
}

function trackGeminiCall() {
  dailyGeminiRequests++;
  hourlyRequests.push(Date.now());
}

function handle429() {
  quotaCooldown.hits++;
  let duration;
  if (quotaCooldown.hits >= 3) duration = COOLDOWN_AFTER_429_HITS_3_MS;
  else if (quotaCooldown.hits >= 2) duration = COOLDOWN_AFTER_429_HITS_2_MS;
  else duration = COOLDOWN_AFTER_429_MS;
  quotaCooldown.active = true;
  quotaCooldown.until = Date.now() + duration;
  console.warn(`[Quota] Kena 429! Cooldown ${duration / 60000} menit (hit #${quotaCooldown.hits})`);
  sendTelegram(`⚠️ <b>Groq quota habis</b>\nCooldown ${duration / 60000} menit.`);
}

function rsiBand(rsi) {
  if (rsi == null) return 'na';
  if (rsi < 35) return 'low';
  if (rsi > 65) return 'high';
  return 'mid';
}
function alignBand(a) {
  if (a == null) return 'na';
  if (a < 50) return 'low';
  if (a > 75) return 'high';
  return 'mid';
}

function shouldSkipGemini(currentPrice, rsiValue, alignmentScore, regime) {
  if (!geminiCache.decision) return false;
  const age = Date.now() - geminiCache.timestamp;
  if (age > CACHE_TTL_MS) return false;
  const priceChange = Math.abs(currentPrice - geminiCache.price) / geminiCache.price;
  if (priceChange > CACHE_PRICE_THRESHOLD) return false;
  if (regime !== geminiCache.regime) return false;
  if (rsiBand(rsiValue) !== geminiCache.rsiBand) return false;
  if (alignBand(alignmentScore) !== geminiCache.alignmentBand) return false;
  return true;
}

// ================== GROQ CALL ==================
async function callGroqModel(modelName, systemPrompt, attempts = 1) {
  const guard = canCallGemini();
  if (!guard.ok) {
    console.warn(`[Groq] Skip: ${guard.reason}`);
    return { ok: false, error: new Error(guard.reason), quotaBlocked: true };
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      trackGeminiCall();
      const url = `${GROQ_API_BASE}/chat/completions`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: systemPrompt }],
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_tokens: 500,
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!response.ok) {
        const errText = await response.text();
        const errMsg = `HTTP ${response.status}: ${errText.slice(0, 250)}`;
        console.warn(`[Groq][${modelName}][a${attempt}] ${errMsg}`);

        if (response.status === 429) {
          handle429();
          return { ok: false, error: new Error(errMsg), quotaExceeded: true };
        }
        if (response.status === 401 || response.status === 403) {
          return { ok: false, error: new Error(errMsg), authError: true };
        }
        if (response.status >= 500 && response.status < 600) {
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          return { ok: false, error: new Error(errMsg) };
        }
        return { ok: false, error: new Error(errMsg), modelUnavailable: true };
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;

      if (text) {
        const cleaned = text.replace(/```json|```/g, '').trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed.action === 'string') {
            return { ok: true, decision: parsed };
          }
        } catch (parseErr) {
          console.warn(`[Groq][${modelName}] JSON parse gagal: ${cleaned.slice(0, 150)}`);
          return { ok: false, error: new Error('JSON parse gagal') };
        }
      }
      return { ok: false, error: new Error('Respons kosong') };
    } catch (e) {
      console.warn(`[Groq][${modelName}][a${attempt}] ${e.message}`);
      if (attempt >= attempts) return { ok: false, error: e };
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return { ok: false };
}

async function callAI(systemPrompt) {
  for (const model of GROQ_MODELS_PRIMARY) {
    const res = await callGroqModel(model, systemPrompt, 1);
    if (res.ok) { geminiSuccessCount++; return { ok: true, decision: res.decision, model }; }
    if (res.quotaExceeded || res.quotaBlocked) { geminiFailCount++; return { ok: false, quotaExceeded: true }; }
    if (res.authError) { geminiFailCount++; return { ok: false, authError: true }; }
  }

  for (const model of GROQ_MODELS_FALLBACK) {
    const res = await callGroqModel(model, systemPrompt, 1);
    if (res.ok) { geminiSuccessCount++; return { ok: true, decision: res.decision, model }; }
    if (res.quotaExceeded || res.quotaBlocked) { geminiFailCount++; return { ok: false, quotaExceeded: true }; }
    if (res.authError) { geminiFailCount++; return { ok: false, authError: true }; }
  }

  geminiFailCount++;
  return { ok: false };
}

// ================== FALLBACK ==================
function fallbackDecision(currentPrice, rsiValue, macdText, rsiText, ensemble) {
  const decision = { action: 'HOLD', reasoning: '', confidence: 0 };
  if (activeTrades.length > 0) {
    const avgEntry = activeTrades.reduce((s, t) => s + t.entryPrice, 0) / activeTrades.length;
    const isBuy = activeTrades[0].type === 'BUY';
    const diff = isBuy ? (currentPrice - avgEntry) : (avgEntry - currentPrice);
    const pct = diff / avgEntry;
    if (pct >= FALLBACK_PROFIT_CLOSE_PCT) { decision.action = 'CLOSE'; decision.reasoning = `Fallback profit +${(pct * 100).toFixed(2)}%`; }
    else if (pct <= FALLBACK_LOSS_CLOSE_PCT) { decision.action = 'CLOSE'; decision.reasoning = `Fallback SL ${(pct * 100).toFixed(2)}%`; }
    else { decision.action = 'HOLD'; decision.reasoning = `Fallback HOLD ${(pct * 100).toFixed(2)}%`; }
  } else {
    const align = marketContext.alignmentScore;
    if (ensemble && ensemble.consensus === 'BUY' && align != null && align >= dynamicParams.minAlignment && marketContext.dominantDirection === 'BULL') {
      decision.action = 'BUY';
      decision.reasoning = `Fallback ENSEMBLE BUY (align ${align}, ens ${ensemble.buyPct}%)`;
      decision.confidence = Math.min(0.7, ensemble.buyPct / 100);
    } else if (ensemble && ensemble.consensus === 'SELL' && align != null && align >= dynamicParams.minAlignment && marketContext.dominantDirection === 'BEAR') {
      decision.action = 'SELL';
      decision.reasoning = `Fallback ENSEMBLE SELL (align ${align}, ens ${ensemble.sellPct}%)`;
      decision.confidence = Math.min(0.7, ensemble.sellPct / 100);
    } else {
      decision.action = 'HOLD';
      decision.reasoning = `Fallback HOLD (align=${align ?? 'N/A'}, ens=${ensemble?.consensus ?? 'N/A'})`;
    }
  }
  return decision;
}

// ================== MAIN LOOP ==================
async function runAutonomousAgent() {
  if (isExecutingCycle) return;
  isExecutingCycle = true;
  cycleCount++;

  try {
    checkDailyReset();
    let currentPrice;
    try {
      currentPrice = await fetchPrice();
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      console.warn(`[Price] Gagal (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        isBotRunning = false;
        if (botInterval) { clearInterval(botInterval); botInterval = null; }
      }
      return;
    }

    priceHistory.push(currentPrice);
    if (priceHistory.length > MAX_PRICE_HISTORY) priceHistory.shift();

    await updateMarketContext();
    await checkStopLossTakeProfit(currentPrice);

    const rsiValue = calculateRSI(priceHistory, RSI_PERIOD);
    const ema20Value = calculateEMA(priceHistory, 20);
    const macdData = calculateMACDSeries(priceHistory);
    const emaTrend = currentPrice >= ema20Value ? 'UPTREND' : 'DOWNTREND';
    const bb = calculateBollingerBands(priceHistory, BB_PERIOD, BB_STDDEV);
    const rsiText = rsiValue === null ? 'N/A' : rsiValue.toFixed(2);
    const macdText = macdData ? macdData.status : 'N/A';

    if (bb) {
      marketContext.bbUpper = bb.upper; marketContext.bbLower = bb.lower;
      marketContext.bbMiddle = bb.middle; marketContext.bbWidth = bb.width;
      marketContext.bbPosition = (currentPrice - bb.lower) / (bb.upper - bb.lower);
    }

    const session = marketContext.session;
    const sessionParams = getSessionParams(session);

    const ensembleCtx = {
      rsi: rsiValue, macdStatus: macdText, emaTrend,
      bbPosition: marketContext.bbPosition,
      htfTrend: marketContext.htfTrend, htf1hTrend: marketContext.htf1hTrend,
      regime: marketContext.regime, volumeRatio: marketContext.volumeRatio,
      cvdTrend: marketContext.cvdTrend, orderBookImbalance: marketContext.orderBookImbalance,
      oiChangePct: marketContext.oiChangePct,
      support: marketContext.support, resistance: marketContext.resistance
    };
    const ensemble = runEnsemble(ensembleCtx, currentPrice);

    const featureScore = computeFeatureScore({
      alignmentScore: marketContext.alignmentScore, rsi: rsiValue,
      bbPosition: marketContext.bbPosition, volumeRatio: marketContext.volumeRatio,
      orderBookImbalance: marketContext.orderBookImbalance, cvdTrend: marketContext.cvdTrend,
      session, regime: marketContext.regime
    }, ensemble);
    marketContext.featureScore = featureScore.buyScore;

    const signature = generateSignature({
      regime: marketContext.regime, htfTrend: marketContext.htfTrend,
      session, rsiDivergence: marketContext.rsiDivergence, candlePattern: marketContext.candlePattern
    });
    const sigWinrate = getPatternWinrate(signature);
    const bestPatterns = getBestPatterns(3);

    const winRate = calculateWinRate(20);
    const winRateText = winRate ? `${(winRate.rate * 100).toFixed(0)}%` : 'N/A';
    const metrics = calculateMetrics();

    const dailyLossPct = (virtualBalance - dailyStartBalance) / dailyStartBalance;
    const dailyLimitHit = dailyLossPct <= -DAILY_LOSS_LIMIT_PCT;
    const feeRatio = cumulativeFee / 10000;
    const feeGuardActive = feeRatio >= MAX_CUMULATIVE_FEE_PCT;
    const alignScore = marketContext.alignmentScore;

    const recentClosed = tradeHistory.filter(t => Number.isFinite(t.pnl) && t.pnl !== 0).slice(0, 5);
    const reflectionCtx = recentClosed.length > 0
      ? `5 trade: ${recentClosed.map(t => `$${t.pnl.toFixed(2)}`).join(', ')}\nStreak: ${consecutiveWins}W/${consecutiveLosses}L`
      : '(Sesi awal)';

    let agentDecision = { action: 'HOLD', reasoning: 'Menunggu...', confidence: 0 };
    let consensus = 'N/A';

    const skipAI = shouldSkipGemini(currentPrice, rsiValue, alignScore, marketContext.regime);

    if (skipAI) {
      agentDecision = geminiCache.decision;
      consensus = 'CACHED';
      geminiSkipCount++;
      console.log(`[Cache] Skip AI — kondisi hampir sama (${Math.round((Date.now() - geminiCache.timestamp) / 1000)}s lalu)`);
    } else {
      const guard = canCallGemini();
      if (!guard.ok) {
        agentDecision = fallbackDecision(currentPrice, rsiValue, macdText, rsiText, ensemble);
        lastGeminiStatus = 'quota-blocked';
        consensus = 'QUOTA-FALLBACK';
        console.log(`[Quota] Skip AI: ${guard.reason}`);
      } else {
        const systemPrompt = `
Kamu "Orion v5" - AI Trading Agent BTC (${DISPLAY}) INSTITUTIONAL.

═══════ ENSEMBLE (5 strategi) ═══════
Konsensus: ${ensemble.consensus} (B:${ensemble.buyPct}% S:${ensemble.sellPct}%)
${Object.entries(ensemble.signals).map(([n, s]) => `- ${n}: ${s.signal} (${Math.round(s.strength * 100)}%)`).join('\n')}

═══════ FEATURE SCORE ═══════
Buy: ${featureScore.buyScore}/100 | Sell: ${featureScore.sellScore}/100

═══════ PASAR ═══════
Harga: $${currentPrice.toFixed(2)}
RSI: ${rsiText} | EMA: ${emaTrend} | MACD: ${macdText}
BB pos: ${marketContext.bbPosition != null ? (marketContext.bbPosition * 100).toFixed(0) + '%' : 'N/A'}
Alignment: ${alignScore ?? 'N/A'}/100 (${marketContext.dominantDirection})
OrderBook: ${marketContext.orderBookImbalance != null ? (marketContext.orderBookImbalance * 100).toFixed(1) + '%' : 'N/A'}
CVD: ${marketContext.cvdTrend}
ATR: $${marketContext.atr ? marketContext.atr.toFixed(2) : 'N/A'}
Regime: ${marketContext.regime}
Vol ratio: ${marketContext.volumeRatio ? marketContext.volumeRatio.toFixed(2) + '×' : 'N/A'}
Divergence: ${marketContext.rsiDivergence} | Candle: ${marketContext.candlePattern}
Session: ${session}
S/R: $${marketContext.support?.toFixed(2) ?? 'N/A'} / $${marketContext.resistance?.toFixed(2) ?? 'N/A'}
Funding: ${marketContext.fundingRate != null ? (marketContext.fundingRate * 100).toFixed(4) + '%' : 'N/A'}
F&G: ${marketContext.fearGreed ?? 'N/A'}

═══════ AKUN ═══════
Saldo: $${virtualBalance.toFixed(2)} | Posisi: ${activeTrades.length}/${MAX_ACTIVE_TRADES}
Winrate: ${winRateText}

═══════ ATURAN ═══════
1. Ada posisi → "HOLD"
2. Entry hanya jika:
   ✅ BUY: ens=BUY + feat≥65 + align≥${dynamicParams.minAlignment} BULL + HTF UP/FLAT + RSI 30-55 + BB<0.7
   ✅ SELL: ens=SELL + feat≥65 + align≥${dynamicParams.minAlignment} BEAR + HTF DOWN/FLAT + RSI 45-70 + BB>0.3
3. RAGU → HOLD

Balas HANYA JSON: {"action":"BUY"|"SELL"|"HOLD"|"CLOSE","confidence":0.85,"reasoning":"..."}
`;

        const aiResult = await callAI(systemPrompt);

        if (aiResult.ok) {
          agentDecision = aiResult.decision;
          consensus = 'AI';
          lastGeminiStatus = `ok/${aiResult.model}`;
          geminiCache = {
            decision: agentDecision, price: currentPrice,
            regime: marketContext.regime,
            rsiBand: rsiBand(rsiValue),
            alignmentBand: alignBand(alignScore),
            timestamp: Date.now()
          };
        } else {
          console.warn('[Groq] Gagal → fallback');
          agentDecision = fallbackDecision(currentPrice, rsiValue, macdText, rsiText, ensemble);
          lastGeminiStatus = 'fallback';
          consensus = 'FALLBACK';
        }
      }
    }

    if (agentDecision.confidence != null && agentDecision.action !== 'HOLD' && agentDecision.action !== 'CLOSE') {
      agentDecision.calibratedConfidence = getCalibratedConfidence(agentDecision.confidence);
    }

    // GUARDS
    if (dailyLimitHit) { agentDecision.action = 'HOLD'; agentDecision.reasoning = `⚠️ Daily loss ${(dailyLossPct * 100).toFixed(2)}%`; }
    if (!sessionParams.allowTrade && agentDecision.action !== 'HOLD' && agentDecision.action !== 'CLOSE') {
      agentDecision.action = 'HOLD'; agentDecision.reasoning = `⚠️ Session ${session} off`;
    }
    if ((agentDecision.action === 'BUY' || agentDecision.action === 'SELL') && alignScore != null && alignScore < dynamicParams.minAlignment) {
      agentDecision.action = 'HOLD'; agentDecision.reasoning = `⚠️ Align ${alignScore} < ${dynamicParams.minAlignment}`;
    }
    if ((agentDecision.action === 'BUY' || agentDecision.action === 'SELL') && (agentDecision.confidence ?? 0) < dynamicParams.minConfidence) {
      agentDecision.action = 'HOLD'; agentDecision.reasoning = `⚠️ Conf low`;
    }
    if ((agentDecision.action === 'BUY' || agentDecision.action === 'SELL') && marketContext.eventRiskLevel === 'HIGH') {
      agentDecision.action = 'HOLD'; agentDecision.reasoning = `⚠️ Event HIGH`;
    }

    // Eksekusi
    if (agentDecision.action === 'CLOSE' && activeTrades.length > 0) {
      let closedCount = 0, closeTotalPnl = 0;
      const closedTrades = [];
      for (const trade of [...activeTrades]) {
        const result = await executeBrokerClose(trade.positionId);
        if (!result.ok) continue;
        const { netPnl, totalFee } = computeNetPnl(trade, currentPrice);
        closeTotalPnl += netPnl; cumulativeFee += totalFee; cumulativeTrades++; dailyTrades++; dailyPnl += netPnl;
        updatePerformance(netPnl);
        if (trade.confidence != null) recordConfidenceOutcome(trade.confidence, netPnl > 0);
        if (trade.signature) recordPatternOutcome(trade.signature, netPnl > 0);
        if (trade.ensembleSignals) {
          for (const [name, sig] of Object.entries(trade.ensembleSignals)) {
            if (sig.signal === trade.type) {
              if (netPnl > 0) ensembleStats[name].wins++;
              else ensembleStats[name].losses++;
            }
          }
        }
        closedTrades.push(trade); closedCount++;
      }
      if (closedCount > 0) {
        virtualBalance += closeTotalPnl;
        activeTrades = activeTrades.filter(t => !closedTrades.includes(t));
        tradeHistory.unshift({
          time: new Date().toLocaleTimeString('id-ID'),
          type: `AI CLOSE ${closedCount}x (${closeTotalPnl >= 0 ? 'PROFIT' : 'LOSS'})`,
          open: closedTrades[0].entryPrice.toFixed(2), close: currentPrice.toFixed(2),
          pnl: closeTotalPnl, balanceAfter: virtualBalance
        });
        updateMarketMemory({
          price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
          decision: 'CLOSE', reasoning: agentDecision.reasoning, pnl: closeTotalPnl
        });
        setCloseEvent(closeTotalPnl, 'AI');
        tuneParameters();
      }
    } else if ((agentDecision.action === 'BUY' || agentDecision.action === 'SELL') && activeTrades.length === 0) {
      if (feeGuardActive) {
        updateMarketMemory({
          price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
          decision: 'HOLD', reasoning: `⚠️ Fee guard $${cumulativeFee.toFixed(2)}`,
          pnl: computeUnrealizedPnl(currentPrice)
        });
      } else {
        const confidence = agentDecision.calibratedConfidence || agentDecision.confidence || 0.6;
        const sizingInfo = calculateDynamicRisk(virtualBalance, currentPrice, confidence, sessionParams.riskMult);
        const { tradeAmount, calculatedLot } = sizingInfo;
        const totalExposure = tradeAmount * MAX_ACTIVE_TRADES;

        if (virtualBalance >= totalExposure) {
          const openedTrades = [];
          for (let step = 0; step < SCALE_IN_STEPS; step++) {
            const perStep = Math.ceil(MAX_ACTIVE_TRADES / SCALE_IN_STEPS);
            for (let i = 0; i < perStep; i++) {
              if (openedTrades.length >= MAX_ACTIVE_TRADES) break;
              const livePrice = step === 0 ? currentPrice : await fetchPrice().catch(() => currentPrice);
              const entryPrice = applySlippage(livePrice, agentDecision.action);
              const result = await executeBrokerOpen(agentDecision.action, entryPrice, calculatedLot);
              if (!result.ok) continue;
              const { sl, tp } = calculateATRSLTP(entryPrice, agentDecision.action);
              const entryFee = tradeAmount * TAKER_FEE;
              virtualBalance -= entryFee; cumulativeFee += entryFee;
              openedTrades.push({
                id: Date.now() + i + step * 100, positionId: result.positionId,
                type: agentDecision.action, notional: tradeAmount, lot: calculatedLot,
                entryPrice, slPrice: sl, tpPrice: tp,
                entryTs: Date.now(), peakPct: 0, peakPrice: entryPrice,
                confidence: agentDecision.confidence, calibratedConfidence: confidence,
                consensus, signature, session, regime: marketContext.regime,
                ensembleSignals: ensemble.signals
              });
            }
            if (step < SCALE_IN_STEPS - 1) await new Promise(r => setTimeout(r, SCALE_IN_DELAY_MS));
          }

          activeTrades.push(...openedTrades);
          if (openedTrades.length > 0) {
            tradeHistory.unshift({
              time: new Date().toLocaleTimeString('id-ID'),
              type: `OPEN ${openedTrades.length}x ${agentDecision.action} (${session} | ${consensus})`,
              open: openedTrades[0].entryPrice.toFixed(2), close: '-', pnl: 0, balanceAfter: virtualBalance
            });
            updateMarketMemory({
              price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
              decision: agentDecision.action,
              reasoning: `[${consensus}] ${agentDecision.reasoning}`,
              pnl: 0
            });
            sendTelegram(`🚀 <b>OPEN ${openedTrades.length}x ${agentDecision.action}</b>\nEntry: $${openedTrades[0].entryPrice.toFixed(2)}\n${consensus} | ${session}`);
          }
        } else {
          updateMarketMemory({
            price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
            decision: 'HOLD', reasoning: 'Saldo tidak cukup.',
            pnl: computeUnrealizedPnl(currentPrice)
          });
        }
      }
    } else {
      updateMarketMemory({
        price: currentPrice, rsi: rsiValue, ema: ema20Value, macdStatus: macdText,
        decision: 'HOLD', reasoning: agentDecision.reasoning,
        pnl: computeUnrealizedPnl(currentPrice)
      });
    }

    if (tradeHistory.length > MAX_TRADE_HISTORY) tradeHistory.pop();

    serverLogs = {
      symbol: DISPLAY,
      price: currentPrice.toFixed(2),
      analysis: `[Orion v5|${consensus}] ${agentDecision.reasoning}`,
      decision: agentDecision.action,
      confidence: agentDecision.confidence ?? null,
      calibratedConfidence: agentDecision.calibratedConfidence ?? null,
      consensus, geminiStatus: lastGeminiStatus,
      balance: virtualBalance,
      activeTradesCount: activeTrades.length,
      activeTrades,
      totalCurrentPnl: computeUnrealizedPnl(currentPrice),
      maxActiveTrades: MAX_ACTIVE_TRADES,
      cumulativeFee: parseFloat(cumulativeFee.toFixed(2)),
      cumulativeTrades, dailyPnl: parseFloat(dailyPnl.toFixed(2)), dailyTrades,
      winRate, metrics,
      streak: { wins: consecutiveWins, losses: consecutiveLosses },
      geminiStats: {
        success: geminiSuccessCount, fail: geminiFailCount,
        skip: geminiSkipCount,
        dailyRequests: dailyGeminiRequests,
        dailyLimit: DAILY_REQUEST_LIMIT,
        hourlyCount: hourlyRequests.length,
        hourlyLimit: MAX_REQUESTS_PER_HOUR,
        cooldown: quotaCooldown.active ? {
          active: true,
          until: new Date(quotaCooldown.until).toLocaleTimeString('id-ID'),
          remainingMs: Math.max(0, quotaCooldown.until - Date.now())
        } : { active: false },
        cacheAge: geminiCache.decision ? Date.now() - geminiCache.timestamp : null,
        cacheValid: !!geminiCache.decision && (Date.now() - geminiCache.timestamp) < CACHE_TTL_MS
      },
      lastCloseEvent,
      currentSignature: signature, signatureWinrate: sigWinrate, bestPatterns,
      dynamicParams,
      ensemble: {
        consensus: ensemble.consensus,
        buyPct: ensemble.buyPct, sellPct: ensemble.sellPct,
        signals: ensemble.signals, stats: ensembleStats
      },
      featureScore: { buy: featureScore.buyScore, sell: featureScore.sellScore, features: featureScore.features },
      confidenceCalibration,
      patternStats: {
        sessionPerformance: patternStats.bySession,
        regimePerformance: patternStats.byRegime,
        totalPatterns: Object.keys(patternStats.bySignature).length
      },
      lastBacktest,
      marketContext: {
        atr: marketContext.atr ? parseFloat(marketContext.atr.toFixed(2)) : null,
        atrPct: marketContext.atrPct ? parseFloat((marketContext.atrPct * 100).toFixed(3)) : null,
        htfTrend: marketContext.htfTrend, htf1hTrend: marketContext.htf1hTrend,
        volumeRatio: marketContext.volumeRatio ? parseFloat(marketContext.volumeRatio.toFixed(2)) : null,
        regime: marketContext.regime,
        support: marketContext.support ? parseFloat(marketContext.support.toFixed(2)) : null,
        resistance: marketContext.resistance ? parseFloat(marketContext.resistance.toFixed(2)) : null,
        bbPosition: marketContext.bbPosition != null ? parseFloat((marketContext.bbPosition * 100).toFixed(0)) : null,
        fundingRate: marketContext.fundingRate, openInterest: marketContext.openInterest,
        fearGreed: marketContext.fearGreed, fearGreedLabel: marketContext.fearGreedLabel,
        rsiDivergence: marketContext.rsiDivergence, candlePattern: marketContext.candlePattern,
        orderBookImbalance: marketContext.orderBookImbalance,
        orderBookBidWall: marketContext.orderBookBidWall, orderBookAskWall: marketContext.orderBookAskWall,
        cvd1m: marketContext.cvd1m, cvdTrend: marketContext.cvdTrend,
        alignmentScore: marketContext.alignmentScore,
        dominantDirection: marketContext.dominantDirection,
        alignmentDetails: marketContext.alignmentDetails,
        session, sessionParams,
        nearestLongLiq: marketContext.nearestLongLiq, nearestShortLiq: marketContext.nearestShortLiq,
        ethTrend: marketContext.ethTrend, correlation: marketContext.correlation,
        eventRiskLevel: marketContext.eventRiskLevel, nextEventName: marketContext.nextEventName,
        featureScore: marketContext.featureScore
      },
      indicators: {
        rsi: rsiValue === null ? null : parseFloat(rsiValue.toFixed(2)),
        ema20: ema20Value.toFixed(2),
        macd: macdData ? { macd: macdData.macd.toFixed(2), signal: macdData.signal.toFixed(2), histogram: macdData.histogram.toFixed(2) } : null,
        macdStatus: macdText, trend: emaTrend
      },
      tradeHistory, marketMemory, cycleCount,
      timestamp: new Date().toLocaleTimeString('id-ID')
    };
  } catch (error) {
    console.error('[Loop Error]:', error);
  } finally {
    isExecutingCycle = false;
  }
}

function generateSignature(ctx) {
  return [ctx.regime, ctx.htfTrend, ctx.session, ctx.rsiDivergence, ctx.candlePattern].join('|');
}
function recordPatternOutcome(signature, isWin) {
  if (!patternStats.bySignature[signature]) patternStats.bySignature[signature] = { wins: 0, losses: 0 };
  if (isWin) patternStats.bySignature[signature].wins++;
  else patternStats.bySignature[signature].losses++;
}
function getPatternWinrate(signature) {
  const s = patternStats.bySignature[signature];
  if (!s) return null;
  const total = s.wins + s.losses;
  if (total < 3) return null;
  return { rate: s.wins / total, wins: s.wins, losses: s.losses, total };
}
function getBestPatterns(topN = 3) {
  return Object.entries(patternStats.bySignature)
    .filter(([, s]) => (s.wins + s.losses) >= 3)
    .map(([sig, s]) => ({ sig, winrate: s.wins / (s.wins + s.losses), wins: s.wins, losses: s.losses, total: s.wins + s.losses }))
    .sort((a, b) => b.winrate - a.winrate)
    .slice(0, topN);
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
  res.json({ success: true, message: 'Orion v5 aktif (Groq).' });
});

app.get('/api/stop-bot', requireAuth, (req, res) => {
  isBotRunning = false;
  if (botInterval) { clearInterval(botInterval); botInterval = null; }
  res.json({ success: true, message: 'Orion v5 dihentikan.' });
});

app.get('/api/force-close', requireAuth, async (req, res) => {
  if (activeTrades.length === 0) return res.json({ success: false, message: 'Tidak ada posisi.' });
  try {
    const currentPrice = await fetchPrice();
    let totalPnl = 0, closedCount = 0;
    const closedTrades = [];
    for (const trade of [...activeTrades]) {
      const result = await executeBrokerClose(trade.positionId);
      if (!result.ok) continue;
      const { netPnl, totalFee } = computeNetPnl(trade, currentPrice);
      totalPnl += netPnl; cumulativeFee += totalFee; cumulativeTrades++; dailyTrades++; dailyPnl += netPnl;
      updatePerformance(netPnl);
      if (trade.confidence != null) recordConfidenceOutcome(trade.confidence, netPnl > 0);
      if (trade.signature) recordPatternOutcome(trade.signature, netPnl > 0);
      closedTrades.push(trade); closedCount++;
    }
    if (closedCount > 0) {
      virtualBalance += totalPnl;
      activeTrades = activeTrades.filter(t => !closedTrades.includes(t));
      tradeHistory.unshift({
        time: new Date().toLocaleTimeString('id-ID'),
        type: `MANUAL CLOSE ${closedCount}x`,
        open: closedTrades[0].entryPrice.toFixed(2), close: currentPrice.toFixed(2),
        pnl: totalPnl, balanceAfter: virtualBalance
      });
      setCloseEvent(totalPnl, 'MANUAL');
    }
    res.json({ success: true, message: `${closedCount} posisi ditutup. PnL: $${totalPnl.toFixed(2)}` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/reset-quota', requireAuth, (req, res) => {
  quotaCooldown = { active: false, until: 0, hits: 0 };
  dailyGeminiRequests = 0;
  hourlyRequests = [];
  res.json({ success: true, message: 'Quota cooldown direset.' });
});

// Test endpoint Groq
app.get('/api/test-ai', requireAuth, async (req, res) => {
  const modelToTest = req.query.model || GROQ_MODELS_PRIMARY[0];
  try {
    const url = `${GROQ_API_BASE}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelToTest,
        messages: [{ role: 'user', content: 'Balas JSON: {"action":"HOLD","confidence":0.5,"reasoning":"test ok"}' }],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const status = response.status;
    const text = await response.text();
    res.json({ success: response.ok, model: modelToTest, status, response: text.slice(0, 600) });
  } catch (e) {
    res.status(500).json({ success: false, model: modelToTest, error: e.message });
  }
});

// List model Groq yang tersedia
app.get('/api/list-models', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${GROQ_API_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return res.status(500).json({ success: false, error: `HTTP ${r.status}` });
    const data = await r.json();
    const models = (data.data || []).map(m => ({ id: m.id, context: m.context_window }));
    res.json({ success: true, count: models.length, models });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/backtest', requireAuth, async (req, res) => {
  try {
    const interval = req.query.interval || '15m';
    const limit = parseInt(req.query.limit) || 500;
    const klines = await fetchKlines(SYMBOL, interval, limit);
    if (!klines) return res.json({ success: false, message: 'Gagal fetch klines' });
    const slMult = parseFloat(req.query.sl) || dynamicParams.atrSlMult;
    const tpMult = parseFloat(req.query.tp) || dynamicParams.atrTpMult;
    const result = backtestStrategy(klines, { slMult, tpMult });
    lastBacktest = result ? { ...result, interval, limit, timestamp: new Date().toLocaleTimeString('id-ID') } : null;
    res.json({ success: true, result: lastBacktest });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/reset-params', requireAuth, (req, res) => {
  dynamicParams = { atrSlMult: 1.5, atrTpMult: 2.5, minAlignment: 70, minConfidence: 0.65, kellyFraction: 0.25 };
  res.json({ success: true, message: 'Params direset', params: dynamicParams });
});

app.get('/api/add-event', requireAuth, (req, res) => {
  const { date } = req.query;
  if (!date) return res.json({ success: false, message: 'Butuh date=YYYY-MM-DD' });
  if (!HIGH_IMPACT_EVENTS.includes(date)) HIGH_IMPACT_EVENTS.push(date);
  res.json({ success: true, events: HIGH_IMPACT_EVENTS });
});

app.get('/api/reset', requireAuth, (req, res) => {
  isBotRunning = false;
  if (botInterval) { clearInterval(botInterval); botInterval = null; }
  virtualBalance = 10000; activeTrades = []; tradeHistory = []; priceHistory = [];
  marketMemory = []; cycleCount = 0; cumulativeFee = 0; cumulativeTrades = 0;
  geminiSuccessCount = 0; geminiFailCount = 0; geminiSkipCount = 0; consecutiveFailures = 0;
  lastCloseEvent = null; serverLogs = {};
  dailyStartBalance = 10000; dailyStartDate = new Date().toDateString();
  dailyPnl = 0; dailyTrades = 0;
  consecutiveLosses = 0; consecutiveWins = 0;
  peakBalance = 10000; maxDrawdown = 0; allPnls = [];
  patternStats = { bySignature: {}, bySession: { ASIA: { wins: 0, losses: 0 }, LONDON: { wins: 0, losses: 0 }, NY: { wins: 0, losses: 0 } }, byRegime: {} };
  confidenceCalibration = { low: { wins: 0, losses: 0 }, mid: { wins: 0, losses: 0 }, high: { wins: 0, losses: 0 } };
  ensembleStats = { trend_follower: { wins: 0, losses: 0 }, mean_reverter: { wins: 0, losses: 0 }, momentum: { wins: 0, losses: 0 }, breakout: { wins: 0, losses: 0 }, order_flow: { wins: 0, losses: 0 } };
  dynamicParams = { atrSlMult: 1.5, atrTpMult: 2.5, minAlignment: 70, minConfidence: 0.65, kellyFraction: 0.25 };
  geminiCache = { decision: null, price: 0, regime: '', rsiBand: '', alignmentBand: '', timestamp: 0 };
  quotaCooldown = { active: false, until: 0, hits: 0 };
  dailyGeminiRequests = 0;
  hourlyRequests = [];
  res.json({ success: true, message: 'State direset.' });
});

app.get('/api/bot-status', (req, res) => {
  res.json({
    running: isBotRunning,
    data: serverLogs,
    state: {
      virtualBalance, activeTradesCount: activeTrades.length,
      isExecutingCycle, consecutiveFailures, geminiStatus: lastGeminiStatus,
      dynamicParams,
      groqModels: {
        primary: GROQ_MODELS_PRIMARY,
        fallback: GROQ_MODELS_FALLBACK
      },
      geminiStats: {
        success: geminiSuccessCount, fail: geminiFailCount, skip: geminiSkipCount,
        dailyRequests: dailyGeminiRequests, dailyLimit: DAILY_REQUEST_LIMIT,
        hourlyCount: hourlyRequests.length, hourlyLimit: MAX_REQUESTS_PER_HOUR,
        cooldown: quotaCooldown.active ? {
          active: true,
          until: new Date(quotaCooldown.until).toLocaleTimeString('id-ID'),
          remainingMs: Math.max(0, quotaCooldown.until - Date.now()),
          hits: quotaCooldown.hits
        } : { active: false }
      },
      ensembleStats, confidenceCalibration, lastBacktest
    }
  });
});

process.on('SIGINT', () => {
  isBotRunning = false;
  if (botInterval) clearInterval(botInterval);
  process.exit(0);
});

app.listen(port, () => {
  console.log(`═══════════════════════════════════════════════`);
  console.log(`  Orion v5 — GROQ MODE`);
  console.log(`═══════════════════════════════════════════════`);
  console.log(`Loop: ${LOOP_INTERVAL_MS / 60000} menit`);
  console.log(`Groq endpoint: ${GROQ_API_BASE}`);
  console.log(`Model utama: ${GROQ_MODELS_PRIMARY.join(', ')}`);
  console.log(`Fallback: ${GROQ_MODELS_FALLBACK.join(', ')}`);
  console.log(`Daily request limit: ${DAILY_REQUEST_LIMIT}`);
  console.log(`Cache TTL: ${CACHE_TTL_MS / 60000} menit`);
  console.log(`Live broker: ${ENABLE_LIVE_BROKER ? '⚠️ AKTIF' : 'simulasi'}`);
  console.log(`Telegram: ${TELEGRAM_ENABLED ? '✅' : '❌'}`);
  console.log(`Test endpoint: /api/test-ai?key=<KEY>`);
  console.log(`List models: /api/list-models?key=<KEY>`);
  console.log(`═══════════════════════════════════════════════`);
});
