// ==UserScript==
// @name         MSN 新聞跳轉至原始出處
// @namespace    https://www.jk-web.com/
// @version      3.0
// @description  MSN 新聞頁面自動跳轉至原始新聞來源網站
// @author       Jacky Jou
// @match        https://www.msn.com/zh-tw/news/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/msn-redirect.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/msn-redirect.js
// ==/UserScript==

(function() {
    'use strict';

    document.documentElement.style.opacity = '0.0001'; // 不能是 0，MSN 會判定為不可見而延後渲染

    let done = false;
    function tryRedirect() {
        if (done) return true;
        const canonical = document.querySelector('link[rel="canonical"]')?.href;
        if (canonical) {
            done = true;
            if (!canonical.includes('msn.com')) {
                location.replace(canonical);
            } else {
                document.documentElement.style.opacity = '1';
            }
            return true;
        }
        return false;
    }

    if (!tryRedirect()) {
        const interval = setInterval(() => {
            if (tryRedirect()) clearInterval(interval);
        }, 300);

        setTimeout(() => {
            if (!done) {
                done = true;
                clearInterval(interval);
                document.documentElement.style.opacity = '1';
            }
        }, 3000);
    }
})();
