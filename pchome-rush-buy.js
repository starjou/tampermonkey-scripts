// ==UserScript==
// @name         PChome 24h 搶購助手
// @namespace    https://www.jk-web.com/
// @version      3.0
// @description  PChome 24h 全自動搶購：商品頁搶購 → 購物車結帳 → 付款頁填 CVV
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

    // ── Selectors ─────────────────────────────────────────────────
    const SEL_BUY_BTN   = 'button[data-regression="product_button_buyNow"]:not([disabled])';
    const SEL_ADD_BTN   = 'button[data-regression="product_button_addToCart"]:not([disabled])';
    const SEL_BTN_WRAP  = '.c-compoundBtnTool';
    const SEL_CONTAINER = '.c-addToCartBtn__group';
    const SEL_STEP1_BTN = 'button[data-regression="step1-checkout-btn"]';
    const SEL_CVV_INPUT = 'input[placeholder="CVC"]';
    const SEL_STEP2_BTN = 'button[data-regression="step2-checkout-btn"]';

    // ── Storage keys ──────────────────────────────────────────────
    const LS_TIME    = 'pchome_rush_target_time';
    const LS_AUTOBIO = 'pchome_rush_auto_buy';
    const LS_REFRESH = 'pchome_rush_auto_refresh';
    const LS_AUTOCVV = 'pchome_rush_auto_cvv';
    const SS_CVV     = 'pchome_rush_cvv'; // sessionStorage，關分頁即清除

    // ── Page detection ────────────────────────────────────────────
    const path = location.pathname;
    const PAGE = path.includes('/cart/payinfo') ? 'payment'
               : /\/cart(\/|\?|$)/.test(path)  ? 'cart'
               :                                   'product';

    // ── Shared utilities ──────────────────────────────────────────
    const lsGet = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : v; };
    const lsSet = (k, v) => localStorage.setItem(k, v);

    function waitForEl(sel, cb) {
        const el = document.querySelector(sel);
        if (el) { cb(el); return; }
        const obs = new MutationObserver(() => {
            const found = document.querySelector(sel);
            if (found) { obs.disconnect(); cb(found); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    function simulateClick(el) {
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup',   opts));
        el.dispatchEvent(new MouseEvent('click',     opts));
    }

    function setNativeValue(el, val) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── Panel ─────────────────────────────────────────────────────
    let statusEl = null;

    function setStatus(msg, color = '#fff') {
        if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
    }

    function toggle(id, checked) {
        return `<label class="rush-toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="rush-slider"></span></label>`;
    }

    function createPanel(bodyHTML) {
        const style = document.createElement('style');
        style.textContent = `
            #rush-panel {
                position: fixed; top: 80px; right: 16px; z-index: 99999;
                background: rgba(20,20,28,.93); border: 1px solid #444;
                border-radius: 10px; padding: 14px 16px; width: 240px;
                font: 13px 'Segoe UI', Arial, sans-serif; color: #eee;
                box-shadow: 0 4px 24px rgba(0,0,0,.5); user-select: none;
            }
            #rush-panel h3 {
                margin: 0 0 10px; font-size: 14px; color: #fff;
                display: flex; align-items: center; gap: 6px; cursor: move;
            }
            #rush-panel .rush-label {
                display: block; margin-top: 8px; font-size: 12px; color: #aaa;
            }
            #rush-panel input[type="datetime-local"],
            #rush-panel input[type="password"] {
                width: 100%; margin-top: 4px; padding: 5px 7px;
                background: #2a2a38; border: 1px solid #555;
                border-radius: 6px; color: #fff; font-size: 13px;
                box-sizing: border-box;
            }
            #rush-panel .rush-row {
                display: flex; align-items: center;
                justify-content: space-between; margin-top: 8px;
            }
            .rush-toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
            .rush-toggle input { opacity: 0; width: 0; height: 0; }
            .rush-slider {
                position: absolute; inset: 0; background: #444;
                border-radius: 20px; transition: .2s; cursor: pointer;
            }
            .rush-slider::before {
                content: ''; position: absolute;
                width: 14px; height: 14px; left: 3px; top: 3px;
                background: #fff; border-radius: 50%; transition: .2s;
            }
            .rush-toggle input:checked + .rush-slider { background: #e83; }
            .rush-toggle input:checked + .rush-slider::before { transform: translateX(16px); }
            #rush-panel hr { border: none; border-top: 1px solid #333; margin: 10px 0; }
            #rush-panel .rush-hint { font-size: 10px; color: #666; margin-top: 3px; }
            #rush-status {
                margin-top: 10px; min-height: 18px; font-size: 12px;
                font-weight: bold; text-align: center; letter-spacing: .5px;
            }
            .rush-btn {
                display: block; width: 100%; margin-top: 8px; padding: 7px;
                border: none; border-radius: 7px; font-size: 13px;
                font-weight: bold; cursor: pointer; color: #fff;
                transition: background .15s;
            }
            .rush-btn-red  { background: #e83; }
            .rush-btn-red:hover  { background: #f94; }
            .rush-btn-teal { background: #29a; }
            .rush-btn-teal:hover { background: #3bc; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'rush-panel';
        panel.innerHTML = `<h3>🛒 搶購助手</h3>${bodyHTML}<div id="rush-status"></div>`;
        document.body.appendChild(panel);

        statusEl = panel.querySelector('#rush-status');
        makeDraggable(panel, panel.querySelector('h3'));
        return panel;
    }

    function makeDraggable(el, handle) {
        let ox = 0, oy = 0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            ox = e.clientX - el.offsetLeft;
            oy = e.clientY - el.offsetTop;
            const onMove = e => {
                el.style.left  = (e.clientX - ox) + 'px';
                el.style.top   = (e.clientY - oy) + 'px';
                el.style.right = 'auto';
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', () =>
                document.removeEventListener('mousemove', onMove), { once: true });
        });
    }

    // ── CVV（sessionStorage，所有頁面共用） ──────────────────────
    function cvvHTML() {
        const val     = sessionStorage.getItem(SS_CVV) || '';
        const autoCvv = lsGet(LS_AUTOCVV, 'false') === 'true';
        return `
            <hr>
            <span class="rush-label">信用卡 CVV（3 碼）</span>
            <input type="password" id="rush-cvv" maxlength="3" placeholder="●●●"
                   autocomplete="off" value="${val}">
            <div class="rush-hint">僅存於此分頁，關閉即清除</div>
            <div class="rush-row">
                <span>自動填入並送出</span>
                ${toggle('rush-auto-cvv', autoCvv)}
            </div>`;
    }

    function bindCVV(panel) {
        const inp = panel.querySelector('#rush-cvv');
        const chk = panel.querySelector('#rush-auto-cvv');
        inp.addEventListener('input', () => {
            const v = inp.value.replace(/\D/g, '').slice(0, 3);
            inp.value = v;
            v ? sessionStorage.setItem(SS_CVV, v) : sessionStorage.removeItem(SS_CVV);
        });
        chk.addEventListener('change', () => lsSet(LS_AUTOCVV, chk.checked));
    }

    function fillCVV() {
        const cvv   = sessionStorage.getItem(SS_CVV);
        const field = document.querySelector(SEL_CVV_INPUT);
        if (!cvv || !field) return false;
        setNativeValue(field, cvv);
        field.focus();
        return true;
    }

    // ════════════════════════════════════════════════════════════
    //  商品頁
    // ════════════════════════════════════════════════════════════
    function initProductPage() {
        const timeVal    = lsGet(LS_TIME,    '');
        const autoBuy    = lsGet(LS_AUTOBIO, 'false') === 'true';
        const autoRefresh = lsGet(LS_REFRESH, 'true')  === 'true';

        const panel = createPanel(`
            <span class="rush-label">目標時間</span>
            <input type="datetime-local" id="rush-time" step="1" value="${timeVal}">
            <hr>
            <div class="rush-row">
                <span>定時自動購買</span>${toggle('rush-auto-buy', autoBuy)}
            </div>
            <div class="rush-row">
                <span>自動重整頁面</span>${toggle('rush-auto-refresh', autoRefresh)}
            </div>
            ${cvvHTML()}
            <button class="rush-btn rush-btn-red" id="rush-now-btn">立即搶購</button>
        `);
        bindCVV(panel);

        const timeInp    = panel.querySelector('#rush-time');
        const autoBuyChk = panel.querySelector('#rush-auto-buy');
        const autoRefChk = panel.querySelector('#rush-auto-refresh');
        const nowBtn     = panel.querySelector('#rush-now-btn');

        let countdownTimer = null;
        let reloadTimer    = null;
        let fired          = false;

        function stopAll() {
            clearInterval(countdownTimer);
            clearTimeout(reloadTimer);
            countdownTimer = reloadTimer = null;
        }

        function scheduleReload() {
            function doReload() {
                if (fired) return;
                reloadTimer = setTimeout(() => { if (!fired) location.reload(); }, 100);
            }
            if (document.querySelector(SEL_CONTAINER) || document.readyState === 'complete') {
                doReload();
            } else {
                window.addEventListener('load', doReload, { once: true });
            }
        }

        function startCountdown(ts) {
            countdownTimer = setInterval(() => {
                const diff = ts - Date.now();
                if (diff <= 0) { stopAll(); checkAndAct(); return; }
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

        function tryBuy() {
            const btn = document.querySelector(SEL_BUY_BTN) || document.querySelector(SEL_ADD_BTN);
            if (!btn) return false;
            fired = true;
            const target = btn.closest(SEL_BTN_WRAP) || btn;
            simulateClick(target);
            setStatus('已點擊購買按鈕', '#0f0');
            return true;
        }

        function checkAndAct() {
            if (fired) return;
            if (tryBuy()) return;

            const ts = timeInp.value ? new Date(timeInp.value).getTime() : 0;
            if (autoBuyChk.checked && ts > Date.now()) {
                startCountdown(ts);
            } else if (autoRefChk.checked) {
                setStatus('等待開賣，重整中…', '#fa0');
                scheduleReload();
            } else {
                setStatus('尚未啟動');
            }
        }

        function applySettings() {
            lsSet(LS_TIME,    timeInp.value);
            lsSet(LS_AUTOBIO, autoBuyChk.checked);
            lsSet(LS_REFRESH, autoRefChk.checked);
            stopAll(); fired = false;

            if (document.querySelector(SEL_CONTAINER)) {
                checkAndAct();
            } else {
                setStatus('等待頁面渲染…', '#888');
                waitForEl(SEL_CONTAINER, checkAndAct);
            }
        }

        timeInp.addEventListener('change',    applySettings);
        autoBuyChk.addEventListener('change', applySettings);
        autoRefChk.addEventListener('change', applySettings);
        nowBtn.addEventListener('click', () => { stopAll(); fired = false; tryBuy(); });

        applySettings();
    }

    // ════════════════════════════════════════════════════════════
    //  購物車頁（step 1）
    // ════════════════════════════════════════════════════════════
    function initCartPage() {
        const panel = createPanel(`
            ${cvvHTML()}
            <button class="rush-btn rush-btn-red" id="rush-manual-cart">手動結帳</button>
        `);
        bindCVV(panel);

        panel.querySelector('#rush-manual-cart').addEventListener('click', () => {
            const btn = document.querySelector(SEL_STEP1_BTN);
            if (btn) simulateClick(btn);
            else setStatus('找不到結帳按鈕', '#f88');
        });

        setStatus('等待結帳按鈕…', '#888');
        waitForEl(SEL_STEP1_BTN, btn => {
            setStatus('自動結帳中…', '#ff0');
            simulateClick(btn);
        });
    }

    // ════════════════════════════════════════════════════════════
    //  付款頁（step 2）
    // ════════════════════════════════════════════════════════════
    function initPaymentPage() {
        const panel = createPanel(`
            ${cvvHTML()}
            <button class="rush-btn rush-btn-teal" id="rush-manual-cvv">手動填入 CVV</button>
        `);
        bindCVV(panel);

        panel.querySelector('#rush-manual-cvv').addEventListener('click', () => {
            if (!fillCVV()) setStatus('找不到 CVV 欄位或未輸入 CVV', '#f88');
        });

        function doPayment() {
            if (!fillCVV()) { setStatus('請在面板輸入 CVV', '#f88'); return; }
            setStatus('CVV 已填入', '#0f0');
            if (lsGet(LS_AUTOCVV, 'false') !== 'true') return;
            waitForEl(SEL_STEP2_BTN, btn => {
                simulateClick(btn);
                setStatus('已送出付款', '#0f0');
            });
        }

        setStatus('等待付款欄位…', '#888');
        waitForEl(SEL_CVV_INPUT, () => doPayment());
    }

    // ════════════════════════════════════════════════════════════
    //  Dispatch
    // ════════════════════════════════════════════════════════════
    if      (PAGE === 'product') initProductPage();
    else if (PAGE === 'cart')    initCartPage();
    else if (PAGE === 'payment') initPaymentPage();
})();
