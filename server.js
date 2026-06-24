const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const cors = require('cors');

const app = express();
// 優先讀取 Render 的環境變數 PORT，如果沒有（例如在本地電腦）才用 3000
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
        const mainResponse = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        const mainDom = new JSDOM(mainResponse.data);
        const doc = mainDom.window.document;

        // 🌟 使用你原本定義的精準目錄箱子名字
        const links = doc.querySelectorAll('.chapter-list li a');
        let chapters = [];

        links.forEach(link => {
            const href = link.getAttribute('href') ? link.getAttribute('href').trim() : '';
            const text = link.textContent ? link.textContent.trim() : '';

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

        console.log(`🔍 總共找到 ${chapters.length} 個章節，開始逐步串流下載...`);

        // 🔥 【重要改動】在這裡提早發送 Headers，啟用分塊串流機制，防止 Render 30 秒超時
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="novel_download.txt"');
        res.setHeader('Transfer-Encoding', 'chunked'); 

        // 先寫入小說開頭訊息
        res.write(`=== 小說打包開始 (共 ${chapters.length} 章) ===\n\n`);

        // === 【步驟 B：一章一章下載內文，並即時回傳給前端】 ===
        for (let i = 0; i < chapters.length; i++) {
            const ch = chapters[i];
            console.log(`正在下載並串流 (${i + 1}/${chapters.length}): ${ch.title}`);

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
                    pureText = articleBody.textContent.trim();
                } else {
                    pureText = `（系統回報：這一個章節的網頁骨架裡，找不到指定的內文箱子。）`;
                }

                // 🔥 改動：不再累加到大變數，而是直接 res.write 吐給前端
                res.write(`\n\n=== ${ch.title} ===\n\n${pureText}\n`);

            } catch (error) {
                console.error(`下載 ${ch.title} 失敗:`, error.message);
                res.write(`\n\n=== ${ch.title} ===\n\n[這一章下載失敗了，原因：${error.message}]\n`);
            }

            // 休息 1.5 秒，當個有禮貌的乖寶寶
            await delay(1500);
        }

        // === 【步驟 C：全部章節傳送完畢，正式關閉連線】 ===
        console.log('🎁 所有章節串流完畢，通知裝置封包下載！');
        res.write(`\n\n=== 全書打包完成 ===\n`);
        res.end(); 

    } catch (error) {
        console.error('後端發生錯誤:', error.message);
        // 如果在還沒發送 Headers 前就崩潰，才可以用 JSON 回傳錯誤
        if (!res.headersSent) {
            res.status(500).json({ error: '伺服器內部錯誤: ' + error.message });
        } else {
            // 如果下載到一半出錯，直接中斷連線
            res.end();
        }
    }
});

// 啟動伺服器 (將兩個 listen 合併為一個，並綁定到 0.0.0.0 以利雲端部署)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🤖 小說打包機器人後端已在通訊埠 ${PORT} 啟動！`);
});