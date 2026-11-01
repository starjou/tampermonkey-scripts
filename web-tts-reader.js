// ==UserScript==
// @name         萬用網頁自動朗讀
// @namespace    jacky.tts
// @version      1.2
// @description  用 Edge 的 Natural 語音朗讀任何網站的正文，讀完自動接下一頁。每個網站用點選方式設定一次即可。
// @author       Jacky Jou
// @match        *://*/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/web-tts-reader.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/web-tts-reader.js
// ==/UserScript==

(function () {
  'use strict';

  const synth = window.speechSynthesis;

  const TAG = '[朗讀]';
  // 段落結尾是這些符號 → 句子已經講完；不是 → 可能被切到下一頁
  const END_PUNCT = /[。！？!?…」』”"’）)～~—．.：:；;]$/;
  const DEFAULT_NEXT_TEXT = '下一[頁页章節节]|^下[頁页章]$|^next\\b';

  // 第一次安裝時內建的規則
  const PRESETS = [{
    id: 'oop-tw',
    name: 'oop.tw 小說',
    pattern: 'https://www.oop.tw/areada/*',
    content: '#article',
    next: '#next_url',
    nextText: DEFAULT_NEXT_TEXT,
    skip: 'ｏｏｐ|oop\\.tw|𝐨𝐨𝐩|域名|最新內容|請前往|請記住',
    loader: 'iframe',
    voice: '',
  }];

  // ======================================================================
  // 儲存：用 Tampermonkey 的儲存空間，所有網站共用同一份規則
  // ======================================================================
  const S = {
    get(k, d) { try { const v = GM_getValue(k); return v === undefined ? d : v; } catch { return d; } },
    set(k, v) { try { GM_setValue(k, v); } catch (e) { console.warn(TAG, '儲存失敗', e); } },
  };
  let rules = S.get('rules', null);
  if (!Array.isArray(rules)) { rules = PRESETS.map(r => ({ ...r })); S.set('rules', rules); }
  const saveRules = () => S.set('rules', rules);
  const settings = Object.assign({ voice: '', rate: 1, chunk: 1500, cps: 4.5 }, S.get('settings', {}));
  const saveSettings = () => S.set('settings', settings);

  // ======================================================================
  // 小工具
  // ======================================================================
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toRe = s => { if (!s) return null; try { return new RegExp(s, 'i'); } catch { return null; } };
  const globRe = g => new RegExp('^' + g.split('*').map(escapeRe).join('.*') + '$', 'i');
  const matches = (r, url) => { try { return !!r.pattern && globRe(r.pattern.trim()).test(url); } catch { return false; } };
  const findRule = url => rules.find(r => matches(r, url)) || null;
  const clean = t => t.replace(/[\s　]+/g, ' ').trim();
  const hasWord = t => /[\p{L}\p{N}]/u.test(t);
  const short = (t, n = 40) => (t.length > n ? t.slice(0, n) + '…' : t);

  function suggestPattern() {
    const seg = location.pathname.split('/').filter(Boolean);
    return location.origin + '/' + (seg.length > 1 ? seg[0] + '/' : '') + '*';
  }

  // 幫點選的元素產生一個能在每一頁找到它的 CSS 選擇器
  function cssPath(el) {
    const doc = el.ownerDocument;
    const uniq = sel => { try { return doc.querySelectorAll(sel).length === 1; } catch { return false; } };
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== doc.documentElement; e = e.parentElement) {
      if (e.id && !/\d{4,}/.test(e.id)) { // 帶很長數字的 id 通常每頁都不一樣，不用
        parts.unshift('#' + CSS.escape(e.id));
        if (uniq(parts.join(' > '))) return parts.join(' > ');
        continue;
      }
      let s = e.tagName.toLowerCase();
      const cls = [...e.classList]
        .filter(c => !/^(active|hover|selected|current|on|show|open)$/i.test(c) && !/\d{3,}/.test(c))
        .slice(0, 2);
      if (cls.length) s += cls.map(c => '.' + CSS.escape(c)).join('');
      const p = e.parentElement;
      if (p && [...p.children].filter(c => c.matches(s)).length > 1) {
        s += `:nth-of-type(${[...p.children].filter(c => c.tagName === e.tagName).indexOf(e) + 1})`;
      }
      parts.unshift(s);
      if (uniq(parts.join(' > '))) return parts.join(' > ');
    }
    return parts.join(' > ');
  }

  // 把一個區塊拆成一行一行的文字（<p>、<br>、<div> 都當成分段）
  function blockTexts(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll('script,style,noscript,iframe,ins,button,select,textarea').forEach(e => e.remove());
    c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    c.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,section,article,blockquote,tr,dd,dt')
      .forEach(b => { b.prepend('\n'); b.append('\n'); });
    return c.textContent.split(/\n+/);
  }

  function findNext(doc, url, r) {
    let a = null;
    if (r.next) {
      try {
        const el = doc.querySelector(r.next);
        a = el && (el.closest('a') || el.querySelector('a'));
      } catch {}
    }
    const re = toRe(r.nextText);
    if (!a && re) a = [...doc.querySelectorAll('a[href]')].find(x => re.test(clean(x.textContent)));
    const h = a && a.getAttribute('href');
    if (!h || /^\s*(javascript:|#)/i.test(h)) return null;
    try { return new URL(h, url).href; } catch { return null; }
  }

  // 從一份文件抓出：正文段落、下一頁網址、標題
  function extract(doc, url, r) {
    let box = null;
    try { box = doc.querySelector(r.content); } catch {}
    if (!box) return null;
    const skip = toRe(r.skip);
    const texts = blockTexts(box).map(clean).filter(t => t && hasWord(t) && !(skip && skip.test(t)));
    let next = findNext(doc, url, r);
    // 下一頁跑出網址規則（例如回到目錄）或指回自己 → 當作最後一頁
    if (next && (next === url || !matches(r, next))) next = null;
    return { texts, next, title: doc.title, url };
  }

  // ======================================================================
  // 載入下一頁
  // ======================================================================
  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    // 自己判斷編碼，Big5、GBK 的網站才不會亂碼
    let cs = (res.headers.get('content-type') || '').match(/charset=["']?([\w-]+)/i)?.[1];
    if (!cs) cs = new TextDecoder('latin1').decode(buf.slice(0, 4096)).match(/charset=["']?([\w-]+)/i)?.[1];
    let html;
    try { html = new TextDecoder(cs || 'utf-8').decode(buf); } catch { html = new TextDecoder('utf-8').decode(buf); }
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // 隱藏頁框：讓網站自己的 JS 跑完（例如把倒寫的文字轉正）再抓。
  // 注意：iframe 被移除時，瀏覽器會連帶取消正在播的語音，
  // 所以讀完先留著，等換頁、沒在發聲時才由 dropFrames() 移除。
  const frames = [];
  function dropFrames() { while (frames.length) frames.shift().remove(); }

  function loadViaIframe(url, r) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;height:300px;border:0';
      frames.push(f);
      const timer = setTimeout(() => reject(new Error('timeout')), 30000);
      f.onload = () => setTimeout(() => {
        clearTimeout(timer);
        try {
          const data = extract(f.contentDocument, url, r);
          data ? resolve(data) : reject(new Error('找不到正文區塊'));
        } catch (e) { reject(e); }
      }, 500);
      f.src = url;
      document.body.appendChild(f);
    });
  }

  async function loadPage(url, r) {
    if (r.loader === 'iframe') {
      try { return await loadViaIframe(url, r); } catch (e) { console.warn(TAG, '頁框載入失敗，改用直接下載', e); }
    }
    return extract(await fetchDoc(url), url, r);
  }

  // ======================================================================
  // 朗讀引擎
  // ======================================================================
  let rule = null;       // 目前網頁套用的規則
  let paras = [];        // [{ text, el }]
  let idx = 0;
  let playing = false;
  let loading = false;
  let carry = '';        // 上一頁被切斷的半句，接到下一頁開頭
  let curUrl = location.href;
  let nextInfo = null;   // { url, promise }
  let currentUtter = null;
  let estTimer = null;   // 語音沒回報字位時，用時間推算唸到哪一段
  let idleTicks = 0;
  const keep = [];       // 保留 utterance 參照，避免被回收導致 onend 不觸發

  // 診斷紀錄：朗讀忽然停住時，用 Tampermonkey 選單的「🩺 複製診斷紀錄」倒出來。
  // 常駐但很輕（只在事件發生時寫一行，最多留 400 行）。
  const recs = [];
  const rec0 = performance.now();
  let lastBoundaryAt = 0;
  let engineSig = '';
  function rec(s) {
    recs.push(`${((performance.now() - rec0) / 1000).toFixed(1)}s hidden=${document.hidden}`
      + ` speaking=${synth.speaking} pending=${synth.pending} paused=${synth.paused}`
      + ` 第${idx + 1}段 | ${s}`);
    if (recs.length > 400) recs.shift();
  }

  function prefetch(url) {
    nextInfo = url ? { url, promise: loadPage(url, rule).catch(() => null) } : null;
  }

  // 正文區塊改成我們自己的 <p>，方便反白和點段落開始唸
  function renderTexts(box, texts) {
    box.innerHTML = '';
    paras = texts.map(t => {
      const el = document.createElement('p');
      el.textContent = t;
      box.appendChild(el);
      return { text: t, el };
    });
    paras.forEach((p, i) => {
      p.el.style.cursor = 'pointer';
      p.el.title = '點一下從這段開始唸';
      p.el.onclick = () => { stopSpeech(); playing = true; updateBtn(); speak(i); };
    });
  }

  function initPage() {
    idx = 0;
    let box = null;
    try { box = document.querySelector(rule.content); } catch {}
    if (!box) { paras = []; setStatus('找不到正文區塊，按 ⚙ 重新設定'); return; }
    const data = extract(document, location.href, rule);
    curUrl = location.href;
    renderTexts(box, data.texts);
    prefetch(data.next);
    setStatus(paras.length ? `本頁 ${paras.length} 段，按 ▶ 或點段落開始` : '正文區塊裡沒有文字');
  }

  let lastHi = null;
  function highlight(i) {
    if (lastHi) lastHi.style.background = '';
    const el = paras[i]?.el;
    if (!el) return;
    el.style.background = 'rgba(255, 210, 0, .35)';
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    lastHi = el;
  }

  function pickVoice() {
    const vs = synth.getVoices();
    const want = (rule && rule.voice) || settings.voice;
    return vs.find(v => v.name === want)
      || vs.find(v => /zh-TW/i.test(v.lang) && /Natural/i.test(v.name))
      || vs.find(v => /zh-TW/i.test(v.lang))
      || null;
  }

  function speak(i) {
    if (!playing) return;
    if (i >= paras.length) { goNext(); return; }
    idx = i;
    const para = paras[i];

    // 最後一段沒講完（句子被切到下一頁）→ 先不唸，接到下一頁開頭一起唸
    if (i === paras.length - 1 && nextInfo && !END_PUNCT.test(para.text)) {
      carry = para.text;
      goNext();
      return;
    }

    // 從第 i 段開始，把後面的段落湊成一次朗讀（減少段落之間的停頓）
    const max = Number(settings.chunk) || 1500;
    let end = i;
    let text = para.text;
    const starts = [0]; // 每段在 text 裡的起始位置，用來同步反白
    while (end + 1 < paras.length) {
      const nx = paras[end + 1];
      const lastUnfinished = end + 1 === paras.length - 1 && nextInfo && !END_PUNCT.test(nx.text);
      if (lastUnfinished || text.length + 1 + nx.text.length > max) break;
      starts.push(text.length + 1);
      text += '\n' + nx.text;
      end++;
    }

    console.log(`${TAG} 送出第 ${i + 1}～${end + 1} 段，共 ${text.length} 字`);
    rec(`speak 第 ${i + 1}～${end + 1} 段，${text.length} 字`);
    highlight(i);
    const u = new SpeechSynthesisUtterance(text);

    const setPos = ch => {
      let k = 0;
      while (k + 1 < starts.length && ch >= starts[k + 1]) k++;
      if (currentUtter === u && i + k !== idx) {
        idx = i + k;
        highlight(idx);
        setStatus(`第 ${idx + 1} / ${paras.length} 段`);
      }
    };
    // 有的語音會回報唸到哪個字；沒回報就用時間推算
    let gotBoundary = false;
    let t0 = 0;
    u.onboundary = e => { gotBoundary = true; lastBoundaryAt = performance.now(); setPos(e.charIndex); };

    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'zh-TW'; }
    u.rate = Number(settings.rate) || 1;

    u.onstart = () => {
      rec(`onstart ${u.voice ? u.voice.name : '(預設語音)'}`);
      lastBoundaryAt = performance.now();
      idleTicks = 0;
      t0 = performance.now();
      clearInterval(estTimer);
      estTimer = setInterval(() => {
        if (currentUtter !== u || gotBoundary) { clearInterval(estTimer); return; }
        setPos((performance.now() - t0) / 1000 * settings.cps * u.rate);
      }, 400);
    };
    u.onend = () => {
      rec('onend');
      clearInterval(estTimer);
      if (!gotBoundary && t0) { // 用這批實際花的時間校正語速估計
        const sec = (performance.now() - t0) / 1000;
        if (sec > 2 && text.length > 20) {
          settings.cps = +(settings.cps * 0.5 + (text.length / sec / u.rate) * 0.5).toFixed(2);
          saveSettings();
        }
      }
      if (currentUtter === u && playing) speak(end + 1);
    };
    u.onerror = e => {
      rec(`onerror ${e.error}${currentUtter === u && playing ? '' : '（我們自己取消的）'}`);
      if (currentUtter !== u || !playing) return; // 是我們自己暫停／跳段取消的
      console.warn(TAG, e.error);
      if (e.error === 'interrupted' || e.error === 'canceled') {
        setTimeout(() => { if (currentUtter === u && playing) speak(idx); }, 300); // 被外部打斷 → 這段重唸
      } else {
        setTimeout(() => { if (currentUtter === u && playing) speak(end + 1); }, 500);
      }
    };

    currentUtter = u;
    keep.push(u);
    if (keep.length > 20) keep.shift();
    synth.speak(u);
    setStatus(`第 ${i + 1} / ${paras.length} 段`);
  }

  async function goNext() {
    if (loading) return;
    if (!nextInfo) { playing = false; updateBtn(); setStatus('已經是最後一頁了'); return; }
    loading = true;
    rec('換頁：開始載入 ' + nextInfo.url);
    setStatus('載入下一頁…');
    let data = await nextInfo.promise;
    if (!data) { try { data = await loadPage(nextInfo.url, rule); } catch { data = null; } }
    loading = false;
    if (!rule) return; // 讀的途中規則被刪掉了
    if (!data) { playing = false; updateBtn(); setStatus('下一頁載入失敗，已停止'); return; }

    dropFrames(); // 這時沒在發聲，移除舊頁框不會打斷語音
    let box = null;
    try { box = document.querySelector(rule.content); } catch {}
    if (!box) { playing = false; updateBtn(); setStatus('找不到正文區塊'); return; }
    renderTexts(box, data.texts);
    if (carry && paras[0]) { paras[0].text = carry + paras[0].text; paras[0].el.textContent = paras[0].text; }
    carry = '';
    document.title = data.title;
    curUrl = data.url;
    try { history.replaceState(null, '', data.url); } catch {} // 網址跟著走，之後重新整理能接著讀
    window.scrollTo(0, 0);
    rec('換頁完成 ' + data.url);
    prefetch(data.next);
    idx = 0;
    if (!paras.length) { goNext(); return; }
    if (playing) speak(0); else setStatus('已載入下一頁，按 ▶ 繼續');
  }

  function stopSpeech() {
    currentUtter = null;
    clearInterval(estTimer);
    synth.cancel();
  }

  // 保險：語音無聲無息停掉（onend、onerror 都沒觸發）時，自動從目前段落重唸
  setInterval(() => {
    if (playing) { // 引擎狀態一變就記一行，事後才看得出是哪一種停法
      const sig = `${synth.speaking}/${synth.pending}/${synth.paused}/${document.hidden}`;
      if (sig !== engineSig) { engineSig = sig; rec('引擎狀態改變'); }
      // 還在發聲卻很久沒回報唸到哪個字 → 反白會卡住
      if (synth.speaking && lastBoundaryAt && performance.now() - lastBoundaryAt > 10000) {
        rec(`已 ${((performance.now() - lastBoundaryAt) / 1000).toFixed(0)} 秒沒有 boundary`);
        lastBoundaryAt = performance.now();
      }
    }
    if (!playing || loading || !currentUtter || synth.speaking || synth.pending) { idleTicks = 0; return; }
    if (++idleTicks >= 2) {
      idleTicks = 0;
      rec('看門狗：重唸這一段');
      console.warn(TAG, '語音停住了，重新開始這一段');
      speak(idx);
    }
  }, 1500);

  // 背景（最小化／切到別的 app）時計時器會被節流，上面的看門狗幾乎不跑，
  // 所以回到前景時立刻補一次檢查：等同使用者自己按一下暫停再播放
  document.addEventListener('visibilitychange', () => {
    rec(document.hidden ? '切到背景' : '回到前景');
    if (document.hidden || !playing || loading) return;
    idleTicks = 0;
    if (synth.paused) { synth.resume(); return; } // 被外部暫停的話先試著接回去
    if (!synth.speaking && !synth.pending) {
      rec('回到前景時語音已停，接著唸');
      console.warn(TAG, '回到前景時語音已經停了，從第', idx + 1, '段接著唸');
      speak(idx);
    }
  });

  function togglePlay() {
    if (!paras.length) return;
    if (playing) { playing = false; stopSpeech(); setStatus('已暫停'); }
    else { playing = true; speak(idx); }
    updateBtn();
  }

  function skip(d) {
    if (!paras.length) return;
    const was = playing;
    stopSpeech();
    playing = was;
    idx = Math.max(0, Math.min(paras.length - 1, idx + d));
    if (playing) speak(idx); else highlight(idx);
  }

  // ======================================================================
  // 介面共用：放在 Shadow DOM 裡，不受網站 CSS 影響
  // ======================================================================
  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .card { position: fixed; z-index: 2147483647; background: #222; color: #eee;
      font: 13px/1.5 system-ui, "Microsoft JhengHei", sans-serif; padding: 10px 12px;
      border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,.5); }
    .config, .manager { top: 16px; right: 16px; width: 400px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px); overflow: auto; }
    .player { right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; max-width: 280px; }
    h3 { margin: 0 0 6px; font-size: 15px; }
    .field { margin: 7px 0; }
    .field > span { display: block; }
    small { opacity: .6; }
    input, select, textarea { width: 100%; background: #111; color: #eee; border: 1px solid #555;
      border-radius: 5px; padding: 4px 6px; font: 12px/1.4 Consolas, monospace; margin-top: 2px; }
    .player select { width: auto; font: 12px system-ui, sans-serif; }
    .player .voice { width: 100%; }
    textarea { height: 160px; }
    .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .row input { flex: 1; width: auto; }
    .actions { margin-top: 10px; }
    button { background: #444; color: #eee; border: 0; border-radius: 6px; padding: 4px 10px;
      cursor: pointer; font: 13px system-ui, sans-serif; white-space: nowrap; }
    button:hover { background: #555; }
    .player button { font-size: 16px; padding: 2px 10px; }
    .primary { background: #2a6df4; } .primary:hover { background: #3b7cff; }
    .danger { background: #a33; } .danger:hover { background: #c44; }
    pre { white-space: pre-wrap; word-break: break-all; background: #111; padding: 6px 8px;
      border-radius: 5px; font: 12px/1.5 Consolas, "Microsoft JhengHei", monospace; margin: 8px 0 0;
      max-height: 280px; overflow: auto; }
    pre:empty { display: none; }
    .status { opacity: .8; font-size: 12px; }
    .warn { color: #fd9; font-size: 12px; line-height: 1.4; }
    .warn:empty { display: none; }
    .notice { right: 12px; bottom: 12px; max-width: 320px; }
    .rule { display: flex; gap: 6px; align-items: center; padding: 5px 0; border-bottom: 1px solid #333; }
    .rule .info { flex: 1; min-width: 0; }
    .rule .pat { font: 11px Consolas, monospace; opacity: .6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  const hosts = {};
  function shadow(name) {
    closeHost(name);
    const h = document.createElement('div');
    h.setAttribute('data-tts-host', name);
    document.documentElement.appendChild(h);
    const root = h.attachShadow({ mode: 'open' });
    hosts[name] = h;
    return root;
  }
  function closeHost(name) { if (hosts[name]) { hosts[name].remove(); delete hosts[name]; } }

  // ======================================================================
  // 播放面板
  // ======================================================================
  let ui = null;
  function setStatus(t) { if (ui) ui.status.textContent = t; }
  function setWarn(t) { if (ui) ui.warn.textContent = t; }
  function updateBtn() { if (ui) ui.play.textContent = playing ? '⏸' : '▶'; }

  function buildPlayer() {
    const root = shadow('player');
    root.innerHTML = `<style>${CSS_TEXT}</style>
      <div class="card player">
        <div class="row">
          <button data-a="prev" title="上一段">⏮</button>
          <button data-a="play" title="播放／暫停（空白鍵）">▶</button>
          <button data-a="next" title="下一段">⏭</button>
          <select data-s="rate" title="語速"></select>
          <select data-s="chunk" title="每次送出多少文字（越多段落間停頓越少）"></select>
          <button data-a="cfg" title="這個網站的朗讀設定">⚙</button>
        </div>
        <select class="voice" data-s="voice" title="聲音"></select>
        <div class="status"></div>
        <div class="warn"></div>
      </div>`;
    const $ = s => root.querySelector(s);
    ui = { play: $('[data-a=play]'), status: $('.status'), voice: $('[data-s=voice]'), warn: $('.warn') };
    $('[data-a=prev]').onclick = () => skip(-1);
    ui.play.onclick = togglePlay;
    $('[data-a=next]').onclick = () => skip(1);
    $('[data-a=cfg]').onclick = () => openConfig(rule);

    const rate = $('[data-s=rate]');
    [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2].forEach(r => rate.add(new Option(r + 'x', r, false, r === Number(settings.rate))));
    rate.onchange = () => { settings.rate = Number(rate.value); saveSettings(); if (playing) skip(0); };

    const chunk = $('[data-s=chunk]');
    [[1, '逐段'], [300, '300字'], [600, '600字'], [1500, '1500字'], [99999, '整頁']]
      .forEach(([v, l]) => chunk.add(new Option(l, v, false, v === Number(settings.chunk))));
    chunk.onchange = () => { settings.chunk = Number(chunk.value); saveSettings(); if (playing) skip(0); };

    ui.voice.onchange = () => {
      settings.voice = ui.voice.value;
      saveSettings();
      if (rule) { rule.voice = ui.voice.value; saveRules(); } // 每個網站記住自己的聲音（不同語言的網站可分開設）
      if (playing) skip(0);
    };
    fillVoices();
    synth.addEventListener('voiceschanged', fillVoices);
    watchVoices();
    updateBtn();
  }

  // 語音清單是非同步載入的（剛開頁時 getVoices() 常常是空的），
  // 所以先查一次，查不到就等 voiceschanged，3 秒後還是空的才判定這個瀏覽器沒語音。
  function checkVoices() {
    if (!ui) return true;
    const all = synth.getVoices();
    if (!all.length) return false;
    const v = pickVoice();
    if (!v) {
      setWarn('這個瀏覽器沒有中文語音，會用系統預設語音唸，中文可能唸不出來。建議用 Edge。');
    } else if (!/Natural/i.test(v.name)) {
      // Natural 語音是 Edge 的線上語音，Chrome／Firefox 拿不到，只能用本機的舊語音
      setWarn(`目前用「${v.name}」。Edge 的 Natural 語音自然得多，建議用 Edge 開這一頁。`);
    } else {
      setWarn('');
    }
    return true;
  }

  function watchVoices() {
    if (checkVoices()) return;
    setTimeout(() => {
      if (!checkVoices()) setWarn('這個瀏覽器抓不到任何語音，無法朗讀。建議用 Edge（內建 Natural 語音）。');
    }, 3000);
  }

  function fillVoices() {
    if (!ui) return;
    const all = synth.getVoices();
    if (!all.length) return;
    const page = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
    const langs = new Set(['zh', page].filter(Boolean));
    let vs = all.filter(v => langs.has(v.lang.slice(0, 2).toLowerCase()));
    if (!vs.length) vs = all;
    const cur = pickVoice();
    if (cur && !vs.includes(cur)) vs.unshift(cur);
    ui.voice.innerHTML = '';
    vs.forEach(v => ui.voice.add(new Option(
      v.name.replace(/^Microsoft\s*/, '').replace(/\s*-\s*[^-]*$/, '') + ` (${v.lang})`,
      v.name, false, !!cur && v.name === cur.name)));
    checkVoices();
  }

  function activate(r) {
    playing = false;
    stopSpeech();
    nextInfo = null;
    carry = '';
    rule = r;
    if (!hosts.player) buildPlayer(); else fillVoices();
    updateBtn();
    setTimeout(() => { if (rule === r) initPage(); }, 500); // 等網站自己的 JS 跑完
  }

  function deactivate() {
    playing = false;
    stopSpeech();
    rule = null;
    paras = [];
    ui = null;
    closeHost('player');
  }

  // ======================================================================
  // 點選元素
  // ======================================================================
  function pick(kind) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #f80;background:rgba(255,136,0,.15);z-index:2147483646;display:none';
      const tip = document.createElement('div');
      tip.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);max-width:90vw;background:#222;color:#fff;padding:6px 12px;border-radius:6px;font:13px/1.5 system-ui,"Microsoft JhengHei",sans-serif;z-index:2147483647;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.5)';
      const hint = kind === 'next' ? '點「下一頁」的連結' : '點正文所在的區塊';
      tip.textContent = `${hint}（↑ 選大一層、↓ 選小一層、Enter 確定、Esc 取消）`;
      document.documentElement.append(box, tip);

      let cur = null, hover = null, stack = [];
      const show = el => {
        cur = el;
        const r = el.getBoundingClientRect();
        Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        const n = kind === 'content' ? `，約 ${blockTexts(el).map(clean).filter(hasWord).length} 段` : '';
        tip.textContent = `${hint}　目前：${short(cssPath(el), 60)}${n}　（↑ 大一層、↓ 小一層、Enter 確定、Esc 取消）`;
      };
      const move = e => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === hover || el.closest('[data-tts-host]')) return;
        hover = el;
        stack = [];
        show(kind === 'next' ? (el.closest('a') || el) : el);
      };
      const key = e => {
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
        else if (e.key === 'Enter' && cur) { e.preventDefault(); done(cur); }
        else if (e.key === 'ArrowUp' && cur && cur.parentElement && cur.parentElement !== document.documentElement) {
          e.preventDefault(); stack.push(cur); show(cur.parentElement);
        } else if (e.key === 'ArrowDown' && stack.length) { e.preventDefault(); show(stack.pop()); }
      };
      const block = e => {
        if (e.target.closest && e.target.closest('[data-tts-host]')) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      };
      const click = e => { block(e); if (cur) done(cur); };
      const evs = [['mousemove', move], ['click', click], ['mousedown', block], ['mouseup', block], ['keydown', key]];
      evs.forEach(([t, f]) => document.addEventListener(t, f, true));
      function done(el) {
        evs.forEach(([t, f]) => document.removeEventListener(t, f, true));
        box.remove();
        tip.remove();
        resolve(el);
      }
    });
  }

  // ======================================================================
  // 設定面板（單一網站的規則）
  // ======================================================================
  function openConfig(r) {
    closeHost('manager');
    const draft = Object.assign({
      id: 'r' + Date.now(), name: location.hostname, pattern: suggestPattern(),
      content: '', next: '', nextText: DEFAULT_NEXT_TEXT, skip: '', loader: 'fetch', voice: '',
    }, r || {});
    const exists = rules.some(x => x.id === draft.id);
    const root = shadow('config');
    root.innerHTML = `<style>${CSS_TEXT}</style>
      <div class="card config">
        <h3>朗讀設定</h3>
        <div class="field"><span>名稱</span><input name="name"></div>
        <div class="field"><span>網址規則 <small>* 代表任意文字，符合的網頁才會出現朗讀面板</small></span><input name="pattern"></div>
        <div class="field"><span>正文區塊</span>
          <div class="row"><input name="content" placeholder="CSS 選擇器"><button data-pick="content">點選</button></div></div>
        <div class="field"><span>下一頁連結 <small>選填</small></span>
          <div class="row"><input name="next" placeholder="CSS 選擇器"><button data-pick="next">點選</button></div></div>
        <div class="field"><span>找不到上面的連結時，用連結文字找 <small>正規表示式</small></span><input name="nextText"></div>
        <div class="field"><span>略過含有這些字的段落 <small>正規表示式，選填，例如 廣告|請記住</small></span><input name="skip"></div>
        <div class="field"><span>下一頁載入方式</span>
          <select name="loader">
            <option value="fetch">直接下載（快，多數網站適用）</option>
            <option value="iframe">隱藏頁框（網站用 JS 處理文字時，例如文字是倒的）</option>
          </select></div>
        <div class="row actions">
          <button data-a="preview">預覽</button>
          <button data-a="save" class="primary">儲存</button>
          ${exists ? '<button data-a="del" class="danger">刪除</button>' : ''}
          <button data-a="manage">所有規則</button>
          <button data-a="close">關閉</button>
        </div>
        <pre class="out"></pre>
      </div>`;
    const $ = s => root.querySelector(s);
    const keys = ['name', 'pattern', 'content', 'next', 'nextText', 'skip', 'loader'];
    keys.forEach(k => { $(`[name=${k}]`).value = draft[k] || ''; });
    const read = () => { const d = { ...draft }; keys.forEach(k => { d[k] = $(`[name=${k}]`).value.trim(); }); return d; };
    const out = $('.out');
    const say = t => { out.textContent = t; };

    root.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
      const kind = b.dataset.pick;
      hosts.config.style.display = 'none';
      const el = await pick(kind);
      if (hosts.config) hosts.config.style.display = '';
      if (!el) return;
      if (kind === 'content') {
        $('[name=content]').value = cssPath(el);
      } else {
        const a = el.closest('a');
        if (!a) { say('你點的不是連結，請點「下一頁」那個連結。'); return; }
        $('[name=next]').value = cssPath(a);
        const txt = clean(a.textContent);
        const re = toRe($('[name=nextText]').value);
        if (txt && txt.length <= 10 && !(re && re.test(txt))) {
          const cur = $('[name=nextText]').value;
          $('[name=nextText]').value = (cur ? cur + '|' : '') + '^' + escapeRe(txt) + '$';
        }
      }
      preview();
    });

    async function preview() {
      const d = read();
      const lines = [];
      lines.push(matches(d, location.href) ? '✓ 網址規則符合目前網頁' : '⚠ 網址規則不符合目前網頁（儲存後這頁不會出現朗讀面板）');
      const cur = extract(document, location.href, d);
      if (!cur) { lines.push('⚠ 找不到正文區塊'); say(lines.join('\n')); return; }
      const chars = cur.texts.reduce((n, t) => n + t.length, 0);
      lines.push(`本頁：${cur.texts.length} 段，${chars} 字`);
      cur.texts.slice(0, 2).forEach(t => lines.push('  ' + short(t)));
      if (cur.texts.length > 4) lines.push('  …');
      cur.texts.slice(Math.max(2, cur.texts.length - 2)).forEach(t => lines.push('  ' + short(t)));
      lines.push('下一頁：' + (cur.next || '（找不到，或不符合網址規則 → 讀完這頁就停）'));
      say(lines.join('\n'));
      if (!cur.next) return;
      say(lines.join('\n') + '\n載入下一頁測試中…');
      let nx = null, err = '';
      try { nx = await loadPage(cur.next, d); } catch (e) { err = e.message; }
      if (nx) {
        lines.push(`下一頁內容：${nx.texts.length} 段（請確認文字正常，若是倒的或亂碼，載入方式改「隱藏頁框」）`);
        nx.texts.slice(0, 2).forEach(t => lines.push('  ' + short(t)));
        lines.push('再下一頁：' + (nx.next || '（沒有）'));
      } else {
        lines.push('⚠ 下一頁載入失敗' + (err ? '：' + err : '，可能抓不到正文區塊'));
      }
      say(lines.join('\n'));
    }

    $('[data-a=preview]').onclick = preview;
    $('[data-a=close]').onclick = () => closeHost('config');
    $('[data-a=manage]').onclick = openManager;
    $('[data-a=save]').onclick = () => {
      const d = read();
      if (!d.pattern || !d.content) { say('網址規則和正文區塊一定要填。'); return; }
      const i = rules.findIndex(x => x.id === d.id);
      if (i >= 0) rules[i] = d; else rules.push(d);
      saveRules();
      if (matches(d, location.href)) { activate(d); say('已儲存，朗讀面板已套用新設定。'); }
      else { if (rule && rule.id === d.id) deactivate(); say('已儲存。這個網址規則不符合目前網頁，到符合的網頁才會出現朗讀面板。'); }
    };
    const del = $('[data-a=del]');
    if (del) {
      del.onclick = () => {
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = '確定刪除？'; return; }
        rules = rules.filter(x => x.id !== draft.id);
        saveRules();
        if (rule && rule.id === draft.id) deactivate();
        closeHost('config');
      };
    }
  }

  // ======================================================================
  // 管理所有規則
  // ======================================================================
  function openManager() {
    closeHost('config');
    const root = shadow('manager');
    root.innerHTML = `<style>${CSS_TEXT}</style>
      <div class="card manager">
        <h3>所有網站規則</h3>
        <div class="list"></div>
        <div class="row actions"><button data-a="new" class="primary">為這個網站新增</button><button data-a="close">關閉</button></div>
        <div class="field"><span>匯出／匯入 <small>可直接修改後按「套用 JSON」，或貼上別台電腦匯出的內容</small></span>
          <textarea spellcheck="false"></textarea></div>
        <div class="row"><button data-a="json">套用 JSON</button></div>
        <pre class="out"></pre>
      </div>`;
    const $ = s => root.querySelector(s);
    const list = $('.list');
    const ta = $('textarea');
    const render = () => {
      list.innerHTML = '';
      if (!rules.length) list.textContent = '（還沒有規則）';
      rules.forEach(r => {
        const row = document.createElement('div');
        row.className = 'rule';
        const info = document.createElement('div');
        info.className = 'info';
        const nm = document.createElement('div');
        nm.textContent = (r.name || '(未命名)') + (matches(r, location.href) ? '　← 目前網頁' : '');
        const pt = document.createElement('div');
        pt.className = 'pat';
        pt.textContent = r.pattern;
        info.append(nm, pt);
        const edit = document.createElement('button');
        edit.textContent = '編輯';
        edit.onclick = () => openConfig(r);
        const del = document.createElement('button');
        del.textContent = '刪除';
        del.className = 'danger';
        del.onclick = () => {
          if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = '確定？'; return; }
          rules = rules.filter(x => x.id !== r.id);
          saveRules();
          if (rule && rule.id === r.id) deactivate();
          render();
        };
        row.append(info, edit, del);
        list.appendChild(row);
      });
      ta.value = JSON.stringify(rules, null, 2);
    };
    render();
    $('[data-a=close]').onclick = () => closeHost('manager');
    $('[data-a=new]').onclick = () => openConfig(null);
    $('[data-a=json]').onclick = () => {
      let arr;
      try { arr = JSON.parse(ta.value); } catch (e) { $('.out').textContent = 'JSON 格式錯誤：' + e.message; return; }
      if (!Array.isArray(arr) || arr.some(x => !x || typeof x.pattern !== 'string' || typeof x.content !== 'string')) {
        $('.out').textContent = '格式不對：要是一個陣列，每條規則至少要有 pattern 和 content。';
        return;
      }
      rules = arr.map((x, i) => ({ id: x.id || 'r' + Date.now() + i, ...x }));
      saveRules();
      render();
      const r = findRule(location.href);
      if (r) activate(r); else if (rule) deactivate();
      $('.out').textContent = `已套用 ${rules.length} 條規則。`;
    };
  }

  // ======================================================================
  // 啟動
  // ======================================================================
  // 沒有 speechSynthesis（例如舊版瀏覽器、某些手機瀏覽器）→ 只在有設規則的網頁提示一次，
  // 其餘什麼都不裝，免得在每個網站都跳東西出來。
  function showUnsupported() {
    const root = shadow('notice');
    root.innerHTML = `<style>${CSS_TEXT}</style>
      <div class="card notice">
        <div>這個瀏覽器不支援朗讀（沒有 Web Speech API），無法使用。</div>
        <div class="warn">建議改用 Edge，它內建中文 Natural 語音。</div>
        <div class="row actions"><button data-a="close">知道了</button></div>
      </div>`;
    root.querySelector('[data-a=close]').onclick = () => closeHost('notice');
  }

  const rule0 = findRule(location.href);
  if (!synth) {
    if (rule0) showUnsupported();
    return;
  }

  GM_registerMenuCommand('⚙ 設定這個網站的朗讀', () => openConfig(findRule(location.href)));
  GM_registerMenuCommand('📋 管理所有網站規則', openManager);
  GM_registerMenuCommand('🩺 複製診斷紀錄', () => {
    const txt = recs.join('\n');
    console.log(txt); // 一定會印一份，萬一複製失敗可以從 Console（F12）拿
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(txt, 'text');
      alert(`已複製 ${recs.length} 行診斷紀錄`);
    } else {
      alert(`${recs.length} 行診斷紀錄已印在 Console（F12）`);
    }
  });

  // 空白鍵＝播放／暫停（只在有套用規則的網頁、且不是在輸入框裡）
  document.addEventListener('keydown', e => {
    if (!rule || e.code !== 'Space' || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.composedPath()[0];
    if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
    togglePlay();
  });

  if (rule0) activate(rule0);
})();
