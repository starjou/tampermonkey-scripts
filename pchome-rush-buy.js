// ==UserScript==
// @name         PChome 24h 搶購助手
// @namespace    https://www.jk-web.com/
// @version      2.0
// @description  在指定時間自動搶購 PChome 24h 商品，支援倒數計時、自動重整、全流程自動結帳
// @author       Jacky Jou
// @match        https://24h.pchome.com.tw/prod/*
// @match        https://24h.pchome.com.tw/store/prod/*
// @match        https://24h.pchome.com.tw/*/cart
// @match        https://24h.pchome.com.tw/*/cart/payinfo*
// @match        https://ecssl.pchome.com.tw/*/cart
// @match        https://ecssl.pchome.com.tw/*/cart/payinfo*
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/pchome-rush-buy.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/pchome-rush-buy.js
// ==/UserScript==
(function () {
    'use strict';

    // ── 設定 key ─────────────────────────────────────────────────
    const KEY_TARGET_TIME  = 'pchome_rush_target_time';
    const KEY_AUTO_BUY     = 'pchome_rush_auto_buy';
    const KEY_AUTO_REFRESH = 'pchome_rush_auto_refresh';
    const KEY_AUTO_CVV     = 'pchome_rush_auto_cvv';
    const SKEY_CVV         = 'pchome_rush_cvv'; // sessionStorage，關分頁即清除

    // ── 商品頁按鈕 selectors ─────────────────────────────────────
    const BUY_SELECTORS = [
        'button[data-regression="product_button_buyNow"]:not([disabled])',
        'button[data-regression="product_button_addToCart"]:not([disabled])',
        '.c-addToCartBtn__group button:not([disabled])',
    ];

    // ── 結帳流程各步驟 selectors ─────────────────────────────────
    const STEP1_BTN = 'button[data-regression="step1-checkout-btn"]'; // 購物車頁「結帳」
    const STEP2_BTN = 'button[data-regression="step2-checkout-btn"]'; // 付款頁「確認付款」
    const CVV_INPUT = 'input[placeholder="CVC"]';                     // CVV 欄位

    // ── 頁面類型判斷（URL-based，SSR full reload 可直接判斷） ────
    const path           = location.pathname;
    const isStep1Page    = /\/cart$/.test(path);                  // 購物車確認頁
    const isStep2Page    = /\/cart\/payinfo/.test(path);          // 付款頁
    const isCheckoutPage = isStep1Page || isStep2Page;

    // ── 狀態 ─────────────────────────────────────────────────────
    let countdownTimer = null;
    let refreshTimer   = null;
    let fired          = false;

    // ── 工具 ─────────────────────────────────────────────────────
    function load(key, fallback) {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
    }
    function save(key, value) { localStorage.setItem(key, value); }

    function findEl(sels, root = document) {
        for (const sel of (Array.isArray(sels) ? sels : [sels])) {
            const el = root.querySelector(sel);
            if (el && el.offsetParent !== null) return el;
        }
        return null;
    }

    function setStatus(msg, color = '#fff') {
        const el = document.getElementById('rush-status');
        if (el) { el.textContent = msg; el.style.color = color; }
    }

    // React 受控元件相容的填值
    function setNativeValue(el, value) {
        const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        proto.set.call(el, value);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── 等待某個 selector 出現後呼叫 cb ──────────────────────────
    function waitForEl(sel, cb) {
        const el = document.querySelector(sel);
        if (el) { cb(el); return; }
        const obs = new MutationObserver(() => {
            const found = document.querySelector(sel);
            if (found) { obs.disconnect(); cb(found); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // ── CVV 填入 ─────────────────────────────────────────────────
    function fillCVV() {
        const cvv = sessionStorage.getItem(SKEY_CVV);
        if (!cvv) return false;
        let field = document.querySelector(CVV_INPUT);
        if (!field) return false;
        setNativeValue(field, cvv);
        field.focus();
        return true;
    }

    // ── 結帳流程（購物車頁 → 付款頁） ────────────────────────────
    function runCheckoutFlow() {
        // Step 1：購物車頁，等按鈕渲染完再點
        if (isStep1Page) {
            setStatus('Step 1：等待結帳按鈕…', '#888');
            waitForEl(STEP1_BTN, btn => {
                setStatus('Step 1：自動結帳中…', '#ff0');
                btn.click();
            });
            return;
        }

        // Step 2：付款頁，填 CVV 再送出
        const autoCvv = load(KEY_AUTO_CVV, 'false') === 'true';

        function doPayment() {
            const cvvFilled = fillCVV();
            if (!cvvFilled) {
                setStatus('請在面板輸入 CVV', '#f88');
                return;
            }
            setStatus('CVV 已填入', '#0f0');
            if (!autoCvv) return;
            setTimeout(() => {
                const submitBtn = document.querySelector(STEP2_BTN);
                if (submitBtn) {
                    submitBtn.click();
                    setStatus('已送出付款', '#0f0');
                } else {
                    setStatus('找不到確認付款按鈕', '#f88');
                }
            }, 300);
        }

        // CVV 欄位可能還沒出現
        if (document.querySelector(CVV_INPUT)) {
            doPayment();
        } else {
            setStatus('等待付款欄位…', '#888');
            waitForEl(CVV_INPUT, () => doPayment());
        }
    }

    // ── 商品頁：購買 ─────────────────────────────────────────────
    function doBuy() {
        if (fired) return;
        const target = findEl(BUY_SELECTORS);
        if (!target) { setStatus('找不到購買按鈕', '#f88'); return; }
        fired = true;
        setStatus('正在搶購…', '#ff0');
        target.click();
        setStatus('已點擊購買按鈕', '#0f0');
    }

    // ── 自動重整 ─────────────────────────────────────────────────
    function scheduleReload() {
        stopAutoRefresh();
        function doReload() {
            if (fired) return;
            refreshTimer = setTimeout(() => { if (!fired) location.reload(); }, 100);
        }
        if (document.querySelector('.c-addToCartBtn__group')) {
            doReload();
        } else if (document.readyState === 'complete') {
            doReload();
        } else {
            window.addEventListener('load', doReload, { once: true });
        }
    }
    function stopAutoRefresh() {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    }

    // ── 倒數計時 ─────────────────────────────────────────────────
    function startCountdown(targetTime) {
        stopCountdown();
        countdownTimer = setInterval(() => {
            const diff = targetTime - Date.now();
            if (diff <= 0) { stopCountdown(); doBuy(); return; }
            const h  = Math.floor(diff / 3_600_000);
            const m  = Math.floor((diff % 3_600_000) / 60_000);
            const s  = Math.floor((diff % 60_000) / 1_000);
            const ms = diff % 1_000;
            setStatus(
                h > 0
                    ? `倒數 ${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
                    : `倒數 ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`,
                '#ff0'
            );
        }, 50);
    }
    function stopCountdown() {
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    }

    // ── UI ───────────────────────────────────────────────────────
    function injectUI() {
        const style = document.createElement('style');
        style.textContent = `
            #rush-panel {
                position: fixed; top: 80px; right: 16px;
                z-index: 99999;
                background: rgba(20,20,28,.92);
                border: 1px solid #444;
                border-radius: 10px;
                padding: 14px 16px;
                width: 240px;
                font-family: 'Segoe UI', Arial, sans-serif;
                font-size: 13px; color: #eee;
                box-shadow: 0 4px 24px rgba(0,0,0,.5);
                user-select: none;
            }
            #rush-panel h3 {
                margin: 0 0 10px;
                font-size: 14px; color: #fff;
                display: flex; align-items: center; gap: 6px;
            }
            #rush-panel label {
                display: block; margin-top: 8px;
                font-size: 12px; color: #aaa;
            }
            #rush-panel input[type="datetime-local"],
            #rush-panel input[type="password"] {
                width: 100%; margin-top: 4px;
                padding: 5px 7px;
                background: #2a2a38; border: 1px solid #555;
                border-radius: 6px; color: #fff; font-size: 13px;
                box-sizing: border-box;
            }
            #rush-panel .row {
                display: flex; align-items: center;
                justify-content: space-between; margin-top: 8px;
            }
            #rush-panel .toggle {
                position: relative; width: 36px; height: 20px; flex-shrink: 0;
            }
            #rush-panel .toggle input { opacity: 0; width: 0; height: 0; }
            #rush-panel .toggle .slider {
                position: absolute; inset: 0;
                background: #444; border-radius: 20px;
                transition: .2s; cursor: pointer;
            }
            #rush-panel .toggle .slider::before {
                content: ''; position: absolute;
                width: 14px; height: 14px; left: 3px; top: 3px;
                background: #fff; border-radius: 50%; transition: .2s;
            }
            #rush-panel .toggle input:checked + .slider { background: #e83; }
            #rush-panel .toggle input:checked + .slider::before { transform: translateX(16px); }
            #rush-panel .divider { border: none; border-top: 1px solid #333; margin: 10px 0; }
            #rush-panel .hint { font-size: 10px; color: #666; margin-top: 3px; }
            #rush-status {
                margin-top: 10px; min-height: 18px;
                font-size: 12px; font-weight: bold;
                text-align: center; letter-spacing: .5px;
            }
            #rush-now-btn {
                display: block; width: 100%;
                margin-top: 10px; padding: 7px;
                background: #e83; border: none; border-radius: 7px;
                color: #fff; font-size: 13px; font-weight: bold;
                cursor: pointer; transition: background .15s;
            }
            #rush-now-btn:hover { background: #f94; }
            #rush-fill-cvv-btn {
                display: block; width: 100%;
                margin-top: 6px; padding: 6px;
                background: #29a; border: none; border-radius: 7px;
                color: #fff; font-size: 12px; font-weight: bold;
                cursor: pointer; transition: background .15s;
            }
            #rush-fill-cvv-btn:hover { background: #3bc; }
            #rush-drag-handle { cursor: move; }
        `;
        document.head.appendChild(style);

        const targetTimeStr = load(KEY_TARGET_TIME, '');
        const autoBuy       = load(KEY_AUTO_BUY,     'false') === 'true';
        const autoRefresh   = load(KEY_AUTO_REFRESH, 'true')  === 'true';
        const autoCvv       = load(KEY_AUTO_CVV,     'false') === 'true';

        const panel = document.createElement('div');
        panel.id = 'rush-panel';
        panel.innerHTML = `
            <h3 id="rush-drag-handle">🛒 搶購助手</h3>

            ${!isCheckoutPage ? `
            <label>目標時間</label>
            <input type="datetime-local" id="rush-time" step="1" value="${targetTimeStr}">
            <hr class="divider">
            <div class="row">
                <span>定時自動購買</span>
                <label class="toggle">
                    <input type="checkbox" id="rush-auto-buy" ${autoBuy ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="row">
                <span>自動重整頁面</span>
                <label class="toggle">
                    <input type="checkbox" id="rush-auto-refresh" ${autoRefresh ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            ` : ''}

            <hr class="divider">

            <label>信用卡 CVV（3 碼）</label>
            <input type="password" id="rush-cvv" maxlength="3" placeholder="●●●"
                autocomplete="off" value="${sessionStorage.getItem(SKEY_CVV) || ''}">
            <div class="hint">僅存於此分頁，關閉分頁即清除</div>

            <div class="row" style="margin-top:8px">
                <span>自動填入並送出</span>
                <label class="toggle">
                    <input type="checkbox" id="rush-auto-cvv" ${autoCvv ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>

            <div id="rush-status">${
                isStep2Page ? '📄 付款頁' :
                isStep1Page ? '📄 購物車頁' :
                              '📄 商品頁'
            }</div>

            ${!isCheckoutPage ? `<button id="rush-now-btn">立即搶購</button>` : ''}
            <button id="rush-fill-cvv-btn">手動填入 CVV</button>
        `;
        document.body.appendChild(panel);

        // ── CVV 輸入 ─────────────────────────────────────────────
        const cvvInput   = panel.querySelector('#rush-cvv');
        const autoCvvChk = panel.querySelector('#rush-auto-cvv');
        const fillCvvBtn = panel.querySelector('#rush-fill-cvv-btn');

        cvvInput.addEventListener('input', () => {
            const v = cvvInput.value.replace(/\D/g, '').slice(0, 3);
            cvvInput.value = v;
            if (v) sessionStorage.setItem(SKEY_CVV, v);
            else   sessionStorage.removeItem(SKEY_CVV);
        });
        autoCvvChk.addEventListener('change', () => save(KEY_AUTO_CVV, autoCvvChk.checked));
        fillCvvBtn.addEventListener('click', () => {
            if (!sessionStorage.getItem(SKEY_CVV)) { setStatus('請先輸入 CVV', '#f88'); return; }
            if (!fillCVV()) setStatus('找不到 CVV 欄位', '#f88');
        });

        // ── 商品頁邏輯 ───────────────────────────────────────────
        if (!isCheckoutPage) {
            const timeInput  = panel.querySelector('#rush-time');
            const autoBuyChk = panel.querySelector('#rush-auto-buy');
            const autoRefChk = panel.querySelector('#rush-auto-refresh');
            const nowBtn     = panel.querySelector('#rush-now-btn');

            function checkAndAct() {
                const ready = findEl(BUY_SELECTORS);
                if (autoBuyChk.checked && timeInput.value) {
                    const ts = new Date(timeInput.value).getTime();
                    if (ready)             { doBuy(); }
                    else if (ts > Date.now()) { startCountdown(ts); }
                    else                   { setStatus('時間已過，請重新設定', '#f88'); }
                } else if (ready) {
                    doBuy();
                } else if (autoRefChk.checked) {
                    setStatus('等待開賣，重整中…', '#fa0');
                    scheduleReload();
                } else {
                    setStatus('尚未啟動');
                }
            }

            function applySettings() {
                save(KEY_TARGET_TIME,  timeInput.value);
                save(KEY_AUTO_BUY,     autoBuyChk.checked);
                save(KEY_AUTO_REFRESH, autoRefChk.checked);
                stopCountdown(); stopAutoRefresh(); fired = false;

                // 等按鈕容器渲染完再判斷
                const container = '.c-addToCartBtn__group';
                if (document.querySelector(container)) {
                    checkAndAct();
                } else {
                    setStatus('等待頁面渲染…', '#888');
                    waitForEl(container, checkAndAct);
                }
            }

            timeInput.addEventListener('change', applySettings);
            autoBuyChk.addEventListener('change', applySettings);
            autoRefChk.addEventListener('change', applySettings);
            nowBtn.addEventListener('click', () => { fired = false; doBuy(); });
            applySettings();
        }

        // ── 結帳頁邏輯 ───────────────────────────────────────────
        if (isCheckoutPage) runCheckoutFlow();

        makeDraggable(panel, panel.querySelector('#rush-drag-handle'));
    }

    function makeDraggable(el, handle) {
        let ox = 0, oy = 0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            ox = e.clientX - el.offsetLeft;
            oy = e.clientY - el.offsetTop;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', () => {
                document.removeEventListener('mousemove', onMove);
            }, { once: true });
        });
        function onMove(e) {
            el.style.left  = (e.clientX - ox) + 'px';
            el.style.top   = (e.clientY - oy) + 'px';
            el.style.right = 'auto';
        }
    }

    // ── 啟動 ─────────────────────────────────────────────────────
    injectUI();
})();
