// ==UserScript==
// @name         ed2k 連結修正（讓新版 Chrome 能開 eMule）
// @namespace    https://www.jk-web.com/
// @version      1.0
// @description  把 ed2k:// 連結裡 Chrome 不接受的字元（| [ ] 空白、中日文等）轉成 %XX，讓 Chrome 視為合法網址並交給 eMule；並修好 ed2k 勾選清單的「下載選中」「複製選中」按鈕
// @author       Jacky Jou
// @match        *://*/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ed2k-fix.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ed2k-fix.js
// ==/UserScript==

(function () {
  'use strict';

  // ed2k:// 不是 http 這類特殊 scheme，Chrome 依 WHATWG URL 規格把 // 後面當成 opaque host 解析。
  // host 裡出現 forbidden host code point 就整個網址無效、點了沒反應。
  // ASCII 只轉這幾個字元：/ 保留（它是 host 的結尾，eMule 連結本來就以 |/ 收尾，Windows 檔名也不會有 /），
  // % 保留（網站已經編碼過的 %20 之類不能再編一次）。
  const FORBIDDEN = /[\u0000\t\n\r #:<>?@[\\\]^|]/g;
  const encodeChar = (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');

  // 非 ASCII 字元（中日文等）也要自己轉成 UTF-8 %XX，不能交給 Chrome：
  // Chrome（實測 158）檢查 host 的 forbidden 字元時只看字元的低位元組，
  // 「名」U+540D（低位元組 0x0D）、「呼」U+547C（0x7C = |）這類字會讓整個網址被判無效。
  // 沒中招的字 Chrome 自己轉出來的 bytes 跟 encodeURIComponent 相同，所以 eMule 收到的內容不變。
  const encodeNonAscii = (run) => {
    try {
      return encodeURIComponent(run);
    } catch {
      return run; // 落單的 surrogate 無法編碼，原樣保留
    }
  };

  const isEd2k = (s) => typeof s === 'string' && /^ed2k:\/\//i.test(s);
  const fix = (s) =>
    isEd2k(s)
      ? s.slice(0, 7) +
        s.slice(7).replace(FORBIDDEN, encodeChar).replace(/[^\u0000-\u007F]+/g, encodeNonAscii)
      : s;

  // ─────────────────────────────────────────────────────────────
  // 勾選清單有兩種處理方式，依頁面結構（不是網域）逐一判斷：
  //
  // 新做法（tt1069 用的 static/js/emule.js 這套）：
  //   頁面有全域 download() / ed2kcopy()，按鈕 onclick 是 download('em',…) / ed2kcopy('em')，
  //   勾選框 name="em"、value 是原始 ed2k 連結。網站的 em_size() 會用 value.split('|') 算總大小，
  //   所以 value 不能改；改成包裝 download()，只在送出的那一刻換成修正版。
  //
  // 舊做法（其他網站的退路）：
  //   不認得網站的程式，只能直接把 value 改成修正版，讓「讀 value 再導向」的按鈕能用。
  //   副作用：網站若也拿 value 做別的事（例如用 | 切字串），可能會壞。
  //   改寫前把原值記在 original，之後若判定是新做法的結構（例如 emule.js 較晚載入），會還原。
  // ─────────────────────────────────────────────────────────────

  const original = new WeakMap(); // 舊做法改寫過的元素 → 原始 value

  // 新做法管轄的勾選框 name：從按鈕 onclick 裡 download('xx' / ed2kcopy('xx' 取出，且對應函式要存在
  let managedCache = null;
  function managedNames() {
    if (managedCache) return managedCache;
    const names = new Set();
    const fns = ['download', 'ed2kcopy'].filter((f) => typeof window[f] === 'function');
    if (fns.length) {
      const re = new RegExp(`\\b(?:${fns.join('|')})\\(\\s*['"]([^'"]+)['"]`, 'g');
      for (const el of document.querySelectorAll('[onclick]')) {
        const code = el.getAttribute('onclick');
        let m;
        while ((m = re.exec(code))) names.add(m[1]);
      }
    }
    return (managedCache = names);
  }
  const isManaged = (el) => !!el.name && managedNames().has(el.name);

  const rawValue = (el) => (original.has(el) ? original.get(el) : el.value);

  function fixElement(el) {
    if (el.tagName === 'A') {
      // 一般超連結：直接改 href（畫面上的檔名文字不動）
      const raw = el.getAttribute('href');
      const fixed = fix(raw);
      if (fixed !== raw) el.setAttribute('href', fixed);
      return;
    }
    if (!('value' in el)) return;
    if (isManaged(el)) {
      // 新做法：value 保持原貌；先前被舊做法改過的就還原
      if (original.has(el)) {
        el.value = original.get(el);
        original.delete(el);
      }
      return;
    }
    // 舊做法：直接改 value
    const v = el.value;
    if (!isEd2k(v)) return;
    const fixed = fix(v);
    if (fixed === v) return;
    original.set(el, v);
    el.value = fixed;
  }

  const SELECTOR = 'a[href^="ed2k://"], [value^="ed2k://"]';
  function fixNode(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(SELECTOR)) fixElement(root);
    root.querySelectorAll(SELECTOR).forEach(fixElement);
  }

  // ── 新做法：包裝網站的 download() / ed2kcopy() ──
  const managedBoxes = (name) =>
    typeof name === 'string'
      ? [...document.getElementsByName(name)].filter((el) => isEd2k(rawValue(el)))
      : [];

  // 「下載選中的文件」：download() 每輪同步執行 window.location = 勾選框.value，
  // 再用 setTimeout 呼叫全域 download() 處理下一個，所以每輪都會經過這層包裝。
  // 呼叫前把 value 換成修正版，結束後立刻換回原值。
  function wrapDownload() {
    const orig = window.download;
    if (typeof orig !== 'function' || orig._ed2kFix) return;
    const wrapped = function (name, ...rest) {
      const boxes = managedBoxes(name);
      const saved = boxes.map((el) => el.value);
      boxes.forEach((el) => { el.value = fix(rawValue(el)); });
      try {
        return orig.call(this, name, ...rest);
      } finally {
        boxes.forEach((el, i) => { el.value = saved[i]; });
      }
    };
    wrapped._ed2kFix = true;
    window.download = wrapped;
  }

  // 「複製選中的鏈接」：網站原本用 IE 專用的 document.body.createTextRange()，在 Chrome 會直接拋錯。
  // 改成複製勾選的原始連結（保留 |，貼進 eMule 的「貼上 eD2K 連結」用），一行一個。
  // 只把空白轉成 %20：eMule 的貼上視窗遇到含空白的連結會報「無效的連結」（中括號、中文沒問題），
  // 而 %20 加入後檔名會解回空白（實測）。
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // clipboard API 被拒時（權限、非安全環境）退回 execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
      return ok;
    }
  }

  function wrapCopy() {
    const orig = window.ed2kcopy;
    if (typeof orig !== 'function' || orig._ed2kFix) return;
    const replaced = function (name) {
      const boxes = managedBoxes(name);
      if (!boxes.length) return orig.apply(this, arguments);
      const links = boxes
        .filter((el) => el.checked)
        .map((el) => rawValue(el).replace(/ /g, '%20'));
      if (!links.length) {
        alert('沒有勾選任何連結');
        return;
      }
      const btns = [...document.querySelectorAll('[onclick*="ed2kcopy"]')]
        .filter((b) => 'value' in b && b.getAttribute('onclick').includes(`'${name}'`));
      copyText(links.join('\n')).then((ok) => {
        if (!ok) {
          alert('複製失敗，請改用右鍵複製連結');
          return;
        }
        for (const b of btns) {
          const label = b.value;
          b.value = `已複製 ${links.length} 個連結`;
          setTimeout(() => { b.value = label; }, 1500);
        }
      });
    };
    replaced._ed2kFix = true;
    window.ed2kcopy = replaced;
  }

  // ── 判斷與套用 ──
  function refresh() {
    managedCache = null;
    if (managedNames().size) {
      wrapDownload();
      wrapCopy();
    }
    fixNode(document.body);
  }

  refresh();
  // 網站的 emule.js 萬一比本腳本晚載入，load 時重新判斷一次（被舊做法改過的會還原）
  window.addEventListener('load', refresh);

  // 頁面之後用 JS 動態產生的連結、勾選框也一併處理
  new MutationObserver((muts) => {
    managedCache = null; // 新加入的按鈕可能帶來新的 name
    for (const m of muts) {
      if (m.type === 'attributes') fixNode(m.target);
      m.addedNodes.forEach(fixNode);
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href', 'value'],
  });

  // 保險：攔截所有點擊，萬一 href 在點擊瞬間才被設成 ed2k://| 也能修正
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest?.('a[href]');
      if (a) {
        const raw = a.getAttribute('href');
        const fixed = fix(raw);
        if (fixed !== raw) a.setAttribute('href', fixed);
      }
    },
    true
  );
})();
