# Tampermonkey Scripts — 開發筆記

這個 repo 有多支 userscript，以下依腳本分節。目前有詳細筆記的是 IG 與 Facebook 兩支影片控制腳本，其餘腳本較單純，直接看原始碼即可。

---

# IG Video Control

## 專案概覽

Tampermonkey userscript，為 Instagram 影片加上全螢幕按鈕並自動取消靜音。

- **檔案**：`/home/wsl/tampermonkey-scripts/ig-video-control.js`
- **GitHub**：`https://github.com/starjou/tampermonkey-scripts`
- **目前版本**：v1.44

---

## IG DOM 結構重點

### 舊結構（2025 年初）
靜音按鈕是獨立的 `button[aria-label]` 或 `div[role="button"]`，位於 video 旁的 controls overlay 中（與 video 在完全不同的 DOM branch）。

### 新結構（2025 年中 IG 改版後）
靜音按鈕（`div[role="button"]`）被移進了 volume slider widget 裡面：
```
div[data-instancekey][style="visibility:hidden"]   ← controls wrapper（hover 時才顯示）
  div[aria-label="Video player"][role="group"]      ← 整個 video controls overlay
    div[role="presentation"]                        ← 全版蓋板（可能擋住 click）
    div[role="slider"][aria-label="調整音量"]        ← volume slider widget（直立式）
      div (inner container)
        div (volume track bar)
        div[role="button"]                          ← 靜音按鈕（mute toggle），position:absolute
```

**已確認**：
- `div[role="button"]`（mute button）本身是 `position:absolute`，`background: transparent`
- 視覺上的灰黑色圓形背景來自 mute button 的直接父層（`background: rgba(43,48,54,0.8)`）
- `div[role="button"]` 的 `color` 是 `rgb(245,245,245)`，SVG 用 `currentColor` 繼承
- mute button 的 `offsetLeft`/`offsetTop` 都是 0（offsetParent 是緊鄰的小容器，不是 slider.parentElement）

---

## videoHasFSBtn 設計演進

過去幾個版本的核心問題：如何判斷某個 video 是否已有 FS 按鈕，且不產生 cross-context 假陽性（feed 的按鈕被誤認為 modal 的）。

### 目前方案（v1.27+）：`findMuteBtnInContext`
```javascript
function findMuteBtnInContext(v) {
    let root = v.parentElement;
    for (let i = 0; i < 15; i++) {
        if (!root) break;
        if (root.querySelectorAll('video').length > 1) break; // 超過1個video = 已出單篇邊界
        // 找 slider，再找 slider 裡面的 mute button（新結構）
        // 找 button aria-label（舊結構）
        // 找 SVG aria-label（fallback）
        root = root.parentElement;
    }
    return null;
}

function videoHasFSBtn(v) {
    const muteBtn = findMuteBtnInContext(v);
    if (!muteBtn) return false;
    const slider = muteBtn.closest('[role="slider"]');
    return !!((slider?.parentElement ?? muteBtn.parentElement)?.querySelector('.ig-fs-btn'));
}
```

**設計原理**：每往上爬一層就查 `querySelectorAll('video').length`，超過 1 就代表已到多篇文章的共同祖先，停止搜尋。這樣找到的靜音按鈕一定屬於當前 context（不會把 feed 的 mute button 誤認為 modal 的）。

---

## attachFSBtnToVideo 插入邏輯

### 新結構路徑（slider 內的 mute button）

FS button append 到 `slider.parentElement`（`p`），而非 `offsetParent`。原因：`offsetParent` 在 controls overlay 之外，append 過去後 hover 顯示邏輯不會套用，按鈕會看不見。

座標計算用 **double `requestAnimationFrame`** 延遲執行，避免 modal 開啟動畫期間 layout 未穩定導致位置偏移：

```javascript
const p = slider.parentElement;
if (p.querySelector('.ig-fs-btn')) return;
if (window.getComputedStyle(p).position === 'static') p.style.position = 'relative';
p.appendChild(btn);
requestAnimationFrame(() => requestAnimationFrame(() => {
    const mr = muteBtn.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const right  = pr.right - mr.left + 8;   // 8px gap 在 mute button 左邊
    const bottom = pr.bottom - mr.bottom - 1; // 對齊 mute button 底部
    btn.style.cssText = `position:absolute;bottom:${bottom}px;right:${right}px;z-index:9999;visibility:visible;`;
}));
```

**為什麼不用 `offsetLeft`/`offsetTop`**：mute button 的 `offsetLeft`/`offsetTop` 都是 0（offsetParent 是緊鄰的小容器），無法用來算相對於 `p` 的座標。

