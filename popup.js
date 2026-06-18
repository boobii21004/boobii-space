// 這裡用標準的監聽功能，等網頁畫面全部準備好（DOMContentReady）才接線
document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const statusDiv = document.getElementById('status');

  // 確認有找到按鈕才綁定動作
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      statusDiv.innerText = '🚀 按鈕啟動成功！正在尋找網頁分頁...';

      try {
        // 1. 尋找目前分頁
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
          statusDiv.innerText = '❌ 找不到目前的分頁。';
          return;
        }

        statusDiv.innerText = `🔍 找到網頁！正在派特工進入...`;

        // 2. 派出特工
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['scraper.js']
        });

        statusDiv.innerText = '🕵️‍♂️ 特工已進入網頁，正在努力抓取中...';

      } catch (error) {
        statusDiv.innerText = '❌ 發生錯誤：' + error.message;
      }
    });
  }
});

// 接收來自 scraper.js 特工傳回來的進度回報
chrome.runtime.onMessage.addListener((message) => {
  const statusDiv = document.getElementById('status');
  if (statusDiv && message.type === 'STATUS') {
    statusDiv.innerText = message.text;
  }
});