# IG Video Control — 開發筆記

## 專案概覽

Tampermonkey userscript，為 Instagram 影片加上全螢幕按鈕並自動取消靜音。

- **檔案**：`/home/wsl/tampermonkey-scripts/ig-video-control.js`
- **GitHub**：`https://github.com/starjou/tampermonkey-scripts`
- **目前版本**：v1.31

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
        div[role="button"]                          ← 靜音按鈕（mute toggle）
```

**關鍵**：`div[role="presentation"]` 可能是 `position:absolute` 全版遮擋，導致插在其 sibling 位置的按鈕點不到。`div[role="slider"]` 是直立的 volume slider，內部的子元素可能是 `position:absolute`（這就是為什麼雖然 container 是 flex-row，兩個 div 卻疊在一起）。

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

```javascript
function attachFSBtnToVideo(v, btnId, muteBtn, onFSClick, extraBtnClass) {
    if (document.getElementById(btnId)) return;
    if (videoHasFSBtn(v)) return;

    // 建立 button...

    if (muteBtn?.parentElement) {
        const slider = muteBtn.closest('[role="slider"]');
        if (slider?.parentElement) {
            // 新結構：slider 內的 mute button
            // v1.31：用 position:absolute 掛在 slider 的 parent，不破壞 slider 內部 layout
            const p = slider.parentElement;
            if (p.querySelector('.ig-fs-btn')) return;
            if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
            btn.style.cssText = 'position:absolute;bottom:8px;right:44px;z-index:9999;visibility:visible;';
            p.appendChild(btn);
            return;
        }
        // 舊結構：直接插在 mute button 前面，把 parent 設成 flex
        const p = muteBtn.parentElement;
        if (p.querySelector('.ig-fs-btn')) return;
        p.style.display = 'flex'; p.style.flexDirection = 'row';
        p.style.alignItems = 'center'; p.style.gap = '4px';
        if (!location.href.includes('/reels/')) btn.style.marginRight = '-10px';
        p.insertBefore(btn, muteBtn);
        return;
    }
    // Fallback：absolute in videoParent
}
```

**待確認**：v1.31 用 `bottom:8px; right:44px` 作為座標，但尚未確認 slider 內部 children 的 `position` 是否為 `absolute`。如果 inner container 的 children 都是 `position:absolute`，則 flex-row 對它們沒有作用，這就是「flex container 裡面兩個 div 卻疊在一起」的原因。

---

## 三種 Video 類型

| 類型 | 頁面 | function |
|------|------|----------|
| T0 | 首頁 `/` (feed) | `setupType0Video` |
| T1 | `/p/xxxxx` 或 `/reel/xxxxx` (modal) | `setupType1Video` |
| T2 | `/reels/` (連續 reels 介面) | `setupType2Video` |

T1 button 有額外 class `ig-fs-btn-t1`（深色背景），T0/T2 沒有。

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

`findMuteBtn` 的 slider 路徑（v1.29 新增）：
```javascript
const slider = root?.querySelector('[aria-label="調整音量"], [aria-label="Volume"]');
if (slider) {
    const btn = slider.closest('[role="button"]')   // 舊結構：slider 外面有 role=button
             || slider.querySelector('[role="button"]'); // 新結構：mute button 在 slider 裡面
    if (btn) return btn;
}
```

---

## 未解決 / 待觀察

1. **v1.31 位置問題**：`bottom:8px; right:44px` 是猜測值，尚未確認是否正確。需要 user 測試後回饋。
2. **slider inner children `position:absolute`**：待 DevTools 確認。若是，則 v1.30 的插入方式（flex container 裡插 button）確實無法對齊，解法是讓 FS button 也用 `position:absolute` 並定位在 mute button 旁。
3. **按鈕偶爾消失**：IG React re-render controls 時移除我們的按鈕，靠 polling 補回，但 1.5s 內有空窗。
