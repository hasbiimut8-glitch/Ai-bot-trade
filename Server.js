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

// State / Status Bot di Server Backend
let isBotRunning = false;
let botInterval = null;
let serverLogs = [];

// Endpoint untuk menjalankan bot di server
app.get('/api/start-bot', (req, res) => {
    if (!isBotRunning) {
        isBotRunning = true;
        console.log("🤖 Bot trading otomatis diaktifkan di Server Cloud (24/7 Mode).");
        
        // Loop otomatis setiap 5 detik di server backend
        botInterval = setInterval(async () => {
            try {
                const marketRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
                const marketData = await marketRes.json();
                const btcPrice = marketData.bitcoin.usd;
                const btcChange = marketData.bitcoin.usd_24h_change.toFixed(2);

                const prompt = `Bertindaklah sebagai analis trading profesional. Harga Bitcoin saat ini adalah $${btcPrice} dengan perubahan 24 jam sebesar ${btcChange}%. Berikan analisis singkat apakah ini waktu yang bagus untuk Beli (Buy), Jual (Sell), atau Tunggu (Hold), beserta alasannya dalam 2-3 kalimat.`;

                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash', // Menggunakan model yang stabil
                    contents: prompt,
                });

                const logEntry = {
                    price: btcPrice,
                    change: btcChange,
                    analysis: aiResponse.text,
                    timestamp: new Date().toLocaleTimeString()
                };

                serverLogs.unshift(logEntry);
                if (serverLogs.length > 20) serverLogs.pop(); // Batasi riwayat log server

                console.log(`[Server Trade Loop] BTC: $${btcPrice} | Analisis AI Berhasil`);
            } catch (error) {
                console.error("Error pada loop server:", error.message);
            }
        }, 5000);
    }
    res.json({ success: true, message: "Bot berhasil dijalankan di cloud server!" });
});

// Endpoint untuk menghentikan bot di server
app.get('/api/stop-bot', (req, res) => {
    isBotRunning = false;
    clearInterval(botInterval);
    console.log("⏹ Bot trading server dihentikan.");
    res.json({ success: true, message: "Bot dihentikan." });
});

// Endpoint untuk mengambil data log/status terbaru dari server
app.get('/api/bot-status', (req, res) => {
    res.json({
        running: isBotRunning,
        latestLog: serverLogs[0] || null,
        logs: serverLogs
    });
});

app.listen(port, () => {
    console.log(`Server berjalan di port ${port}`);
});
