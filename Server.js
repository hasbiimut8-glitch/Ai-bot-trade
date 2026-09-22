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
app.use(express.static(path.join(__dirname, 'public'))); // Mengaktifkan folder public agar index.html bisa diakses

// Endpoint API bot trading
app.get('/api/run-bot', async (req, res) => {
    try {
        const marketRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
        const marketData = await marketRes.json();
        const btcPrice = marketData.bitcoin.usd;
        const btcChange = marketData.bitcoin.usd_24h_change.toFixed(2);

        const prompt = `Bertindaklah sebagai analis trading profesional. Harga Bitcoin saat ini adalah $${btcPrice} dengan perubahan 24 jam sebesar ${btcChange}%. Berikan analisis singkat apakah ini waktu yang bagus untuk Beli (Buy), Jual (Sell), atau Tunggu (Hold), beserta alasannya dalam 2-3 kalimat.`;

        const aiResponse = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
        });

        res.json({
            success: true,
            price: btcPrice,
            change: btcChange,
            analysis: aiResponse.text,
            timestamp: new Date().toLocaleTimeString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server berjalan di port ${port}`);
});
