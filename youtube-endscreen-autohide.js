// ==UserScript==
// @name         YouTube 自動隱藏片尾推薦畫面
// @namespace    https://www.jk-web.com/
// @version      1.6
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
    const CONTAINER_SELECTOR = '.ytp-ce-hide-button-container button';

    // 「使用者手動點過顯示」的狀態，只在 endscreen 這次出現期間有效；
    // 一旦 endscreen 整個消失（例如退回跳過片尾）再重新出現，就視為全新一次，
    // 不沿用上次的使用者覆寫狀態，讓自動隱藏可以再次生效。
    let containerWasPresent = false;
    let userOverrode = false;

    // 用 isTrusted 分辨「使用者真的點了按鈕」跟「腳本自己呼叫 .click() 產生的合成事件」，
    // 藉此得知使用者是否手動把片尾畫面叫回來，之後就不要再自動把它點隱藏。
    document.addEventListener('click', (e) => {
        if (e.isTrusted && e.target.closest && e.target.closest(CONTAINER_SELECTOR)) {
            userOverrode = true;
        }
    }, true);

    // YouTube 可能全程把這顆按鈕留在 DOM 裡、只靠 CSS 切換可見度（而非增刪節點），
    // 單純 querySelector 找不找得到不能代表片尾畫面「現在有沒有顯示」，要看它是否真的可見。
    function isVisible(el) {
        return !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
    }

    function tryHide() {
        const container = document.querySelector(CONTAINER_SELECTOR);
        if (!isVisible(container)) {
            containerWasPresent = false;
            return;
        }
        if (!containerWasPresent) {
            containerWasPresent = true;
            userOverrode = false;
        }
        if (userOverrode) return;
        const label = container.getAttribute('aria-label') || '';
        // 只在按鈕顯示「隱藏片尾資訊卡」（代表目前是顯示狀態）時才自動點
        if (HIDE_LABEL_KEYWORDS.some(k => label.includes(k))) {
            container.click();
        }
    }

    const player = document.querySelector('#movie_player') || document.body;
    const observer = new MutationObserver(tryHide);
    observer.observe(player, { childList: true, subtree: true, attributes: true });
})();