# TamperMonkey Scripts

個人用 TamperMonkey 使用者腳本集，針對社群媒體影片播放體驗進行增強。

## Scripts

### IG Video Control
**檔案：** `ig-video-control.js`<br>
**適用：** https://www.instagram.com/*<br>
**功能：**
- 在 Instagram 影片（貼文、Reel）加上全螢幕按鈕
- 自動取消靜音

### Facebook Video Control
**檔案：** `facebook-video-control.js`<br>
**適用：** https://www.facebook.com/reel/*<br>
**功能：**
- 自動取消靜音
- 在 Reels 控制列加上倒轉 5 秒／快轉 5 秒／全螢幕按鈕（樣式沿用 FB 原生按鈕）
- 全螢幕時使用 Chrome 原生播放器控制列，並額外疊上一組快轉／倒轉按鈕（滑鼠靜止後自動淡出）

### Facebook 防自動重整
**檔案：** `facebook-no-refresh.js`<br>
**適用：** https://www.facebook.com/*<br>
**功能：**
- 防止切回 Facebook 分頁時動態牆自動刷新
- 註：長時間閒置後被 Chrome「記憶體節省模式」丟棄的分頁，切回來時的重新載入無法由腳本阻擋，需關閉該模式

### Ad Overlay Blocker
**檔案：** `ad-blocker.user.js`（殼）、`ad-blocker.js`（邏輯）<br>
**適用：** 所有網站<br>
**功能：**
- 阻擋影片上的廣告 overlay，讓點擊穿透至 video 元素
- 封鎖 `window.open` 廣告跳轉
- 攔截網站注入的假 click 事件，防止觸發全螢幕

### MSN 新聞跳轉至原始出處
**檔案：** `msn-redirect.js`<br>
**適用：** https://www.msn.com/zh-tw/news/*<br>
**功能：**
- MSN 新聞頁面自動跳轉至原始新聞來源網站

### TRC20 測試地址產生器
**檔案：** `trc20-test-address-generator.js`<br>
**適用：** 所有網站（預設僅 `localhost`，可自訂）<br>
**功能：**
- 一鍵生成格式與 checksum 皆合法的 TRC20 測試地址（純隨機，不對應任何真實私鑰），用於前端表單測試
- 自動填入目前焦點欄位並複製到剪貼簿
- 透過 Tampermonkey 選單自訂啟用的網址清單（比對網址是否包含關鍵字，輸入 `*` 可全站啟用）

### YouTube 自動隱藏片尾推薦畫面
**檔案：** `youtube-endscreen-autohide.js`<br>
**適用：** https://www.youtube.com/watch*<br>
**功能：**
- 影片片尾推薦畫面（endscreen cards）出現時自動點擊「隱藏」
- 仍可手動點「顯示」叫回來

### 萬用網頁自動朗讀
**檔案：** `web-tts-reader.js`<br>
**適用：** 所有網站（實際只在自己設定過的網址規則上作用）<br>
**功能：**
- 用瀏覽器的語音朗讀網頁正文，一頁讀完自動載入下一頁接著讀（網址也跟著換，重新整理能接著讀）
- 每個網站用點選方式設定一次：正文區塊、下一頁連結、要略過的段落（CSS 選擇器可自動產生，有預覽可先確認）
- 下一頁可選「直接下載」或「隱藏頁框」載入（網站用 JS 處理文字時用後者），會自己判斷 Big5／GBK 編碼
- 可調語速、每次送出的字數（段落間停頓）、聲音；朗讀中的段落會反白，點段落可從那裡開始，空白鍵播放／暫停
- 規則存在 Tampermonkey 儲存空間，可在「管理所有網站規則」匯出／匯入 JSON
- 朗讀忽然停住時，可用 Tampermonkey 選單的「🩺 複製診斷紀錄」倒出事件時間軸（含 onstart／onend／onerror、換頁、背景切換）
- 註：Edge 內建的中文 Natural 語音品質最好；其他瀏覽器沒有 Natural 語音或完全沒有語音時，面板會提示改用 Edge

## 安裝方式

### 手動安裝
1. 安裝 [Tampermonkey](https://www.tampermonkey.net/)
2. 點擊下方連結，Tampermonkey 會自動偵測並提示安裝：
   - [IG Video Control](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ig-video-control.js)
   - [Facebook Video Control](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-video-control.js)
   - [Facebook 防自動重整](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-no-refresh.js)
   - [Ad Overlay Blocker](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ad-blocker.user.js)
   - [MSN 新聞跳轉至原始出處](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/msn-redirect.js)
   - [TRC20 測試地址產生器](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/trc20-test-address-generator.js)
   - [YouTube 自動隱藏片尾推薦畫面](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/youtube-endscreen-autohide.js)
   - [萬用網頁自動朗讀](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/web-tts-reader.js)

### 自動更新
腳本內含 `@updateURL`，Tampermonkey 會定期檢查版本並自動更新。
