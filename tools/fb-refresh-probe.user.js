// ==UserScript==
// @name         FB 重整診斷探針
// @namespace    https://www.jk-web.com/
// @version      0.4
// @description  記錄 Facebook 自動重整前後發生的每個訊號，並可切換只擋某一種事件，用來判斷重整的真正來源
// @author       Jacky Jou
// @match        https://www.facebook.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// 用法（完整說明見 repo 的 CLAUDE.md「Facebook 防自動重整」→「診斷探針」）：
//   1. 先把「Facebook 防自動重整」停用（它會攔事件，干擾觀察結果）
//   2. 依要測的假設設定下面的 BLOCK，裝這支，重新整理 FB
//   3. 關掉 DevTools，切到別的分頁放 15 分鐘以上，再切回來
//   4. 不要重新整理，在 console 執行 copy(__fbProbeReport())，把剪貼簿內容貼回來
//
// BLOCK = 'none' 時不改任何行為，只讀取與記錄。

(function () {
    'use strict';

    const KEY = '__fb_refresh_probe_log';
    const T0 = Date.now();

    // 從 prototype 拿原始 getter，這樣即使別的腳本覆寫了 document.hidden，讀到的還是真值
    const _realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get;
    const _realVis = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get;
    const _realHasFocus = Document.prototype.hasFocus;

    // ---- 實驗開關：一次只擋一種，才分得出是哪個訊號讓 FB 刷新 ----
    //   'none'        純觀察（基準組）
    //   'visibility'  在 window capture 擋下真實的 visibilitychange，並讓 document.hidden / visibilityState 永遠回報可見
    //   'focus'       在 window capture 擋下 window 本身的 focus / blur，並讓 document.hasFocus() 永遠回報 true
    //   'both'        以上兩種都擋
    const BLOCK = 'none';

    // sessionStorage 在同一個分頁的 reload 與「Chrome 丟棄分頁後還原」都會保留，
    // 所以可以跨越那次重整把紀錄帶過來。
    function load() {
        try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch (e) { return []; }
    }
    function log(tag, extra) {
        const row = {
            t: Date.now() - T0,
            tag,
            // 這三個一起記，才能分辨「分頁真的被切走」與「頁面內的 synthetic event」
            realHidden: _realHidden.call(document),
            vis: _realVis.call(document),
            focus: (() => { try { return _realHasFocus.call(document); } catch (e) { return null; } })(),
            url: location.pathname + location.search,
        };
        if (extra !== undefined) row.extra = extra;
        const rows = load();
        rows.push(row);
        // 只留最後 400 筆，避免 sessionStorage 爆掉
        try { sessionStorage.setItem(KEY, JSON.stringify(rows.slice(-400))); } catch (e) {}
        console.log('[probe]', row.t + 'ms', tag, extra !== undefined ? extra : '');
    }

    // ---- 先把上一輪（重整前）的紀錄印出來，這是最關鍵的證據 ----
    const prev = load();
    const nav = performance.getEntriesByType('navigation')[0];
    console.log('%c=== 上一輪 session 的紀錄 ===', 'font-weight:bold;font-size:14px');
    console.log('navigation.type      =', nav ? nav.type : '(無)');   // reload / navigate / back_forward
    console.log('document.wasDiscarded=', document.wasDiscarded);      // true = Chrome 把分頁丟棄了
    console.log('上一輪事件數          =', prev.length);
    if (prev.length) console.table(prev.slice(-60));
    // 搬到另一個 key 而不是直接刪掉：重整當下 DevTools 沒開的話上面的輸出會錯過，
    // 之後打開 console 執行 __fbProbeDump() 還能重印一次
    const summary = { navType: nav ? nav.type : null, wasDiscarded: document.wasDiscarded, rows: prev };
    try {
        sessionStorage.setItem(KEY + '_prev', JSON.stringify(summary));
        sessionStorage.removeItem(KEY);
    } catch (e) {}
    window.__fbProbeDump = () => {
        let s;
        try { s = JSON.parse(sessionStorage.getItem(KEY + '_prev')); } catch (e) {}
        if (!s) { console.log('(沒有上一輪紀錄)'); return; }
        console.log('navigation.type      =', s.navType);
        console.log('document.wasDiscarded=', s.wasDiscarded);
        console.log('上一輪事件數          =', s.rows.length);
        console.table(s.rows.slice(-60));
        return JSON.stringify(s);   // 回傳字串，方便右鍵 Copy string contents 整段貼回
    };

    // perfNow / scripts 用來確認我們比 FB 的程式更早執行：
    // 要是此時已經有 FB 的 <script> 跑過，它的 listener 可能比我們先註冊，擋不擋得住就不一定了
    log('script-start', {
        mode: BLOCK,
        navType: nav ? nav.type : null,
        wasDiscarded: document.wasDiscarded,
        perfNow: Math.round(performance.now()),
        scripts: document.scripts.length,
    });

    // ---- 觀察所有可能被當成「使用者回來了」的訊號 ----
    // 全部掛在 window capture，且在 document-start 註冊，所以會比 FB 自己的 listener 更早看到。
    const EVENTS = [
        'visibilitychange', 'blur', 'focus', 'focusin', 'focusout',
        'pagehide', 'pageshow', 'freeze', 'resume',
        'beforeunload', 'unload', 'online', 'offline', 'popstate', 'hashchange',
    ];
    EVENTS.forEach((type) => {
        window.addEventListener(type, (e) => log('ev:' + type, { target: e.target === document ? 'document' : (e.target === window ? 'window' : (e.target.nodeName || String(e.target))) }), true);
    });
    // visibilitychange 的正式 target 是 document。window capture 會比 document 更早跑到，
    // 這裡再補一個 document 上的，用來確認兩個位置都收得到（這正是原腳本漏掉的那一層）。
    document.addEventListener('visibilitychange', () => log('ev:visibilitychange@document'), true);

    // ---- 網路請求：切回來後 60 秒內的 GraphQL 請求，連同呼叫堆疊一起記 ----
    // 就算事件全擋了還是刷新，FB 重抓動態牆的那支請求一定還是會發出去，
    // 它的 friendly name 和 stack 能指出是哪段程式觸發的。
    // 這個 listener 要註冊在下面的攔截之前，否則被 stopImmediatePropagation 擋掉就記不到切回來的時間。
    let lastReturn = 0;
    window.addEventListener('visibilitychange', () => {
        if (!_realHidden.call(document)) lastReturn = Date.now();
    }, true);
    function friendlyName(body) {
        try {
            if (typeof body === 'string') return new URLSearchParams(body).get('fb_api_req_friendly_name');
            if (body instanceof FormData || body instanceof URLSearchParams) return body.get('fb_api_req_friendly_name');
        } catch (e) {}
        return null;
    }
    function logRequest(via, url, body) {
        if (!/\/api\/graphql/.test(String(url))) return;
        const since = Date.now() - lastReturn;
        if (!lastReturn || since > 60000) return;
        log('net:' + via, {
            n: friendlyName(body) || '(unknown)',
            sinceReturnMs: since,
            stack: (new Error().stack || '').split('\n').slice(2, 14).map((s) => s.trim()).join(' | '),
        });
    }
    // XHR 掛在 prototype 上，就算 FB 比我們早拿到 XMLHttpRequest 也攔得到；
    // fetch 則是 FB 若已先存下 window.fetch 的參考就會漏記
    const _fetch = window.fetch;
    window.fetch = function (input, init) {
        try { logRequest('fetch', input instanceof Request ? input.url : input, init && init.body); } catch (e) {}
        return _fetch.apply(this, arguments);
    };
    const _xhrOpen = XMLHttpRequest.prototype.open;
    const _xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__probeUrl = url;
        return _xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        try { logRequest('xhr', this.__probeUrl, body); } catch (e) {}
        return _xhrSend.apply(this, arguments);
    };

    // ---- 攔截（依 BLOCK 決定擋哪一種）----
    // 掛在 window capture：事件傳遞路徑是 window → document，這是最早的位置，
    // 而且在 document-start 註冊，排在 FB 所有 listener 前面。上面的 log listener 先註冊所以照樣記得到。
    // 只擋 isTrusted 的（瀏覽器真的發出的）；FB 自己 dispatchEvent 出來的 synthetic event 放行，
    // 原腳本「Reel 關閉時要放行」的需求就是靠這個區分。
    function blockTrusted(types) {
        types.forEach((type) => {
            window.addEventListener(type, (e) => {
                if (!e.isTrusted) { log('pass-synthetic:' + type); return; }
                // 輸入框、連結的 focus/blur 也會經過 window capture，那些是 FB 正常互動要用的，不能擋；
                // 只擋「分頁/視窗本身」的（focus/blur 的 target 是 window，visibilitychange 的是 document）
                if (e.target !== window && e.target !== document) return;
                e.stopImmediatePropagation();
                log('blocked:' + type);
            }, true);
        });
    }
    if (BLOCK === 'visibility' || BLOCK === 'both') {
        blockTrusted(['visibilitychange']);
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    }
    if (BLOCK === 'focus' || BLOCK === 'both') {
        blockTrusted(['focus', 'blur']);
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
    }

    // ---- 誰要求導航？把入口都包起來看有沒有人呼叫 ----
    // location 的屬性在 Chrome 多半是 non-configurable，所以用 try/catch，失敗就記下來。
    try {
        const origReload = location.reload.bind(location);
        Object.defineProperty(location, 'reload', {
            configurable: true,
            value: function () {
                log('call:location.reload', { stack: new Error().stack });
                return origReload.apply(this, arguments);
            },
        });
        log('hook:location.reload', 'ok');
    } catch (e) {
        log('hook:location.reload', 'FAILED ' + e.message);
    }
    try {
        const origAssign = location.assign.bind(location);
        Object.defineProperty(location, 'assign', {
            configurable: true,
            value: function (u) { log('call:location.assign', { u: String(u), stack: new Error().stack }); return origAssign.apply(this, arguments); },
        });
        const origReplace = location.replace.bind(location);
        Object.defineProperty(location, 'replace', {
            configurable: true,
            value: function (u) { log('call:location.replace', { u: String(u), stack: new Error().stack }); return origReplace.apply(this, arguments); },
        });
        log('hook:location.assign/replace', 'ok');
    } catch (e) {
        log('hook:location.assign/replace', 'FAILED ' + e.message);
    }
    try {
        const _ps = history.pushState, _rs = history.replaceState;
        history.pushState = function (...a) { log('call:history.pushState', { u: String(a[2]) }); return _ps.apply(this, a); };
        history.replaceState = function (...a) { log('call:history.replaceState', { u: String(a[2]) }); return _rs.apply(this, a); };
        log('hook:history', 'ok');
    } catch (e) {
        log('hook:history', 'FAILED ' + e.message);
    }

    // ---- 心跳：用來還原「分頁被切走多久」以及 JS 是不是整段被凍住 ----
    let lastBeat = Date.now();
    setInterval(() => {
        const now = Date.now();
        const gap = now - lastBeat;
        lastBeat = now;
        // 只在不正常的情況記錄，否則 log 會被心跳塞滿
        if (gap > 3000) log('heartbeat-gap', { gapMs: gap });
    }, 1000);

    // 印出本輪紀錄：開頭 6 筆（看版本、模式、載入方式）+ 最後 30 筆（切回來那一刻）+ 全部網路請求 + 上一輪摘要。
    // 回傳同一份文字，所以 copy(__fbProbeReport()) 可以直接複製到剪貼簿
    window.__fbProbeReport = () => {
        const isNet = (r) => r.tag.startsWith('net:');
        const f = (r) => `${r.t}ms\t${r.tag}\thidden=${r.realHidden}\tvis=${r.vis}\tfocus=${r.focus}\t${r.extra ? JSON.stringify(r.extra).slice(0, isNet(r) ? 1500 : 150) : ''}`;
        const cur = load();
        const ev = cur.filter((r) => !isNet(r));
        const net = cur.filter(isNet);
        let prevSummary = null;
        try { prevSummary = JSON.parse(sessionStorage.getItem(KEY + '_prev')); } catch (e) {}
        const rows = ev.length <= 36 ? ev.map(f) : [...ev.slice(0, 6).map(f), `…（略過 ${ev.length - 36} 筆）`, ...ev.slice(-30).map(f)];
        const text = [
            '載入後秒數 ' + Math.round(performance.now() / 1000),
            '本輪 ' + cur.length + ' 筆',
            ...rows,
            '--- 網路請求（' + net.length + ' 筆）---',
            ...net.map(f),
            '--- 上一輪 ---',
            prevSummary ? `navType=${prevSummary.navType} wasDiscarded=${prevSummary.wasDiscarded} 筆數=${prevSummary.rows.length}` : '（無）',
        ].join('\n');
        console.log(text);
        return text;
    };

    console.log('[probe] 已啟動（BLOCK=' + BLOCK + '），切到別的分頁再切回來，之後執行 copy(__fbProbeReport())');
})();
