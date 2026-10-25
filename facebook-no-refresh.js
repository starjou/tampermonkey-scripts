// ==UserScript==
// @name         Facebook 防自動重整
// @namespace    https://www.jk-web.com/
// @version      2.0
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

    // 切回分頁時的刷新是 FB 在頁面內重新渲染（不是整頁 reload），而且兩條路都會觸發：
    //   document 的 visibilitychange，以及 window 的 focus / blur。
    // 實測只擋其中一種都還是會刷新，兩種一起擋才不會。

    // FB 主動讀狀態時也要以為分頁一直可見、一直有焦點
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });

    // 掛在 window capture：事件路徑是 window → document → …，這是最早攔得到的位置，
    // 而且在 document-start 註冊，排在 FB 所有 listener 前面
    function block(e) {
        // FB 自己 dispatchEvent 出來的 synthetic event 放行。
        // 關閉 Reel 時 FB 會發一個 visibilitychange 當作回到 feed 的訊號，擋掉會整頁重建（v1.8 的教訓）
        if (!e.isTrusted) return;
        // 輸入框、連結的 focus / blur 也會經過 window capture，那些是正常互動，不能擋；
        // 只擋分頁/視窗本身的（focus/blur 的 target 是 window，visibilitychange 的是 document）
        if (e.target !== window && e.target !== document) return;
        e.stopImmediatePropagation();
    }
    ['visibilitychange', 'focus', 'blur'].forEach((type) => window.addEventListener(type, block, true));
})();
