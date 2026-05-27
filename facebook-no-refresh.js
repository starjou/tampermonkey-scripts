// ==UserScript==
// @name         Facebook 防自動重整
// @namespace    https://www.jk-web.com/
// @version      1.4-debug
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
            const entry = {
                t: new Date().toISOString(),
                method,
                url: location.href,
                stack: new Error().stack?.split('\n').slice(1, 7).join('\n'),
                ...extra,
            };
            console.warn('[fb-no-refresh]', method, entry);
            const log = JSON.parse(localStorage.getItem('__fb_reload_log') || '[]');
            log.push(entry);
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
    const origLocReplace = Location.prototype.replace;
    Location.prototype.replace = function (url) {
        try {
            if (new URL(url, location.href).href === location.href) {
                return logReload('location.replace(same)', { url });
            }
        } catch (e) {}
        return origLocReplace.call(this, url);
    };

    // 攔截 history.go(0)（等同 reload）
    const origGo = History.prototype.go;
    History.prototype.go = function (delta) {
        if (delta === 0) logReload('history.go(0)', {});
        return origGo.call(this, delta);
    };

    // 攔截 history.pushState / replaceState（SPA 路由換頁）
    const origPush = History.prototype.pushState;
    History.prototype.pushState = function (state, title, url) {
        logReload('history.pushState', { url: url ?? location.href });
        return origPush.call(this, state, title, url);
    };

    const origReplaceState = History.prototype.replaceState;
    History.prototype.replaceState = function (state, title, url) {
        logReload('history.replaceState', { url: url ?? location.href });
        return origReplaceState.call(this, state, title, url);
    };

    // 攔截 popstate（瀏覽器 back/forward 或 history.go(-1)）
    window.addEventListener('popstate', (e) => {
        logReload('popstate', { state: JSON.stringify(e.state)?.slice(0, 200) });
    }, true);

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
