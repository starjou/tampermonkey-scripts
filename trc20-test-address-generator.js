// ==UserScript==
// @name         TRC20 測試地址產生器
// @namespace    jk-studio-dev-tools
// @version      1.2
// @description  一鍵生成格式與 checksum 皆合法的 TRC20 測試地址（純隨機，不對應任何真實私鑰），用於前端表單測試。啟用網址可自訂（Tampermonkey 選單）。
// @author       Jacky
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/trc20-test-address-generator.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/trc20-test-address-generator.js
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'trc20gen_enabled_patterns';
  const DEFAULT_PATTERNS = ['localhost']; // 預設只在 localhost 啟用

  const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  // ---- 讀取/儲存啟用網址清單（跨站共用，存在 Tampermonkey storage，不是 localStorage）----
  function getEnabledPatterns() {
    const raw = GM_getValue(STORAGE_KEY, null);
    if (!raw) return DEFAULT_PATTERNS;
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr : DEFAULT_PATTERNS;
    } catch {
      return DEFAULT_PATTERNS;
    }
  }

  function setEnabledPatterns(arr) {
    GM_setValue(STORAGE_KEY, JSON.stringify(arr));
  }

  // 簡單字串包含比對即可（不用正規表示式，好懂好維護）
  // 例如 pattern "localhost" 會 match "http://localhost:5173/xxx"
  // pattern "*" 是特例，代表全站啟用
  function isEnabledOnThisPage() {
    const patterns = getEnabledPatterns();
    if (patterns.includes('*')) return true;
    const href = window.location.href;
    const host = window.location.hostname;
    return patterns.some((p) => href.includes(p) || host.includes(p));
  }

  // ---- Tampermonkey 選單：讓使用者自訂啟用網址，不用改程式碼 ----
  function registerMenu() {
    GM_registerMenuCommand('⚙️ 設定啟用網址 (目前: ' + getEnabledPatterns().join(', ') + ')', () => {
      const current = getEnabledPatterns().join(', ');
      const input = prompt(
        'TRC20 產生器啟用網址設定\n\n' +
          '請輸入要啟用的網址關鍵字，多個用逗號分隔（比對網址是否「包含」該字串即可，例如 localhost, uat.okoec.cc）\n' +
          '輸入 * 代表全站啟用\n\n' +
          '目前設定：',
        current
      );
      if (input === null) return; // 取消
      const list = input
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!list.length) {
        alert('清單不能為空，已保留原設定');
        return;
      }
      setEnabledPatterns(list);
      alert('已儲存：' + list.join(', ') + '\n重新整理頁面套用');
    });
  }

  // ---- SHA-256 (via SubtleCrypto) ----
  async function sha256(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(digest);
  }

  // ---- Base58 encode (no leading-zero handling needed here since prefix byte 0x41 != 0x00) ----
  function base58Encode(bytes) {
    let num = 0n;
    for (const b of bytes) {
      num = (num << 8n) + BigInt(b);
    }
    let encoded = '';
    while (num > 0n) {
      const rem = num % 58n;
      encoded = B58_ALPHABET[Number(rem)] + encoded;
      num = num / 58n;
    }
    // preserve leading zero bytes as '1'
    for (const b of bytes) {
      if (b === 0) encoded = '1' + encoded;
      else break;
    }
    return encoded;
  }

  function randomBytes(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return arr;
  }

  // ---- Generate a valid-format (checksum-correct) but random/fake TRC20 address ----
  async function generateFakeTRC20Address() {
    // Tron mainnet address prefix byte is 0x41, followed by 20 random bytes (fake "EVM-style" payload)
    const payload = new Uint8Array(21);
    payload[0] = 0x41;
    payload.set(randomBytes(20), 1);

    // checksum = first 4 bytes of double-SHA256(payload)
    const hash1 = await sha256(payload);
    const hash2 = await sha256(hash1);
    const checksum = hash2.slice(0, 4);

    const full = new Uint8Array(25);
    full.set(payload, 0);
    full.set(checksum, 21);

    return base58Encode(full);
  }

  // ---- UI: floating button + toast ----
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #trc20-gen-btn {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        background: #1a1a2e;
        color: #fff;
        border: 1px solid #444;
        border-radius: 24px;
        padding: 10px 16px;
        font-size: 13px;
        font-family: -apple-system, sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        opacity: 0.85;
        user-select: none;
      }
      #trc20-gen-btn:hover { opacity: 1; }
      #trc20-gen-toast {
        position: fixed;
        bottom: 65px;
        right: 20px;
        z-index: 999999;
        background: #16213e;
        color: #0f0;
        border: 1px solid #444;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12px;
        font-family: monospace;
        max-width: 320px;
        word-break: break-all;
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  function showToast(text) {
    let toast = document.getElementById('trc20-gen-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'trc20-gen-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => (toast.style.display = 'none'), 3500);
  }

  let lastFocusedInput = null;
  document.addEventListener(
    'focusin',
    (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        lastFocusedInput = e.target;
      }
    },
    true
  );

  function fillOrCopy(address) {
    if (lastFocusedInput && document.body.contains(lastFocusedInput)) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(lastFocusedInput, address);
      lastFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
      lastFocusedInput.dispatchEvent(new Event('change', { bubbles: true }));
      showToast('已填入欄位並複製：' + address);
    } else {
      showToast('已複製（無焦點欄位）：' + address);
    }
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(address);
    } else {
      navigator.clipboard.writeText(address).catch(() => {});
    }
  }

  function injectButton() {
    const btn = document.createElement('div');
    btn.id = 'trc20-gen-btn';
    btn.textContent = '🎲 TRC20';
    btn.title = '點擊生成合法格式測試地址，自動填入目前焦點欄位並複製';
    btn.addEventListener('click', async () => {
      const addr = await generateFakeTRC20Address();
      fillOrCopy(addr);
    });
    document.body.appendChild(btn);
  }

  // 選單一律註冊（不管這頁有沒有啟用），這樣使用者才能在任何網站上打開設定
  registerMenu();

  if (!isEnabledOnThisPage()) {
    return; // 這個網址不在啟用清單內，什麼都不做
  }

  injectStyles();
  if (document.body) {
    injectButton();
  } else {
    window.addEventListener('DOMContentLoaded', injectButton);
  }
})();
