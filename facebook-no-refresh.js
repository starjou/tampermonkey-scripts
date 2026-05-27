// ==UserScript==
// @name         Facebook 防自動重整
// @namespace    https://www.jk-web.com/
// @version      1.5
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

    // ── 阻止程式化的 location.reload() ──────────────────────────────────────
    Object.defineProperty(Location.prototype, 'reload', {
        value: function () {},
        configurable: true,
        writable: true,
    });

    // ── 攔截 location.href = 同 URL（等同 reload）───────────────────────────
    const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    Object.defineProperty(Location.prototype, 'href', {
        get() { return hrefDesc.get.call(this); },
        set(url) {
            try {
                if (new URL(url, location.href).href === location.href) return;
            } catch (e) {}
            hrefDesc.set.call(this, url);
        },
        configurable: true,
    });

    // ── 核心修復：攔截 popstate，阻止關閉 Reel modal 後 Facebook 重建頁面 ───
    //
    // 原理：開啟 Reel 時 Facebook 呼叫 history.pushState('/reel/xxx')，
    // 關閉時瀏覽器觸發 popstate（URL 已回到 /），Facebook 的 popstate handler
    // 呼叫 buildRootComponent() 重建整個 React tree，造成視覺上的「重整」。
    // 解法：自己維護 URL stack，偵測到「從 Reel URL 返回」時，
    // 在 capture 階段 stopImmediatePropagation()，讓 Facebook router 收不到事件。

    const urlStack = [location.href];

    const origPush = History.prototype.pushState;
    History.prototype.pushState = function (state, title, url) {
        const result = origPush.call(this, state, title, url);
        urlStack.push(location.href); // pushState 後 location.href 已同步更新
        return result;
    };

    const origReplaceState = History.prototype.replaceState;
    History.prototype.replaceState = function (state, title, url) {
        const result = origReplaceState.call(this, state, title, url);
        urlStack[urlStack.length - 1] = location.href; // 更新頂端（replaceState 不新增歷史）
        return result;
    };

    window.addEventListener('popstate', (e) => {
        const fromUrl = urlStack.length > 1 ? urlStack.pop() : '';

        if (/\/reel\//.test(fromUrl)) {
            // 從 Reel 返回：阻止 Facebook router 的 buildRootComponent
            e.stopImmediatePropagation();
            console.warn('[fb-no-refresh] blocked popstate from Reel →', location.href);
            return;
        }
    }, true); // capture phase：比 Facebook 的 handler 先執行

    // ── 讓 Facebook 永遠以為分頁可見（防止切換分頁時重整）──────────────────
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
    document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    window.addEventListener('focus', e => e.stopImmediatePropagation(), true);
    window.addEventListener('blur', e => e.stopImmediatePropagation(), true);
})();
