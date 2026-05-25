// ==UserScript==
// @name         Facebook 防自動重整
// @namespace    https://www.jk-web.com/
// @version      1.2
// @description  防止 Facebook 切換分頁或關閉全屏 Reel 後自動重新整理
// @author       Jacky Jou
// @match        https://www.facebook.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-no-refresh.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-no-refresh.js
// ==/UserScript==

(function () {
    'use strict';

    // 攔截屬性讀取，讓 Facebook 永遠以為分頁可見
    Object.defineProperty(document, 'hidden', {
        get: () => false,
    });
    Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
    });

    // 同時攔截事件，防止事件觸發的 refresh
    document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    window.addEventListener('focus', e => e.stopImmediatePropagation(), true);
    window.addEventListener('blur', e => e.stopImmediatePropagation(), true);

    // 阻止程式化的 location.reload()，防止 Reel 全屏關閉後觸發重整
    Object.defineProperty(Location.prototype, 'reload', {
        value: function () {},
        configurable: true,
        writable: true,
    });
})();
