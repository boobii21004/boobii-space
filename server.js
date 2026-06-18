const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 讓前端網頁可以順利跟後端通訊 (解決跨網域問題)
app.use(cors());
app.use(express.json());

// 讓程式休息一下的魔法
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 核心功能：接收前端傳來的網址，並進行打包
app.post('/download', async (req, res) => {
    const targetUrl = req.body.url;
    
    if (!targetUrl) {
        return res.status(400).json({ error: '未提供網址' });
    }

    console.log(`🚀 收到打包請求，目標網址: ${targetUrl}`);

    try {
        // === 【步驟 A：抓取目錄頁並找到真正的章節連結】 ===
        // 用 axios 取代原本的瀏覽器環境環境，抓取小說主頁 HTML
        const mainResponse = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        // 用 JSDOM 取代原本瀏覽器的 DOMParser 與 document
        const mainDom = new JSDOM(mainResponse.data);
        const doc = mainDom.window.document;

        // 🌟 使用你原本定義的精準目錄箱子名字
        const links = doc.querySelectorAll('.chapter-list li a');
        let chapters = [];

        links.forEach(link => {
            const href = link.getAttribute('href') ? link.getAttribute('href').trim() : '';
            const text = link.textContent ? link.textContent.trim() : '';

            // 處理相對路徑網址（如果小說狂人的連結是 /n/xxxx/xxx，要把域名補上）
            // 💡 使用 new URL(相對路徑, 基礎網址) 自動完美補全網址，不論它怎麼變都不會拼錯！
let url = '';
try {
    if (href.startsWith('http')) {
        url = href;
    } else {
        url = new URL(href, targetUrl).href;
    }
} catch (e) {
    url = href;
}

            if (url.startsWith('http') && text.length > 0) {
                const isNoise = url.includes('javascript:') || 
                                url.includes('#') || 
                                text.includes('首頁') || 
                                text.includes('聯絡') || 
                                text.includes('關於');

                if (!isNoise) {
                    chapters.push({ title: text, url: url });
                }
            }
        });

        if (chapters.length === 0) {
            return res.status(404).json({ error: '在目錄頁找不到任何有效的章節連結。' });
        }

        console.log(`🔍 總共找到 ${chapters.length} 個章節，開始逐章下載...`);

        let bookContent = '';

        // === 【步驟 B：一章一章下載內文】 ===
        for (let i = 0; i < chapters.length; i++) {
            const ch = chapters[i];
            console.log(`正在下載 (${i + 1}/${chapters.length}): ${ch.title}`);

            try {
                const chResponse = await axios.get(ch.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                
                const chDom = new JSDOM(chResponse.data);
                const chDoc = chDom.window.document;

                // 🌟 使用你原本定義的內文箱子
                const articleBody = chDoc.querySelector('.chapter-detail .content');
                
                let pureText = '';
                if (articleBody) {
                    // 轉成文字，並把 HTML 的 <br> 標籤換成換行符號（視需求而定，textContent 會拿掉所有 HTML）
                    pureText = articleBody.textContent.trim();
                } else {
                    pureText = `（系統回報：這一個章節的網頁骨架裡，找不到指定的內文箱子。）`;
                }

                bookContent += `\n\n=== ${ch.title} ===\n\n${pureText}\n`;

            } catch (error) {
                console.error(`下載 ${ch.title} 失敗:`, error.message);
                bookContent += `\n\n=== ${ch.title} ===\n\n[這一章下載失敗了，原因：${error.message}]\n`;
            }

            // 休息 1.5 秒，當個有禮貌的乖寶寶
            await delay(1500);
        }

        // === 【步驟 C：直接將文字檔案流（Stream）回傳給手機/電腦】 ===
        console.log('🎁 打包完成，正在傳送檔案給裝置...');
        
        // 設定 HTTP 回應標頭，告訴手機瀏覽器「這是一個需要下載的 txt 檔案」
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="novel.txt"');
        
        // 直接將組合好的文字內容送出
        res.send(bookContent);

    } catch (error) {
        console.error('後端發生錯誤:', error.message);
        res.status(500).json({ error: '伺服器內部錯誤: ' + error.message });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`🤖 小說打包機器人後端已在通訊埠 ${PORT} 啟動！`);
});