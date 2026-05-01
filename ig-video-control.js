// ==UserScript==
// @name         IG Video Control
// @namespace    https://www.jk-web.com/
// @version      1.4
// @description  在 Instagram 影片加上全螢幕按鈕並自動取消靜音
// @author       Jacky Jou
// @match        https://www.instagram.com/*
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ig-video-control.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ig-video-control.js
// ==/UserScript==
(function () {
    'use strict';

    // ── 全螢幕 CSS ──────────────────────────────────────────
    function injectFullscreenStyle() {
        const style = document.createElement('style');
        style.textContent = `
            video:-webkit-full-screen { object-fit: contain !important; background: #000; }
            video:fullscreen           { object-fit: contain !important; background: #000; }
            .ig-fs-btn-wrap {
                position: absolute;
                z-index: 9999;
                bottom: 12px;
                left: 12px;
                pointer-events: auto;
            }
            .ig-fs-btn {
                width: 32px; height: 32px;
                display: flex; align-items: center; justify-content: center;
                background: rgba(0,0,0,0.55);
                border: none; border-radius: 50%;
                cursor: pointer; padding: 0;
                transition: background 0.15s;
            }
            .ig-fs-btn:hover { background: rgba(0,0,0,0.8); }
        `;
        document.head.appendChild(style);
    }
    injectFullscreenStyle();

    // ── 全螢幕攔截 ──────────────────────────────────────────
    let blockClickActive = false;
    let currentVideo = null;
    const BLOCK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

    function blockClick(e) {
        if (!blockClickActive || e.target.tagName !== 'VIDEO') return;
        e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
        if (e.type === 'click') {
            if (e.target.paused) {
                e.target.play();
            } else {
                e.target.pause();
                const orig = e.target.play.bind(e.target);
                e.target.play = () => Promise.resolve();
                setTimeout(() => { e.target.play = orig; }, 300);
            }
        }
    }

    function enableBlock(v) {
        currentVideo = v; blockClickActive = true;
        BLOCK_EVENTS.forEach(evt => {
            document.addEventListener(evt, blockClick, true);
            v.addEventListener(evt, blockClick, true);
        });
        const timer = setInterval(() => {
            if (!document.fullscreenElement) { disableBlock(); clearInterval(timer); }
        }, 300);
    }

    function disableBlock() {
        BLOCK_EVENTS.forEach(evt => {
            document.removeEventListener(evt, blockClick, true);
            if (currentVideo) currentVideo.removeEventListener(evt, blockClick, true);
        });
        blockClickActive = false; currentVideo = null;
    }

    // ── 多語系 mute button selector ──────────────────────────
    // IG 有時用中文 aria-label，有時英文，全抓
    const MUTE_BTN_SELECTORS = [
        'button[aria-label="切換音效"]',
        'button[aria-label="Mute"]',
        'button[aria-label="Unmute"]',
        'button[aria-label="Audio"]',
    ];
    const MUTED_SVG_SELECTORS = [
        'svg[aria-label="已靜音"]',
        'svg[aria-label="Muted"]',
    ];
    const PLAYING_SVG_SELECTORS = [
        'svg[aria-label="正在播放音效"]',
        'svg[aria-label="Audio is playing"]',
    ];

    function findMuteBtn(root) {
        for (let i = 0; i < 15; i++) {
            for (const sel of MUTE_BTN_SELECTORS) {
                const btn = root?.querySelector(sel);
                if (btn) return btn;
            }
            root = root?.parentElement;
        }
        return null;
    }

    function findMuteBtnBySvg(root) {
        const allSels = [...MUTED_SVG_SELECTORS, ...PLAYING_SVG_SELECTORS];
        for (let i = 0; i < 15; i++) {
            for (const sel of allSels) {
                const svg = root?.querySelector(sel);
                if (svg) return svg.closest('button') || svg.parentNode;
            }
            root = root?.parentElement;
        }
        return null;
    }

    function isMuted(root) {
        for (const sel of MUTED_SVG_SELECTORS) {
            if (root?.querySelector(sel)) return true;
        }
        return false;
    }

    function clickUnmute(startEl) {
        const btn = findMuteBtnBySvg(startEl) || findMuteBtn(startEl);
        if (btn && isMuted(btn.closest('[role]') || btn.parentElement)) btn.click();
    }

    // ── FSBtn：直接 absolute 定位在 video 上 ──────────────────
    const FS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
        viewBox="0 0 24 24" fill="white">
        <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
    </svg>`;

    function attachFSBtnToVideo(v, btnId) {
        if (document.getElementById(btnId)) return;

        // video 需要一個 position:relative 的父層
        const videoParent = v.parentElement;
        if (!videoParent) return;
        const existingPos = window.getComputedStyle(videoParent).position;
        if (existingPos === 'static') videoParent.style.position = 'relative';

        const wrap = document.createElement('div');
        wrap.className = 'ig-fs-btn-wrap';
        wrap.id = btnId;

        const btn = document.createElement('button');
        btn.className = 'ig-fs-btn';
        btn.type = 'button';
        btn.title = 'Fullscreen';
        btn.innerHTML = FS_SVG;

        btn.addEventListener('click', (e) => {
            e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
            setTimeout(() => {
                enableBlock(v);
                v.requestFullscreen().catch(() => disableBlock());
            }, 0);
        });

        wrap.appendChild(btn);
        videoParent.appendChild(wrap);
    }

    // ════════════════════════════════════════════════════════
    // TYPE 1：/p/ 或 /reel/ 頁面
    // ════════════════════════════════════════════════════════

    function isType1Video(v) {
        if (!location.href.includes('/p/') && !location.href.includes('/reel/')) return false;
        const r = v.getBoundingClientRect();
        return r.width >= 100 && r.height >= 100;
    }

    function setupType1Video(v) {
        if (v.dataset.igFsT1) return;
        v.dataset.igFsT1 = '1';

        const trySetup = () => {
            clickUnmute(v);
            attachFSBtnToVideo(v, 'IGFsBtnT1_' + Date.now());
        };

        // 先等 mute button 出現再 unmute，但 FSBtn 直接掛
        const muteBtn = findMuteBtn(v) || findMuteBtnBySvg(v);
        if (muteBtn) { trySetup(); return; }

        const watchTarget = v.closest('article') || v.parentElement;
        const mo = new MutationObserver(() => {
            const btn = findMuteBtn(v) || findMuteBtnBySvg(v);
            if (btn) { mo.disconnect(); trySetup(); }
        });
        mo.observe(watchTarget, { childList: true, subtree: true });

        // 無論有沒有 muteBtn，7 秒後若還沒插就強制插 FSBtn
        setTimeout(() => { mo.disconnect(); attachFSBtnToVideo(v, 'IGFsBtnT1_' + Date.now()); }, 7000);
    }

    const t1VideoObs = new IntersectionObserver((entries) => {
        entries.forEach(({ isIntersecting, target: v }) => {
            if (isIntersecting && isType1Video(v)) setupType1Video(v);
        });
    });

    const t1DomObs = new MutationObserver(() => {
        document.querySelectorAll('video').forEach(v => {
            if (v.dataset.igObsT1) return;
            v.dataset.igObsT1 = '1';
            t1VideoObs.observe(v);
        });
    });
    t1DomObs.observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll('video').forEach(v => {
        v.dataset.igObsT1 = '1'; t1VideoObs.observe(v);
    });

    // ════════════════════════════════════════════════════════
    // TYPE 2：/reels/ 捲動介面
    // ════════════════════════════════════════════════════════

    function isType2() { return location.href.includes('/reels/'); }

    function type2GetCurrentVideo() {
        return Array.from(document.querySelectorAll('video')).find(v => {
            const r = v.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight
                && r.width > 100 && r.height > 100
                && !v.paused && !v.ended;
        });
    }

    function setupType2Video(v) {
        if (!isType2()) return;
        if (v.dataset.igFsT2) return;
        v.dataset.igFsT2 = '1';

        const btnId = 'IGFsBtnT2_' + Date.now();

        const trySetup = () => {
            clickUnmute(v);
            // 對 reels，FSBtn 放右下角
            if (document.getElementById(btnId)) return;
            const videoParent = v.parentElement;
            if (!videoParent) return;
            if (window.getComputedStyle(videoParent).position === 'static')
                videoParent.style.position = 'relative';

            const wrap = document.createElement('div');
            wrap.className = 'ig-fs-btn-wrap';
            wrap.id = btnId;
            wrap.style.cssText = 'bottom:60px;left:auto;right:12px;';  // reels 右下角

            const btn = document.createElement('button');
            btn.className = 'ig-fs-btn';
            btn.type = 'button';
            btn.title = 'Fullscreen';
            btn.innerHTML = FS_SVG;

            btn.addEventListener('click', (e) => {
                e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
                const cv = type2GetCurrentVideo();
                if (!cv) return;
                setTimeout(() => {
                    enableBlock(cv);
                    cv.requestFullscreen().catch(() => disableBlock());
                }, 0);
            });

            wrap.appendChild(btn);
            videoParent.appendChild(wrap);
        };

        const muteBtn = findMuteBtn(v) || findMuteBtnBySvg(v);
        if (muteBtn) { trySetup(); return; }

        const watchTarget = v.closest('[aria-label="Video player"]') || v.parentElement;
        const mo = new MutationObserver(() => {
            const btn = findMuteBtn(v) || findMuteBtnBySvg(v);
            if (btn) { mo.disconnect(); trySetup(); }
        });
        mo.observe(watchTarget, { childList: true, subtree: true });
        setTimeout(() => { mo.disconnect(); trySetup(); }, 7000);
    }

    const t2VideoObs = new IntersectionObserver((entries) => {
        entries.forEach(({ isIntersecting, target: v }) => {
            if (isIntersecting && isType2()) setupType2Video(v);
        });
    });

    const t2DomObs = new MutationObserver(() => {
        if (!isType2()) return;
        document.querySelectorAll('video').forEach(v => {
            if (v.dataset.igObsT2) return;
            v.dataset.igObsT2 = '1';
            t2VideoObs.observe(v);
        });
    });
    t2DomObs.observe(document.body, { childList: true, subtree: true });

    if (isType2()) {
        document.querySelectorAll('video').forEach(v => {
            v.dataset.igObsT2 = '1'; t2VideoObs.observe(v);
        });
    }

})();