// 💡 在 server.js 開頭引入
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/download', async (req, res) => {
    const targetUrl = req.body.url;
    if (!targetUrl) return res.status(400).json({ error: '未提供網址' });

    let isClientConnected = true;
    res.on('close', () => {
        console.log('🛑 用戶端中斷連線');
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
        
        let chapters = [];
        links.forEach(link => {
            const href = link.getAttribute('href')?.trim() || '';
            const text = link.textContent?.trim() || '';
            if (href && text && !href.includes('javascript:') && !text.includes('首頁')) {
                chapters.push({ title: text, url: href.startsWith('http') ? href : new URL(href, targetUrl).href });
            }
        });

        if (chapters.length === 0) return res.status(404).json({ error: '找不到章節' });

        // 設定串流 Headers
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="novel.txt"');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.write(`=== 小說打包開始 (共 ${chapters.length} 章) ===\n\n`);

        // === 【步驟 B：小批次並行爬取（優化核心）】 ===
        // 以前是一章一章等（1.5秒），現在改為「一次同時抓 3 章」，抓完再集體休息 2 秒。
        // 這樣既能保持對小說網站的禮貌，又能釋放 Node.js 的排隊壓力！
        const BATCH_SIZE = 3; 

        for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
            if (!isClientConnected) break;

            // 切出這一批次要抓的章節（例如第 1, 2, 3 章）
            const batch = chapters.slice(i, i + BATCH_SIZE);
            
            // 同時發送這一組的請求
            const batchPromises = batch.map(async (ch, index) => {
                const globalIndex = i + index + 1;
                console.log(`📥 正在下載 (${globalIndex}/${chapters.length}): ${ch.title}`);
                try {
                    const chResponse = await axios.get(ch.url, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                    });
                    const chDom = new JSDOM(chResponse.data);
                    const content = chDom.window.document.querySelector('.chapter-detail .content')?.textContent.trim() || '找不到內文';
                    return `\n\n=== ${ch.title} ===\n\n${content}\n`;
                } catch (err) {
                    return `\n\n=== ${ch.title} ===\n\n[下載失敗: ${err.message}]\n`;
                }
            });

            // 等這一批（3章）都抓完
            const results = await Promise.all(batchPromises);
            
            // 寫入前端（前端進度條會一次跳 3 章，體驗很流暢）
            results.forEach(text => res.write(text));

            // 批次間的安全間隔，防禦小說網站封鎖
            await delay(2000); 
        }

        if (isClientConnected) {
            res.write(`\n\n=== 全書打包完成 ===\n`);
            res.end();
        }

    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ error: error.message });
        else res.end();
    }
});

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

    // 💡 建立一個變數，用來記錄前端是否已經斷開連線
    let isClientConnected = true;
    res.on('close', () => {
        console.log('🛑 偵測到用戶端切斷連線（可能按了停止或關閉網頁）');
        isClientConnected = false;
    });

    try {
        // === 【步驟 A：抓取目錄頁並找到真正的章節連結】 ===
        const mainResponse = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        const mainDom = new JSDOM(mainResponse.data);
        const doc = mainDom.window.document;

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

        // 提早發送 Headers
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="novel_download.txt"');
        res.setHeader('Transfer-Encoding', 'chunked'); 

        res.write(`=== 小說打包開始 (共 ${chapters.length} 章) ===\n\n`);

        // === 【步驟 B：一章一章下載內文】 ===
        for (let i = 0; i < chapters.length; i++) {
            
            // 🔥 【核心防線】在每章爬取前，先檢查前端是否還在線。如果已經斷線，立刻終止 for 迴圈！
            if (!isClientConnected) {
                console.log(`跳出迴圈：停止在第 ${i + 1} 章，不再繼續爬取。`);
                break;
            }

            const ch = chapters[i];
            console.log(`正在下載並串流 (${i + 1}/${chapters.length}): ${ch.title}`);

            try {
                const chResponse = await axios.get(ch.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                
                const chDom = new JSDOM(chResponse.data);
                const chDoc = chDom.window.document;

                const articleBody = chDoc.querySelector('.chapter-detail .content');
                
                let pureText = '';
                if (articleBody) {
                    pureText = articleBody.textContent.trim();
                } else {
                    pureText = `（系統回報：這一個章節的網頁骨架裡，找不到指定的內文箱子。）`;
                }

                res.write(`\n\n=== ${ch.title} ===\n\n${pureText}\n`);

            } catch (error) {
                console.error(`下載 ${ch.title} 失敗:`, error.message);
                res.write(`\n\n=== ${ch.title} ===\n\n[這一章下載失敗了，原因：${error.message}]\n`);
            }

            await delay(1500);
        }

        // === 【步驟 C：正式關閉連線】 ===
        // 只有在連線還活著的時候才呼叫 res.end()
        if (isClientConnected) {
            console.log('🎁 所有章節串流完畢，通知裝置封包下載！');
            res.write(`\n\n=== 全書打包完成 ===\n`);
            res.end(); 
        }

    } catch (error) {
        console.error('後端發生錯誤:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: '伺服器內部錯誤: ' + error.message });
        } else {
            res.end();
        }
    }
});

// 啟動伺服器 (將兩個 listen 合併為一個，並綁定到 0.0.0.0 以利雲端部署)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🤖 小說打包機器人後端已在通訊埠 ${PORT} 啟動！`);
});