**為什麼不用 computed style `right`/`bottom`**：mute button 的 `position` 值顯示為 `-52`，若直接讀 CSS `right` 值再加上 button 寬度算位置，因為 `p` 很寬（全頁寬），結果會不穩定。

### 舊結構路徑（standalone mute button）

偵測 mute button 的 `position` 是否為 `absolute`：
- 是：用 `offsetParent` 為基準，讀 computed `right`/`top` 計算座標
- 否：把 parent 設成 flex，`insertBefore` 插在 mute button 前面

### Fallback

沒找到 mute button 時，absolute 定位在 `videoParent`。

---

## FS Button 樣式

```css
.ig-fs-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(43, 48, 54, 0.8);  /* 對齊 mute button wrapper 背景 */
    border: none; border-radius: 50%;
    cursor: pointer; padding: 0;
    color: rgb(245, 245, 245);           /* 對齊 mute button computed color */
}
```

SVG icon 用 `fill="currentColor"` 繼承 `color`。

---

## 三種 Video 類型

| 類型 | 頁面 | function |
|------|------|----------|
| T0 | 首頁 `/` (feed) | `setupType0Video` |
| T1 | `/p/xxxxx` 或 `/reel/xxxxx` (modal) | `setupType1Video` |
| T2 | `/reels/` (連續 reels 介面) | `setupType2Video` |

T1 button 有額外 class `ig-fs-btn-t1`，T0/T2 沒有（v1.44 後樣式已統一，class 差異僅保留向下相容）。

---

## SPA 換頁偵測

```javascript
// 同時 hook pushState 和 replaceState（IG 關閉 modal 時用 replaceState）
history.pushState = function(...args) { _origPushState(...args); t1OnUrlChange(); };
history.replaceState = function(...args) { _origReplaceState(...args); t1OnUrlChange(); };
window.addEventListener('popstate', t1OnUrlChange);
```

`t1OnUrlChange` 在偵測到 URL 回到 `/` 時，會延遲 300/800/1500/3000ms 重新掃描 feed video（因為 IntersectionObserver 不會重新觸發已在 viewport 的 video）。

---

## Polling

每 1500ms 掃一次：
- `/p/` 或 `/reel/`：對所有 T1 video 補 FS 按鈕
- `/`（首頁）：對所有 feed video 補 FS 按鈕

解決 IG 重新 render controls 後按鈕消失的問題。

---

## mute button 搜尋 selectors

```javascript
const MUTE_BTN_SELECTORS = [
    'button[aria-label="切換音效"]', 'button[aria-label="Toggle audio"]',
    'button[aria-label="Mute"]', 'button[aria-label="Unmute"]', 'button[aria-label="Audio"]',
];
const MUTED_SVG_SELECTORS = ['svg[aria-label="已靜音"]', 'svg[aria-label="Muted"]', 'svg[aria-label="Audio is muted"]'];
const PLAYING_SVG_SELECTORS = ['svg[aria-label="正在播放音效"]', 'svg[aria-label="Audio is playing"]'];
```

`findMuteBtn` 的 slider 路徑（v1.45+，新結構優先）：
```javascript
const slider = root?.querySelector('[aria-label="調整音量"], [aria-label="Volume"]');
if (slider) {
    const btn = slider.querySelector('[role="button"]')  // 新結構：mute button 在 slider 裡面（優先）
             || slider.closest('[role="button"]');        // 舊結構：slider 外面有 role=button
    if (btn) return btn;
}
```

---

## v1.45：IG 把整個 video 點擊區也包成 role="button"

2026-07 發現 `/reels/` 頁面（連續滾動介面，DOM 裡同時存在十幾個 video）FS 按鈕沒出現。實測發現 IG 現在連整個 video 的點擊區（507×903 那種大小的容器）都套了 `role="button"`，不再只有 mute toggle 本身有。

`findMuteBtn` / `findMuteBtnInContext` 原本寫 `slider.closest('[role="button"]') || slider.querySelector('[role="button"]')`（先找「包住 slider 的按鈕」＝舊結構，找不到才找「slider 內部的按鈕」＝新結構）。但 `.closest()` 現在會先比對到那個外層的大 video 點擊區容器（它也是 slider 的祖先，也有 `role="button"`），導致抓到錯的「mute button」，FS 按鈕就定位到整個 video 容器的座標系（視覺上跑到很奇怪的位置或看起來像沒出現）。

