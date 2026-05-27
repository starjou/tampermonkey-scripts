// ==UserScript==
// @name         Facebook 防自動重整
// @namespace    https://www.jk-web.com/
// @version      1.9
// @description  防止 Facebook 切換分頁後自動重新整理
// @author       Jacky Jou
// @match        https://www.facebook.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-no-refresh.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-no-refresh.js
// ==/UserScript==

(function () {
    'use strict';

    // 儲存原始 getter，用於判斷分頁是否真的被隱藏（切換分頁 vs 頁面內事件）
    const _realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get;

    // 讓 Facebook 永遠以為分頁可見
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });

    // 精準攔截 visibilitychange：
    //   真實的分頁切換（hidden = true / 恢復 visible）→ 攔截，Facebook 看不到
    //   頁面仍可見時的 synthetic event（Reel 關閉等）→ 放行，讓 Facebook 正常處理
    let _hiddenByTabSwitch = false;
    document.addEventListener('visibilitychange', (e) => {
        const reallyHidden = _realHidden.call(document);

        if (reallyHidden) {
            // 分頁剛被切走 → 攔截
            _hiddenByTabSwitch = true;
            e.stopImmediatePropagation();
        } else if (_hiddenByTabSwitch) {
            // 從切換分頁恢復 → 攔截（這次也要擋住才能防止重整）
            _hiddenByTabSwitch = false;
            e.stopImmediatePropagation();
        }
        // else：頁面全程可見（如 Reel 關閉的 synthetic event）→ 放行
    }, true);
})();
