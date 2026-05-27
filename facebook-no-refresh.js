// ==UserScript==
// @name         Facebook 防自動重整
// @namespace    https://www.jk-web.com/
// @version      1.7
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

    // ── 優先儲存所有 native 函式（在任何 override 之前）────────────────────
    const _push    = History.prototype.pushState;
    const _replace = History.prototype.replaceState;
    const _back    = History.prototype.back;
    const _go      = History.prototype.go;

    // ── 追蹤上一個 URL ───────────────────────────────────────────────────────
    let prevUrl = location.href;

    History.prototype.pushState = function (state, title, url) {
        const result = _push.call(this, state, title, url);
        prevUrl = location.href;
        return result;
    };

    History.prototype.replaceState = function (state, title, url) {
        const result = _replace.call(this, state, title, url);
        prevUrl = location.href;
        return result;
    };

    // ── 策略 A：攔截程式化的 history.back() / go(-1) ─────────────────────────
    //
    // 根因分析：Facebook 在 Reel modal 關閉時呼叫 history.back()，
    // 這會觸發 popstate，Facebook router 收到後呼叫 buildRootComponent() 重建頁面。
    //
    // 解法：把 history.back() 在 Reel 頁面替換為 native replaceState('/')，
    // URL 靜默更新但 popstate 完全不觸發，router 感知不到這次導航。
    // （replaceState 本身不會觸發 buildRootComponent，已由 debug log 確認。）

    History.prototype.back = function () {
        if (/\/reel\//.test(location.href)) {
            _replace.call(this, history.state, '', location.origin + '/');
            prevUrl = location.href;
            console.warn('[fb-no-refresh] intercepted history.back() on Reel → silent replaceState');
            return;
        }
        return _back.call(this);
    };

    History.prototype.go = function (delta) {
        if (typeof delta === 'number' && delta < 0 && /\/reel\//.test(location.href)) {
            _replace.call(this, history.state, '', location.origin + '/');
            prevUrl = location.href;
            console.warn('[fb-no-refresh] intercepted history.go(' + delta + ') on Reel → silent replaceState');
            return;
        }
        return _go.call(this, delta);
    };

    // ── 策略 B：瀏覽器返回鍵的 popstate 攔截（備援）──────────────────────────
    // 使用者按瀏覽器返回鍵時無法攔截 history.back()，改在 capture phase 擋住
    window.addEventListener('popstate', (e) => {
        const from = prevUrl;
        prevUrl = location.href;

        const fromReel = /\/reel\//.test(from);
        const toFeed   = /^https:\/\/www\.facebook\.com\/?(\?.*)?$/.test(location.href);

        if (fromReel && toFeed) {
            e.stopImmediatePropagation();
            console.warn('[fb-no-refresh] blocked popstate Reel → feed');
        }
    }, true);

    // ── 阻止 location.reload() ──────────────────────────────────────────────
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
