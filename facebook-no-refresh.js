// ==UserScript==
// @name         Facebook 防自動重整
// @namespace    https://www.jk-web.com/
// @version      1.3-debug
// @description  防止 Facebook 切換分頁或關閉全屏 Reel 後自動重新整理（含重整來源偵測）
// @author       Jacky Jou
// @match        https://www.facebook.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-no-refresh.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-no-refresh.js
// ==/UserScript==

(function () {
    'use strict';

    // ── Debug：記錄重整來源到 localStorage ──────────────────────────────────
    // 讀取方式：在 console 輸入 JSON.parse(localStorage.getItem('__fb_reload_log')||'[]')
    function logReload(method, extra) {
        try {
            const log = JSON.parse(localStorage.getItem('__fb_reload_log') || '[]');
            log.push({
                t: new Date().toISOString(),
                method,
                url: location.href,
                stack: new Error().stack?.split('\n').slice(1, 7).join('\n'),
                ...extra,
            });
            localStorage.setItem('__fb_reload_log', JSON.stringify(log.slice(-30)));
        } catch (e) {}
    }

    // 攔截 location.reload()
    Object.defineProperty(Location.prototype, 'reload', {
        value: function (force) { logReload('location.reload', { force }); },
        configurable: true,
        writable: true,
    });

    // 攔截 location.href = 同 URL（等同 reload）
    const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    Object.defineProperty(Location.prototype, 'href', {
        get() { return hrefDesc.get.call(this); },
        set(url) {
            try {
                if (new URL(url, location.href).href === location.href) {
                    return logReload('location.href=same', { url });
                }
            } catch (e) {}
            hrefDesc.set.call(this, url);
        },
        configurable: true,
    });

    // 攔截 location.replace()（同 URL 視為 reload）
    const origReplace = Location.prototype.replace;
    Location.prototype.replace = function (url) {
        try {
            if (new URL(url, location.href).href === location.href) {
                return logReload('location.replace(same)', { url });
            }
        } catch (e) {}
        return origReplace.call(this, url);
    };

    // 攔截 history.go(0)（等同 reload）
    const origGo = History.prototype.go;
    History.prototype.go = function (delta) {
        if (delta === 0) logReload('history.go(0)', {});
        return origGo.call(this, delta);
    };

    // 最後防線：捕捉任何真實 navigation 前的 unload
    // 若只有這條紀錄、前面都沒有，代表有我們尚未攔截的機制
    window.addEventListener('beforeunload', () => logReload('beforeunload', {}), true);

    // ── 原有防重整邏輯 ───────────────────────────────────────────────────────

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
})();
