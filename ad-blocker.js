(function () {
    'use strict';

    // ── 注入 CSS，讓 overlay 無法攔截滑鼠事件 ───────────────────
    const style = document.createElement('style');
    style.textContent = '[data-cl-overlay] { pointer-events: none !important; }';
    (document.head || document.documentElement).appendChild(style);

    // ── 擋掉網站 dispatch 的假 click（觸發雙擊全螢幕）──────────
    // 假 click (isTrusted:false) 是在 site 的 window capture handler 裡
    // dispatch 的，此時 overlay 可能已被移除，所以用 mousedown 預先記錄
    let mouseDownWithOverlay = false;
    window.addEventListener('mousedown', function () {
        mouseDownWithOverlay = !!document.querySelector('[data-cl-overlay]');
    }, true);
    window.addEventListener('click', function (e) {
        if (!e.isTrusted && mouseDownWithOverlay) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }, true);

    // ── 封鎖所有對外的 window.open ──────────────────────────────
    const _open = window.open.bind(window);
    window.open = function (url, ...args) {
        if (url && !url.startsWith(location.origin) && url !== '' && url !== 'about:blank') {
            console.log('[AdBlocker] blocked window.open:', url);
            return { closed: false, close() { }, focus() { }, blur() { } };
        }
        return _open(url, ...args);
    };
})();
