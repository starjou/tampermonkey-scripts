# IG Video Control — 開發筆記

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

`findMuteBtn` 的 slider 路徑：
```javascript
const slider = root?.querySelector('[aria-label="調整音量"], [aria-label="Volume"]');
if (slider) {
    const btn = slider.closest('[role="button"]')    // 舊結構：slider 外面有 role=button
             || slider.querySelector('[role="button"]'); // 新結構：mute button 在 slider 裡面
    if (btn) return btn;
}
```

---

## 未解決 / 待觀察

1. **按鈕偶爾消失**：IG React re-render controls 時移除我們的按鈕，靠 polling 補回，但 1.5s 內有空窗。
2. **`ig-fs-btn-t1` class**：v1.44 後背景樣式已統一，這個 class 實際上沒有額外效果，可考慮未來移除。
