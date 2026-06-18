// 讓程式休息一下的魔法
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startScraping() {
  chrome.runtime.sendMessage({ type: 'STATUS', text: '特工已潛入網頁，正在搜集目錄...' });

  // === 【步驟 A：找到真正的章節連結】 ===
  // 🌟 這裡使用我們測試出來的精準目錄箱子名字
  const links = document.querySelectorAll('.chapter-list li a');
  let chapters = [];

  links.forEach(link => {
    const url = link.href ? link.href.trim() : '';
    const text = link.innerText ? link.innerText.trim() : '';

    if (url.startsWith('http') && text.length > 0) {
      const isNoise = url.includes('javascript:') || 
                      url.includes('#') || 
                      text.includes('首頁') || 
                      text.includes('聯絡') || 
                      text.includes('關於');

      if (!isNoise) {
        chapters.push({
          title: text,
          url: url
        });
      }
    }
  });

  // 如果一個連結都沒抓到，提早自首
  if (chapters.length === 0) {
    chrome.runtime.sendMessage({ type: 'STATUS', text: '❌ 糟糕！在目錄頁找不到任何有效的章節連結。' });
    return;
  }

  
  const testChapters = chapters;
  chrome.runtime.sendMessage({ type: 'STATUS', text: `總共找到 ${chapters.length} 個連結！先測試前 ${testChapters.length} 章...` });

  let bookContent = '';

  // === 【步驟 B：一章一章下載內文】 ===
  for (let i = 0; i < testChapters.length; i++) {
    const ch = testChapters[i];
    chrome.runtime.sendMessage({ type: 'STATUS', text: `正在下載 (${i+1}/${testChapters.length}): ${ch.title}` });

    try {
      console.log(`特工正在嘗試前往：${ch.url}`);

      const response = await fetch(ch.url);
      if (!response.ok) {
        throw new Error(`網頁回應錯誤代碼: ${response.status}`);
      }

      const htmlText = await response.text();

      // 🌟 關鍵在這裡！在這裡定義 doc，後面的 code 才能順利使用它！
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');

      // 🌟 這裡就是你剛剛檢查過、完全正確的抓取區塊
      const articleBody = doc.querySelector('.chapter-detail .content');
      
      let pureText = '';
      if (articleBody) {
        pureText = articleBody.innerText.trim();
      } else {
        console.error(`❌ 糟糕！在內文網頁中找不到 .chapter-detail .content 箱子！`);
        pureText = `（特工回報：這一個章節的網頁骨架裡，找不到指定的內文箱子。）`;
      }

      // 把這一章的標題和內容存起來
      bookContent += `\n\n=== ${ch.title} ===\n\n${pureText}\n`;

    } catch (error) {
      console.error(`下載 ${ch.title} 失敗，原因:`, error);
      bookContent += `\n\n=== ${ch.title} ===\n\n[這一章下載失敗了，原因：${error.message}]\n`;
    }

    // 休息 1.5 秒，當個有禮貌的乖寶寶
    await delay(1500);
  }

  // === 【步驟 C：把結果做成檔案下載】 ===
  chrome.runtime.sendMessage({ type: 'STATUS', text: '🎁 正在將文字打包成檔案...' });
  
  const blob = new Blob([bookContent], { type: 'text/plain;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  
  const downloadLink = document.createElement('a');
  downloadLink.href = blobUrl;
  downloadLink.download = '小說.txt';
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);

  chrome.runtime.sendMessage({ type: 'STATUS', text: '🎉 打包完成！快去檢查下載資料夾！' });
}

// 啟動特工！
startScraping();