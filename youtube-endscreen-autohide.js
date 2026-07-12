// ==UserScript==
// @name         YouTube 自動隱藏片尾推薦畫面
// @namespace    https://www.jk-web.com/
// @version      1.3
// @description  片尾推薦畫面出現時自動點「隱藏」，仍可手動點「顯示」叫回來
// @author       Jacky Jou
// @match        https://www.youtube.com/watch*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/youtube-endscreen-autohide.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/youtube-endscreen-autohide.js
// ==/UserScript==

(function () {
    'use strict';

    const HIDE_LABEL_KEYWORDS = ['隱藏', 'Hide'];

    function tryHide() {
        const container = document.querySelector('.ytp-ce-hide-button-container button');
        if (!container) return;
        // 每顆按鈕（每部影片的 endscreen）只自動隱藏一次，避免使用者手動點「顯示」後
        // aria-label 變回「隱藏」又被 MutationObserver 立刻重新觸發點掉
        if (container.dataset.jkAutoHidden === '1') return;
        const label = container.getAttribute('aria-label') || '';
        // 只在按鈕顯示「隱藏片尾資訊卡」（代表目前是顯示狀態）時才自動點
        if (HIDE_LABEL_KEYWORDS.some(k => label.includes(k))) {
            container.click();
            container.dataset.jkAutoHidden = '1';
        }
    }

    const player = document.querySelector('#movie_player') || document.body;
    const observer = new MutationObserver(tryHide);
    observer.observe(player, { childList: true, subtree: true, attributes: true });
})();