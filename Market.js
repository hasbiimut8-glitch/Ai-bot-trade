import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: 'AQ.Ab8RN6KkAKaKq9epVyDmaL7DPWlj98JlC9kAulmw2TQFimoULA' });

async function getMarketDataAndAnalyze() {
    try {
        console.log("Mengambil data harga pasar terkini...");
        
        // Mengambil data harga Bitcoin dari CoinGecko API publik (gratis & tanpa key)
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
        const data = await res.json();
        
        const btcPrice = data.bitcoin.usd;
        const btcChange = data.bitcoin.usd_24h_change.toFixed(2);
        
        console.log(`Harga BTC saat ini: $${btcPrice} (Perubahan 24j: ${btcChange}%)`);
        console.log("\nMeminta analisis dari Gemini AI...");

        // Kirim data harga ke Gemini untuk dianalisis
        const prompt = `Bertindaklah sebagai analis trading profesional. Harga Bitcoin saat ini adalah $${btcPrice} dengan perubahan 24 jam sebesar ${btcChange}%. Berikan analisis singkat apakah ini waktu yang bagus untuk Beli (Buy), Jual (Sell), atau Tunggu (Hold), beserta alasannya dalam 2-3 kalimat.`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.6-flash',
            contents: prompt,
        });

        console.log("\nAnalisis AI untuk Trading:");
        console.log(response.text);

    } catch (error) {
        console.error("Gagal mengambil data atau menganalisis:", error);
    }
}

getMarketDataAndAnalyze();
