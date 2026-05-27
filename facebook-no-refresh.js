// ==UserScript==
// @name         Facebook 防自動重整
// @namespace    https://www.jk-web.com/
// @version      1.6
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

    // ── 追蹤「上一個 URL」，用於判斷是否從 Reel 返回 ────────────────────────
    let prevUrl = location.href;

    const _origPush = History.prototype.pushState;
    History.prototype.pushState = function (state, title, url) {
        const result = _origPush.call(this, state, title, url);
        prevUrl = location.href; // pushState 後 location.href 已同步更新
        return result;
    };

    const _origReplace = History.prototype.replaceState;
    History.prototype.replaceState = function (state, title, url) {
        const result = _origReplace.call(this, state, title, url);
        prevUrl = location.href;
        return result;
    };

    // ── 核心修復：在 EventTarget.prototype.addEventListener 層包住所有 popstate ─
    //
    // 問題根因：Facebook 可能透過 inline script 在我們腳本之前就註冊了 capture
    // phase 的 popstate listener；stopImmediatePropagation() 無法阻止已先執行的
    // handler 排出 async 任務（MessageChannel/React scheduler）。
    //
    // 解法：在 EventTarget 層攔截所有 popstate 的 addEventListener 呼叫，
    // 把每個 handler 包一層 blockNextPopstate 判斷，不管誰先誰後都受控制。

    let blockNextPopstate = false;

    const _origAEL = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, handler, options) {
        if (type === 'popstate' && this === window && typeof handler === 'function') {
            const wrapped = function (e) {
                if (blockNextPopstate) return;
                return handler.call(this, e);
            };
            return _origAEL.call(this, type, wrapped, options);
        }
        return _origAEL.call(this, type, handler, options);
    };

    // 同樣包住 window.onpopstate 屬性設定
    let _rawOnPopstate = null;
    Object.defineProperty(window, 'onpopstate', {
        get: () => _rawOnPopstate,
        set(fn) {
            _rawOnPopstate = typeof fn === 'function'
                ? function (e) { if (!blockNextPopstate) fn.call(this, e); }
                : fn;
        },
        configurable: true,
    });

    // 我們自己的 popstate 監聽器，用 _origAEL 直接註冊（不受上面的包裝影響），
    // capture phase 確保在所有 wrapped handler 之前執行
    _origAEL.call(window, 'popstate', function (e) {
        const from = prevUrl;
        prevUrl = location.href; // 更新為新 URL

        if (/\/reel\//.test(from)) {
            blockNextPopstate = true;
            // 在本次 event loop 結束後重置，確保所有同步 handler 都被攔截
            setTimeout(function () { blockNextPopstate = false; }, 0);
            console.warn('[fb-no-refresh] blocked popstate from Reel:', from, '→', location.href);
        }
    }, true);

    // ── 阻止程式化的 location.reload() ──────────────────────────────────────
    Object.defineProperty(Location.prototype, 'reload', {
        value: function () {},
        configurable: true,
        writable: true,
    });

    // ── 攔截 location.href = 同 URL（等同 reload）───────────────────────────
    const _hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    Object.defineProperty(Location.prototype, 'href', {
        get() { return _hrefDesc.get.call(this); },
        set(url) {
            try { if (new URL(url, location.href).href === location.href) return; } catch (_) {}
            _hrefDesc.set.call(this, url);
        },
        configurable: true,
    });

    // ── 讓 Facebook 永遠以為分頁可見（防止切換分頁時重整）──────────────────
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
    document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    window.addEventListener('focus', e => e.stopImmediatePropagation(), true);
    window.addEventListener('blur', e => e.stopImmediatePropagation(), true);
})();
