const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const cors = require('cors');

// 全域的延遲工具函式（放在最開頭）
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const app = express();

// 啟用 CORS 與 JSON 解析中間件
app.use(cors());
app.use(express.json());

app.post('/download', async (req, res) => {
    const targetUrl = req.body.url;
    // 接收前端傳來的起始章節索引（預設從 0 開始，也就是第一章）
    const startIndex = parseInt(req.body.startIndex, 10) || 0; 
    
    if (!targetUrl) return res.status(400).json({ error: '未提供網址' });

    let isClientConnected = true;
    res.on('close', () => {
        console.log('🛑 用戶端中斷連線（可能按了停止、關閉網頁或完成該卷下載）');
        isClientConnected = false;
    });

    try {
        // === 【步驟 A：解析目錄】 ===
        const mainResponse = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const mainDom = new JSDOM(mainResponse.data);
        const doc = mainDom.window.document;
        const links = doc.querySelectorAll('.chapter-list li a');
        const bookTitle = doc.title.split('-')[0].trim() || 'novel';
        
        let chapters = [];
        links.forEach(link => {
            const href = link.getAttribute('href')?.trim() || '';
            const text = link.textContent?.trim() || '';
            if (href && text && !href.includes('javascript:') && !text.includes('首頁')) {
                chapters.push({ title: text, url: href.startsWith('http') ? href : new URL(href, targetUrl).href });
            }
        });

        if (chapters.length === 0) return res.status(404).json({ error: '找不到章節' });

        // 如果起始索引已經超出總章節，直接結束
        if (startIndex >= chapters.length) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.write(`=== 全書打包完成 ===\n`);
            return res.end();
        }

        // 設定串流 Headers
        const partNumber = Math.floor(startIndex / 400) + 1;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(bookTitle)}_Part${partNumber}.txt`);
        res.setHeader('Transfer-Encoding', 'chunked');
        
        if (startIndex === 0) {
            res.write(`=== 小說打包開始 (共 ${chapters.length} 章) ===\n\n`);
        } else {
            res.write(`=== 續傳打包開始 (自第 ${startIndex + 1} 章起) ===\n\n`);
        }

        // === 【步驟 B：5章一組並行 + 400章自動截斷】 ===
        const BATCH_SIZE = 5; 
        const MAX_CHAPTERS_PER_REQUEST = 400; // 每接力一次最多抓 400 章
        const endIndex = Math.min(startIndex + MAX_CHAPTERS_PER_REQUEST, chapters.length);

        for (let i = startIndex; i < endIndex; i += BATCH_SIZE) {
            if (!isClientConnected) break;

            const batch = chapters.slice(i, Math.min(i + BATCH_SIZE, endIndex));
            
            const batchPromises = batch.map(async (ch, index) => {
                const globalIndex = i + index + 1;
                console.log(`📥 正在下載 (${globalIndex}/${chapters.length}): ${ch.title}`);
                try {
                    const chResponse = await axios.get(ch.url, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                        timeout: 8000 // 8秒超時防線
                    });
                    const chDom = new JSDOM(chResponse.data);
                    const content = chDom.window.document.querySelector('.chapter-detail .content')?.textContent.trim() || '找不到內文';
                    return `\n\n=== ${ch.title} ===\n\n${content}\n`;
                } catch (err) {
                    console.log(`❌ 第 ${globalIndex} 章抓取失敗: ${err.message}`);
                    return `\n\n=== ${ch.title} ===\n\n[下載失敗: ${err.message}]\n`;
                }
            });

            const results = await Promise.all(batchPromises);
            results.forEach(text => res.write(text));

            await delay(2500); 
        }

        // === 【步驟 C：判定是整本結束，還是需要繼續接力】 ===
        if (isClientConnected) {
            if (endIndex >= chapters.length) {
                res.write(`\n\n=== 全書打包完成 ===\n`);
            } else {
                // 傳遞給前端的自動續傳暗號
                res.write(`\n\n=== 本卷打包結束，請自動續傳，下一章索引:${endIndex} ===\n`);
            }
            res.end();
        }

    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ error: error.message });
        else res.end();
    }
});

// 監聽連接埠（預設 3000 或 Render 提供 Windows/Linux 的 PORT）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 伺服器已成功啟動在 port ${PORT}`);
});