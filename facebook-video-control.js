// ==UserScript==
// @name         Facebook Video Control
// @namespace    https://www.jk-web.com/
// @version      2.16
// @description  在 Facebook 的 Reels 顯示全螢幕控制器
// @author       Jacky Jou
// @match        https://www.facebook.com/*
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-video-control.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-video-control.js
// ==/UserScript==
(function () {
    'use strict';

    // 開 true 會在 console 印出每支 video 的解靜音／插按鈕時間點，用來抓延遲。
    const DEBUG = false;
    // DEBUG 開著時每秒印一次呼叫次數，用來確認捲動卡頓是不是我們造成的
    const stats = { setup: 0, insert: 0 };
    if (DEBUG) setInterval(() => {
        if (stats.setup || stats.insert) console.log('[fbvc] 每秒次數', { ...stats });
        stats.setup = stats.insert = 0;
    }, 1000);
    let seq = 0;
    function log(v, msg) {
        if (!DEBUG) return;
        if (!v._fbFsId) v._fbFsId = ++seq;
        console.log(`[fbvc ${performance.now().toFixed(0)}ms] #${v._fbFsId} ${msg}`);
    }

    // ── 全螢幕攔截 ──────────────────────────────────────────
    let blockClickActive = false;
    let currentVideo = null;
    let exitChecker = null;
    const BLOCK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

    function blockClick(e) {
        if (!blockClickActive) return;

        // log 放在早退之前：target 不是 VIDEO 時也要看得到。否則「沒有 log」會同時
        // 代表「沒收到事件」和「收到但早退了」兩種完全不同的情況，無法判讀。
        if (DEBUG) {
            const at = document.elementFromPoint(e.clientX, e.clientY);
            console.log(`[fbvc] blockClick ${e.type}`,
                `target=${e.target.tagName}.${e.target.className || ''}`,
                `elementFromPoint=${at?.tagName}.${at?.className || ''}`,
                `命中快轉鈕=${!!overlaySeekAt(e.clientX, e.clientY)}`,
                `popoverOpen=${!!fsSeek?.matches(':popover-open')}`);
        }

        if (e.target.tagName !== 'VIDEO') return;
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        // 全螢幕內的快轉鈕靠這條生效。實測（Chrome）：popover 在全螢幕 video
        // 之上畫得出來，但收不到點擊——elementFromPoint 在按鈕的座標上回傳的是
        // VIDEO，綁在按鈕上的 listener 一次都沒被觸發。所以改用落點座標比對，
        // 不依賴瀏覽器的 hit-testing。
        const run = overlaySeekAt(e.clientX, e.clientY);
        if (run) {
            if (e.type === 'click') {
                run();
                bumpFsSeek();
            }
            return;
        }

        if (e.type === 'click') {
            if (e.target.paused) {
                restorePlay(e.target);   // 使用者主動要播，先解除抑制
                e.target.play();
            } else {
                e.target.pause();
                suppressPlay(e.target);
            }
        }
    }

    // 暫停後短暫把 play 換成 no-op，擋掉 FB 自己把影片接回去播。
    // 一定要防重入：原本的寫法沒有守衛，300ms 內再點一次會把「已經被換掉的 stub」
    // 當成 originalPlay 存起來，計時器到期後又把 stub 永久裝回 v.play，
    // 從此 play() 永遠不做事——症狀是連點幾下之後連 play/pause 都失效。
    const PLAY_SUPPRESS_MS = 300;

    function suppressPlay(v) {
        if (v._fbFsOrigPlay) return;   // 已經在抑制中，不要再包一層
        v._fbFsOrigPlay = v.play;
        v.play = () => Promise.resolve();
        v._fbFsPlayTimer = setTimeout(() => restorePlay(v), PLAY_SUPPRESS_MS);
    }

    function restorePlay(v) {
        if (!v._fbFsOrigPlay) return;
        clearTimeout(v._fbFsPlayTimer);
        v.play = v._fbFsOrigPlay;
        v._fbFsOrigPlay = null;
        v._fbFsPlayTimer = null;
    }

    function enableBlock(v) {
        currentVideo = v;
        blockClickActive = true;
        BLOCK_EVENTS.forEach(evt => {
            document.addEventListener(evt, blockClick, true);
            v.addEventListener(evt, blockClick, true);
        });
        clearInterval(exitChecker);
        exitChecker = setInterval(() => {
            if (!document.fullscreenElement) disableBlock();
        }, 300);
    }

    function disableBlock() {
        clearInterval(exitChecker);
        exitChecker = null;
        hideFsSeek();
        BLOCK_EVENTS.forEach(evt => {
            document.removeEventListener(evt, blockClick, true);
            if (currentVideo) currentVideo.removeEventListener(evt, blockClick, true);
        });
        if (currentVideo) restorePlay(currentVideo);   // 抑制中就離開全螢幕的話要收乾淨
        blockClickActive = false;
        currentVideo = null;
    }

    // ── 快轉鈕 ──────────────────────────────────────────────
    // 不自己做 overlay、不自己做淡入淡出：直接把按鈕塞進 FB 的控制列，
    // 顯示／隱藏完全沿用 FB 自己的 hover 機制。
    // 注意：全螢幕是對 video 本身下的，FB 控制列不在 video 子樹裡，
    // 所以這組按鈕在全螢幕時不會出現——那時候用的是 Chrome 的原生控制列。
    const SEEK_SECONDS = 5;
    const BTN_GAP = '8px';   // 我們插入的按鈕之間、以及跟靜音鈕之間的間距

    // icon 全部手寫 path（userscript 不適合外掛 icon library：要嘛連外部 CDN、
    // 要嘛塞一整包 base64 字型）。三個都取自 Material Symbols outlined，
    // 網格是 0 -960 960 960（跟舊的 Material Icons 的 0 0 24 24 不同）。
    //
    // ⚠ Material Symbols 有 optical size 軸：每個尺寸是**分別畫的**，不是同一條
    // path 縮放。小尺寸版本筆畫較粗、細節較簡化。所以這裡每個 icon 存兩份，
    // 依實際渲染尺寸挑：控制列 20px 用 opsz20，全螢幕 28px 用 opsz24
    // （對應 Google 網站下載 28dp 時給的就是 opsz24）。
    // 只用一份去縮放的話，小尺寸會太細、大尺寸會太粗——這是先前對不上的原因。
    const ICON_VIEWBOX = '0 -960 960 960';
    const ICON = {
        back: {
            20: '<path d="M480-144q-140 0-238-98t-98-238h72q0 109 77.5 186.5T480-216q109 0 186.5-77.5T744-480q0-109-77.5-186.5T480-744q-62 0-114.55 25.6Q312.91-692.8 277-648h107v72H144v-240h72v130q46-60 114.5-95T480-816q70 0 131.13 26.6 61.14 26.6 106.4 71.87 45.27 45.26 71.87 106.4Q816-550 816-480t-26.6 131.13q-26.6 61.14-71.87 106.4-45.26 45.27-106.4 71.87Q550-144 480-144Zm100-200L444-480v-192h72v162l115 115-51 51Z"/>',
            24: '<path d="M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z"/>',
        },
        fwd: {
            20: '<path d="M480-144q-70 0-131.13-26.6-61.14-26.6-106.4-71.87-45.27-45.26-71.87-106.4Q144-410 144-480t26.6-131.13q26.6-61.14 71.87-106.4 45.26-45.27 106.4-71.87Q410-816 480-816q81 0 149.5 35T744-686v-130h72v240H576v-72h107q-35.91-44.8-88.45-70.4Q542-744 480-744q-109 0-186.5 77.5T216-480q0 109 77.5 186.5T480-216q109 0 186.5-77.5T744-480h72q0 140-98 238t-238 98Zm100-200L444-480v-192h72v162l115 115-51 51Z"/>',
            24: '<path d="M480-120q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-480q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-840q82 0 155.5 35T760-706v-94h80v240H600v-80h110q-41-56-101-88t-129-32q-117 0-198.5 81.5T200-480q0 117 81.5 198.5T480-200q105 0 183.5-68T756-440h82q-15 137-117.5 228.5T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z"/>',
        },
        fs: {
            20: '<path d="M144-144v-192h72v120h120v72H144Zm480 0v-72h120v-120h72v192H624ZM144-624v-192h192v72H216v120h-72Zm600 0v-120H624v-72h192v192h-72Z"/>',
            24: '<path d="M120-120v-200h80v120h120v80H120Zm520 0v-80h120v-120h80v200H640ZM120-640v-200h200v80H200v120h-80Zm640 0v-120H640v-80h200v200h-80Z"/>',
        },
    };

    function iconSvg(icon, size) {
        const opsz = size <= 22 ? 20 : 24;
        return `<svg width="${size}" height="${size}" viewBox="${ICON_VIEWBOX}" fill="currentColor" style="display:block">${icon[opsz]}</svg>`;
    }

    // ── 工具函式 ────────────────────────────────────────────
    // 「在畫面內」也算進來：離開畫面的 reel 不該再被處理。往上爬 10 層做
    // querySelector 在捲動時很貴，捲過去的影片如果還在跑重試就會拖慢捲動。
    function isReelVideo(v) {
        if (!location.href.includes('/reel/')) return false;
        const r = v.getBoundingClientRect();
        if (r.width < 100 || r.height < 100) return false;
        return r.top < window.innerHeight && r.bottom > 0;
    }

    // 一次把「靜音」和「取消靜音」都查出來。先前是兩個 label 各爬一次 10 層祖先，
    // 每層 querySelector 掃的子樹又越爬越大，等於白做一倍的工。
    const MUTE_SELECTOR = 'div[aria-label="靜音"], div[aria-label="取消靜音"]';

    function findCtrlBtns(v) {
        const found = { mute: null, unmute: null };
        const scan = (root) => {
            if (!root) return false;
            for (const el of root.querySelectorAll(MUTE_SELECTOR)) {
                const label = el.getAttribute('aria-label');
                if (label === '靜音') found.mute ??= el;
                else found.unmute ??= el;
            }
            return !!(found.mute || found.unmute);
        };

        if (scan(v.nextElementSibling)) return found;
        let el = v.parentElement;
        for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
            if (scan(el)) return found;
        }
        return found;
    }

    // 重試變密之後這裡會被叫很多次，要防止「已經解過還一直點 FB 按鈕」把聲音又 toggle 回去。
    // _fbFsUnmuted 代表「FB 自己的按鈕已經被點過、內部 state 同步了」。
    function unmute(v, unmuteBtn) {
        if (!v.muted && v._fbFsUnmuted) return;
        if (unmuteBtn) {
            unmuteBtn.click();
            v._fbFsUnmuted = true;
            log(v, '點 FB 取消靜音鈕');
        } else if (v.muted) {
            v.muted = false;
            log(v, '控制列還沒出現，直接設 muted=false');
        }
    }

    // 樣式不自己寫、也不量測，直接複製 FB 靜音鈕那整塊節點，只把裡面的圖示換掉。
    // 原因：FB 的圖示是 <i> 貼 sprite（background-image + background-position），
    // 不是 svg；圓形背景與尺寸來自 div[role=button] 自己那串原子 class，不是某層的
    // background-color。所以「量尺寸／讀顏色」的作法抓不到東西，clone 才會一致——
    // 連 hover 效果和按鈕間距都直接沿用，FB 改版也跟著變。
    function makeCtrlBtn(anchor, label, icon, onClick) {
        const outer = anchor.cloneNode(true);
        outer.classList.add('fb-fs-btn');
        // clone 出來的節點在控制列裡是彼此相鄰的，FB 原本沒有給間距，要自己補
        outer.style.marginInlineStart = BTN_GAP;

        const btn = outer.querySelector('[role="button"]');
        if (!btn) return null;
        btn.setAttribute('aria-label', label);
        btn.removeAttribute('aria-pressed');

        // 換掉 sprite 圖示，尺寸沿用原本那個 <i>，其餘子節點（FB 的 hover 疊層）保留
        const sprite = btn.querySelector('[data-visualcompletion="css-img"]');
        const size = sprite ? (parseInt(sprite.style.width, 10) || 20) : 20;
        const svg = document.createElement('span');
        svg.style.cssText = `display:inline-block;width:${size}px;height:${size}px;color:#fff`;
        svg.innerHTML = iconSvg(icon, size);
        if (sprite) sprite.replaceWith(svg); else btn.prepend(svg);

        // clone 出來的節點沒有 React fiber，FB 的委派事件不會認它；
        // 我們自己的 handler 再擋一次傳遞，避免冒泡到 FB 的 root listener。
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            onClick();
        });
        return outer;
    }

    function seek(v, delta) {
        const dur = v.duration || Infinity;
        v.currentTime = Math.max(0, Math.min(dur, v.currentTime + delta));
    }

    function goFullscreen(v) {
        setTimeout(() => {
            enableBlock(v);
            // 一定要對 video 本身全螢幕：Chrome 的原生播放器控制列只有在
            // fullscreenElement 是 video 元素時才會出現。改成對容器全螢幕的話，
            // 原生控制列不會出現，反而是 FB 自己的控制列被一起帶進全螢幕。
            v.requestFullscreen()
                .then(() => showFsSeek(v))
                .catch(() => disableBlock());
        }, 0);
    }

    // ── 全螢幕內的快轉鈕（popover / top layer）────────────────
    // video 是 replaced element，子節點不會被渲染，而 Fullscreen API 只渲染
    // fullscreenElement 的子孫——所以全螢幕時沒有任何一般 DOM 疊得上去。
    // 唯一的例外是 top layer：全螢幕元素、modal dialog、popover 都住在那裡，
    // 而且「後進來的畫在上面」，所以進全螢幕之後才 showPopover() 就會蓋在影片上。
    // 用 popover=manual 而不是 dialog.showModal()，因為 modal 會讓其餘內容 inert，
    // 原生控制列就點不動了。
    const FS_SEEK_HIDE = 2500;   // 滑鼠靜止多久後淡出（對齊原生控制列的節奏）
    const FS_SEEK_FADE = 300;    // 淡入淡出時間（ms）
    let fsSeek = null;
    let fsSeekTimer = null;

    // 這兩顆按鈕純粹是畫面：全螢幕時它們收不到任何事件（見 blockClick 的註解），
    // 所以不綁 listener，點擊一律由 blockClick 用座標判斷後執行 _run。
    function createOverlayBtn(icon, label, onClick) {
        const btn = document.createElement('div');
        btn.setAttribute('aria-label', label);
        btn.setAttribute('role', 'button');
        btn._run = onClick;   // 給 blockClick 的座標比對用
        btn.innerHTML = iconSvg(icon, 28);
        Object.assign(btn.style, {
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            background: 'rgba(0,0,0,.55)',
            color: '#fff',
            userSelect: 'none',
        });
        return btn;
    }

    function showFsSeek(v) {
        if (!('popover' in HTMLElement.prototype)) return;   // 瀏覽器不支援就跳過
        hideFsSeek();

        const wrap = document.createElement('div');
        wrap.popover = 'manual';
        // popover 的 UA 樣式有 border/padding/background 和 inset:auto + margin:auto，
        // 要全部壓掉才能當成一整片透明的覆蓋層。
        wrap.style.cssText = `
            position:fixed; inset:0; width:100%; height:100%;
            max-width:none; max-height:none; margin:0; border:0; padding:0;
            background:transparent; overflow:visible;
            display:flex; align-items:center; justify-content:center; gap:88px;
            opacity:0; pointer-events:none;
        `;
        // transition 用 inline !important：FB 有帶 !important 的全域規則會蓋掉一般 inline style
        wrap.style.setProperty('transition', `opacity ${FS_SEEK_FADE}ms`, 'important');

        const btns = [
            createOverlayBtn(ICON.back, `倒轉 ${SEEK_SECONDS} 秒`, () => seek(v, -SEEK_SECONDS)),
            createOverlayBtn(ICON.fwd, `快轉 ${SEEK_SECONDS} 秒`, () => seek(v, SEEK_SECONDS)),
        ];
        btns.forEach(b => wrap.appendChild(b));
        wrap._seekBtns = btns;
        document.body.appendChild(wrap);
        wrap.showPopover();
        fsSeek = wrap;

        document.addEventListener('mousemove', bumpFsSeek);
        document.addEventListener('mouseout', onFsMouseOut);
        void wrap.offsetWidth;   // 先讓 opacity:0 落地，同一 tick 再切 1，淡入才會跑
        bumpFsSeek();
    }

    // relatedTarget 是 null 代表滑鼠離開了整個視窗（多螢幕時移到另一個螢幕），
    // 這時不等閒置計時，直接開始淡出。
    function onFsMouseOut(e) {
        if (!e.relatedTarget) fadeOutFsSeek();
    }

    // 座標落在哪顆快轉鈕上？淡出中／已隱藏就不算，避免看不見還能按。
    function overlaySeekAt(x, y) {
        if (!fsSeek || fsSeek.style.opacity === '0') return null;
        for (const btn of fsSeek._seekBtns || []) {
            const r = btn.getBoundingClientRect();
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return btn._run;
        }
        return null;
    }

    function bumpFsSeek() {
        if (!fsSeek) return;
        if (!fsSeek.matches(':popover-open')) fsSeek.showPopover();
        fsSeek.style.opacity = '1';
        clearTimeout(fsSeekTimer);
        fsSeekTimer = setTimeout(fadeOutFsSeek, FS_SEEK_HIDE);
    }

    function fadeOutFsSeek() {
        if (!fsSeek) return;
        clearTimeout(fsSeekTimer);
        fsSeek.style.opacity = '0';
        // 淡完直接退出 top layer，不用 pointer-events 去擋——整片覆蓋層留在
        // top layer 卻看不見的話，會攔掉原生控制列的點擊。
        fsSeekTimer = setTimeout(() => fsSeek?.hidePopover(), FS_SEEK_FADE);
    }

    function hideFsSeek() {
        document.removeEventListener('mousemove', bumpFsSeek);
        document.removeEventListener('mouseout', onFsMouseOut);
        clearTimeout(fsSeekTimer);
        fsSeekTimer = null;
        fsSeek?.remove();   // remove() 會一併退出 top layer
        fsSeek = null;
    }

    function removeOurBtns(v) {
        v._fbFsBtns?.forEach(n => n.remove());
        v._fbFsBtns = null;
    }

    function ourBtnsAlive(v) {
        return v._fbFsBtns?.length > 0 && v._fbFsBtns.every(n => document.contains(n));
    }

    function insertFSBtn(v, sndBtn) {
        // 只移除「這支 video 自己的」舊按鈕。之前用全域 id 砍，
        // 多支 reel 同時被 setup 時會互砍，按鈕每輪 polling 閃一次。
        removeOurBtns(v);
        const anchor = sndBtn.parentNode.parentNode.parentNode;
        // 這條控制列上已經有別支 video 插的按鈕就不要再插（findBtn 會往上爬 10 層，
        // 有機會抓到隔壁 reel 的靜音鈕），否則兩支 video 會互相覆蓋。
        if (anchor.parentNode?.querySelector('.fb-fs-btn')) return;

        // 三顆各自 clone 成跟靜音鈕同一層的兄弟節點插進控制列，
        // 間距就直接吃控制列本來的排版規則，不用自己補 margin/gap。
        const specs = [
            [`倒轉 ${SEEK_SECONDS} 秒`, ICON.back, () => seek(v, -SEEK_SECONDS)],
            [`快轉 ${SEEK_SECONDS} 秒`, ICON.fwd, () => seek(v, SEEK_SECONDS)],
            ['全螢幕', ICON.fs, () => goFullscreen(v)],
        ];

        const nodes = [];
        let after = anchor;
        for (const [label, icon, onClick] of specs) {
            const node = makeCtrlBtn(anchor, label, icon, onClick);
            if (!node) break;
            after.insertAdjacentElement('afterend', node);
            after = node;
            nodes.push(node);
        }
        if (!nodes.length) return;
        if (DEBUG) stats.insert++;
        v._fbFsBtns = nodes;
        log(v, `控制列按鈕插入 ${nodes.length} 顆`);
    }

    // ── 核心：等控制列出現再插入按鈕 ────────────────────────
    // 控制列出現的時機不固定（所以延遲「有時會有時不會」），與其等 MutationObserver
    // 再配一個會提早收工的 timeout，不如進場後就每 RETRY_INTERVAL 掃一次、掃到就收工。
    const RETRY_INTERVAL = 100;
    const RETRY_TIMES = 30;   // 3 秒

    function setupVideo(v) {
        if (ourBtnsAlive(v)) return;
        if (!isReelVideo(v)) return;
        if (DEBUG) stats.setup++;

        const btns = findCtrlBtns(v);

        // 有 FB 自己的按鈕就點它，讓 FB 內部 state 同步（不然 re-render 會把 muted 蓋回 true）；
        // 控制列還沒出現時才退而求其次直接設 muted，換取不用等控制列的即時解靜音。
        unmute(v, btns.unmute);

        if (btns.mute) {
            insertFSBtn(v, btns.mute);
            return;
        }
        scheduleRetry(v);
    }

    function scheduleRetry(v) {
        if (v._fbFsRetry) return;
        let left = RETRY_TIMES;
        log(v, '控制列還沒出現，開始重試');
        v._fbFsRetry = setInterval(() => {
            // 捲出畫面就立刻收工。不然快速捲動時，每支經過的 reel 都會各自
            // 跑滿 3 秒的重試，好幾組同時在做 querySelector，捲動就會頓。
            if (--left <= 0 || ourBtnsAlive(v) || !document.contains(v) || !isReelVideo(v)) {
                clearInterval(v._fbFsRetry);
                v._fbFsRetry = null;
                return;
            }
            setupVideo(v);
        }, RETRY_INTERVAL);
    }

    // 進場除了 IntersectionObserver，也綁 video 自己的播放事件：
    // 使用者回報「影片已經開始播了才慢慢解靜音」，這幾個事件就是那個時間點。
    const SETUP_EVENTS = ['loadeddata', 'canplay', 'playing'];

    function observeVideo(v) {
        if (v.dataset.observed) return;
        v.dataset.observed = '1';
        videoObserver.observe(v);
        SETUP_EVENTS.forEach(evt => v.addEventListener(evt, () => setupVideo(v)));
    }

    // ── IntersectionObserver：監控 video 進入畫面 ───────────
    const videoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const v = entry.target;
            if (!isReelVideo(v)) return;
            setupVideo(v);
        });
    });

    // ── MutationObserver：監控新 video 加入 DOM ─────────────
    const domObserver = new MutationObserver(() => {
        document.querySelectorAll('video').forEach(observeVideo);
    });

    domObserver.observe(document.body, { childList: true, subtree: true });

    // 初次掃描
    document.querySelectorAll('video').forEach(observeVideo);

    // ── 方案 A：SPA 換頁偵測 ────────────────────────────────
    function reScanVideos() {
        document.querySelectorAll('video').forEach(v => {
            removeOurBtns(v);   // 留在 DOM 會擋到 insertFSBtn 的重複插入檢查
            v._fbFsUnmuted = false;
            videoObserver.observe(v);
            if (isReelVideo(v)) setupVideo(v);
        });
    }

    let lastHref = location.href;
    function onUrlChange() {
        if (location.href === lastHref) return;
        lastHref = location.href;
        if (location.href.includes('/reel/')) setTimeout(reScanVideos, 500);
    }

    const origPushState = history.pushState.bind(history);
    history.pushState = function (...args) { origPushState(...args); onUrlChange(); };
    window.addEventListener('popstate', onUrlChange);

    // ── 方案 B：polling 補底 ────────────────────────────────
    setInterval(() => {
        if (!location.href.includes('/reel/')) return;
        document.querySelectorAll('video').forEach(v => {
            if (!isReelVideo(v)) return;
            const r = v.getBoundingClientRect();
            if (r.width > 0 && r.top < window.innerHeight && r.bottom > 0) setupVideo(v);
        });
    }, 500);

})();