**修法**：順序反過來，`slider.querySelector('[role="button"]') || slider.closest('[role="button"]')`（新結構優先）。兩處都要改：`findMuteBtn` 和 `findMuteBtnInContext`。

用 Chrome DevTools 在 `/reels/` 頁面實測驗證：`slider.querySelector('[role="button"]')` 抓到 28×28、位置對齊畫面上看到的靜音圖示；`slider.closest('[role="button"]')` 抓到的是 507×903 的整個 video 容器——這差異就是 bug 的直接證據。

---

## 未解決 / 待觀察

1. **按鈕偶爾消失**：IG React re-render controls 時移除我們的按鈕，靠 polling 補回，但 1.5s 內有空窗。
2. **`ig-fs-btn-t1` class**：v1.44 後背景樣式已統一，這個 class 實際上沒有額外效果，可考慮未來移除。

---

# Facebook Video Control

## 專案概覽

Tampermonkey userscript，為 Facebook Reels 的影片自動取消靜音，並在控制列加上快轉／倒轉／全螢幕按鈕，全螢幕時另外疊一組快轉鈕。

- **檔案**：`/home/wsl/tampermonkey-scripts/facebook-video-control.js`
- **目前版本**：v2.14
- **作用範圍**：網址含 `/reel/` 時才動作（`isReelVideo`）

---

## FB DOM 結構重點（2026-08 實測）

靜音鈕那一格的結構：

```
div.x6s0dn4 x6zsckl …                            ← 控制列上的一格，程式裡叫 anchor
  div
    span.html-span …
      div[aria-label="靜音"][role="button"]       ← 靜音鈕本體
        i[data-visualcompletion="css-img"]        ← 圖示，20×20
        div[role="none"][style="inset:0"]         ← FB 的 hover 疊層
```

兩個關鍵事實，都是踩過坑才確認的：

1. **圖示不是 SVG**，是 `<i>` 貼 CSS sprite（`background-image: url(...fbcdn.net/rsrc.php/....webp)` 搭 `background-position` 取圖）。所以 `sndBtn.querySelector('svg')` 永遠是 null，任何想從圖示讀 `fill` / `color` 的作法都會落到 fallback。
2. **圓形背景與尺寸來自 `div[role="button"]` 自己那串原子 class**（`x1i10hfl x1qjc9v5 …`），不是任何祖先的 `background-color`。所以「往上找不透明背景的那一層」找不到東西。

推論：想靠量測 + 自己重寫樣式來對齊 FB 的按鈕，會在尺寸、顏色、背景上輪流失敗。**正解是 clone**。

---

## 按鈕插入策略：clone FB 的節點

`makeCtrlBtn` 做的事：

```javascript
const outer = anchor.cloneNode(true);   // 連 span.html-span、hover 疊層一起複製
outer.classList.add('fb-fs-btn');
outer.style.marginInlineStart = BTN_GAP;   // FB 沒給間距，要自己補
const btn = outer.querySelector('[role="button"]');
btn.setAttribute('aria-label', label);
btn.removeAttribute('aria-pressed');
// 只把 sprite <i> 換成同尺寸的 svg，其餘原封不動
sprite.replaceWith(ourSvgSpan);
```

這樣尺寸、圓形背景、hover 效果全部自動一致，FB 改版也會跟著變。

- 三顆按鈕各自 clone 成 **anchor 的兄弟節點**依序插入，不包在自己的 wrapper 裡。
- 追蹤用 `v._fbFsBtns`（陣列），配 `removeOurBtns` / `ourBtnsAlive`。
- clone 出來的節點沒有 React fiber，FB 的委派事件不會認它。

**踩過的雷**：`insertFSBtn` 原本用 `document.getElementById('RequestFullScreen').remove()` 移除舊按鈕。id 是全域唯一的，兩支 reel 同時被 setup 時會互砍，按鈕每輪 polling 閃一次。現在改成只移除該 video 自己的，並檢查同一條控制列上是否已有 `.fb-fs-btn`。

---

## 全螢幕：一定要對 video 本身

```javascript
v.requestFullscreen()   // 不是 container.requestFullscreen()
```

**Chrome 的原生播放器控制列（播放鍵、時間、PiP、三點選單）只有在 `fullscreenElement` 是 video 元素時才會出現。**

改成對容器（`[aria-label="Video player"]`）全螢幕的話會同時壞兩件事：原生控制列不出現，而 FB 自己的控制列因為在容器子樹裡反而被一起帶進全螢幕。曾經為此加了一堆 CSS 去壓容器寬高、蓋掉 FB 控制列，全部是白工——對 video 全螢幕就自然是對的。

---

## 全螢幕內的快轉鈕：popover + 座標比對

兩個限制疊在一起：`<video>` 是 replaced element，子節點不會被渲染；Fullscreen API 只渲染 `fullscreenElement` 的子孫。所以全螢幕時沒有任何一般 DOM 疊得上去。

**唯一的出口是 top layer**：全螢幕元素、modal dialog、popover 都住在那裡，且後進來的畫在上面。所以在 `requestFullscreen()` resolve **之後**才 `showPopover()`，就會蓋在影片和原生控制列之上。用 `popover="manual"` 而不是 `dialog.showModal()`，因為 modal 會讓其餘內容 inert，原生控制列會點不動。

**但 popover 收不到點擊**。實測 log：

```
target=VIDEO  elementFromPoint=VIDEO  命中快轉鈕=true  popoverOpen=true
```

按鈕確實畫在那個座標上，`elementFromPoint` 卻回傳 VIDEO，綁在按鈕上的 listener 一次都沒被觸發。所以點擊改由 `blockClick`（本來就會攔全螢幕內所有 pointer 事件）用 `getBoundingClientRect()` 做落點比對後執行 `btn._run`，不依賴瀏覽器的 hit-testing。

覆蓋層的顯示／隱藏：`mousemove` 重置計時、靜止 2.5s 淡出、滑鼠離開視窗（`mouseout` 且 `relatedTarget` 為 null）立即淡出。隱藏時用 `hidePopover()` 退出 top layer，**不要**只留透明覆蓋層——那會攔掉原生控制列的點擊。

---

## 解靜音與按鈕出現的時機

控制列出現的時間不固定，這是「延遲有時 3、4 秒、有時又沒有」的根因。目前三管齊下：

1. `SETUP_EVENTS = ['loadeddata', 'canplay', 'playing']` 直接綁在 video 上
2. `scheduleRetry`：每 100ms 掃一次，最多 3 秒，掃到就收工
3. polling 每 500ms 補底

`unmute` 的順序有講究：**有 FB 的取消靜音鈕就點它**（讓 FB 內部 state 同步，否則 re-render 會把 `muted` 蓋回 true），沒有才退而求其次直接設 `v.muted = false`。用 `_fbFsUnmuted` 記錄「FB 按鈕已點過」，避免重試變密之後重複點擊把聲音又 toggle 回去。

（曾經寫成先 `if (v.muted) v.muted = false;` 再 `if (v.muted && btn) btn.click();`——第二個條件永遠不成立，FB 的按鈕從來沒被點過。）

---

## 效能：捲動卡頓

`isReelVideo` **必須包含「在 viewport 內」的判斷**，`scheduleRetry` 的 tick 也要在捲出畫面時立刻收工。否則快速捲動時，每支經過的 reel 都會各自跑滿 3 秒的 100ms 重試，好幾組同時往上爬 10 層做 `querySelector`，捲動就會明顯頓（實測確認是本腳本造成的）。

`findCtrlBtns` 一次查完「靜音」和「取消靜音」兩個 label 並共用結果；先前兩個 label 各爬一次祖先，白做一倍的工。

---

## DEBUG

`const DEBUG` 開成 `true` 之後會印：

- 每支 video 的解靜音 / 重試 / 插入按鈕的時間點
- `[fbvc] blockClick <type>`：全螢幕內每個 pointer 事件的 `target`、`elementFromPoint`、是否命中快轉鈕、popover 是否開著（**log 放在 `target !== 'VIDEO'` 早退之前**，否則「沒有 log」會同時代表「沒收到事件」和「收到但早退」兩種情況，無法判讀）
- `[fbvc] 每秒次數`：`setupVideo` / `insertFSBtn` 的呼叫頻率，用來判斷卡頓是不是本腳本造成的

⚠ 在 Tampermonkey 裡改 `DEBUG` 只會影響**當時安裝的那份**。曾經因為 repo 檔案已經加了新的 log、但安裝的是舊版，導致「沒有 log」被誤判成證據。改 DEBUG 請連同整份檔案一起重貼。

---

## 未解決 / 待觀察

1. **兩支影片同時被解靜音**：捲動時相鄰的 reel 短暫進入 viewport 也會被處理。目前沒觀察到聲音重疊（可能 FB 自己會暫停非當前影片），先觀察。
2. **按鈕偶爾消失**：FB re-render 控制列時會移除我們的節點，靠 500ms polling 補回。
