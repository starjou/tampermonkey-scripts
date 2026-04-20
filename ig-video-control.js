// ==UserScript==
// @name         IG Video Control
// @namespace    https://www.jk-web.com/
// @version      1.3
// @description  在 Instagram 影片加上全螢幕按鈕並自動取消靜音
// @author       Jacky Jou
// @match        https://www.instagram.com/*
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ig-video-control.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ig-video-control.js
// ==/UserScript==
(function () {
    'use strict';

    // ── 注入全螢幕 CSS ──────────────────────────────────────────
    function injectFullscreenStyle() {
        const style = document.createElement('style');
        style.textContent = `
        video:-webkit-full-screen {
            object-fit: contain !important;
            background: #000;
        }
        video:fullscreen {
            object-fit: contain !important;
            background: #000;
        }
    `;
        document.head.appendChild(style);
    }

    injectFullscreenStyle();

    // ── 全螢幕攔截 ──────────────────────────────────────────
    let blockClickActive = false;
    let currentVideo = null;
    const BLOCK_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

    function blockClick(e) {
        if (!blockClickActive) return;
        if (e.target.tagName !== 'VIDEO') return;
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.type === 'click') {
            if (e.target.paused) {
                e.target.play();
            } else {
                e.target.pause();
                const originalPlay = e.target.play.bind(e.target);
                e.target.play = () => Promise.resolve();
                setTimeout(() => {
                    e.target.play = originalPlay;
                }, 300);
            }
        }
    }

    function enableBlock(v) {
        currentVideo = v;
        blockClickActive = true;
        BLOCK_EVENTS.forEach(evt => {
            document.addEventListener(evt, blockClick, true);
            v.addEventListener(evt, blockClick, true);
        });
        const exitChecker = setInterval(() => {
            if (!document.fullscreenElement) {
                disableBlock();
                clearInterval(exitChecker);
            }
        }, 300);
    }

    function disableBlock() {
        BLOCK_EVENTS.forEach(evt => {
            document.removeEventListener(evt, blockClick, true);
            if (currentVideo) currentVideo.removeEventListener(evt, blockClick, true);
        });
        blockClickActive = false;
        currentVideo = null;
    }

    // ════════════════════════════════════════════════════════
    // TYPE 1：modal / 頁面方式（/p/ 或 /reel/）
    // ════════════════════════════════════════════════════════

    function isType1Video(v) {
        const href = location.href;
        if (!href.includes('/p/') && !href.includes('/reel/')) return false;
        const rect = v.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 100) return false;
        return true;
    }

    function findType1MuteBtn(v) {
        let el = v.parentElement;
        for (let i = 0; i < 15; i++) {
            const btn = el?.querySelector('button[aria-label="切換音效"]');
            if (btn) return btn;
            el = el?.parentElement;
        }
        return null;
    }

    function createFSBtn(v) {
        const FSBtn = document.createElement('button');
        FSBtn.id = 'IGRequestFullScreen';
        FSBtn.type = 'button';
        FSBtn.style.cssText = `
            width: 52px;
            height: 52px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: none;
            border: none;
            padding: 0;
            cursor: pointer;
            margin-right: -20px;
        `;

        const inner = document.createElement('div');
        inner.style.cssText = `
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(43, 48, 54, 0.5);
            border-radius: 50%;
        `;

        const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>`;
        inner.innerHTML = svgIcon;
        FSBtn.appendChild(inner);

        FSBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            setTimeout(() => {
                enableBlock(v);
                v.requestFullscreen().catch(() => disableBlock());
            }, 0);
        });

        return FSBtn;
    }

    function insertType1FSBtn(v, muteBtn) {
        document.getElementById('IGRequestFullScreen')?.remove();
        const container = muteBtn.parentElement;
        container.style.flexDirection = 'row';
        container.style.alignItems = 'center';
        container.style.gap = '4px';
        const FSBtn = createFSBtn(v);
        muteBtn.insertAdjacentElement('beforebegin', FSBtn);
    }

    function setupType1Video(v) {
        if (v.dataset.setting) return;
        v.dataset.setting = '1';

        const muteBtn = findType1MuteBtn(v);
        if (muteBtn) {
            if (muteBtn.querySelector('svg[aria-label="已靜音"]')) muteBtn.click();
            insertType1FSBtn(v, muteBtn);
            delete v.dataset.setting;
            return;
        }

        const watchTarget = v.closest('article') || v.parentElement;
        const mo = new MutationObserver(() => {
            const muteBtn = findType1MuteBtn(v);
            if (muteBtn) {
                mo.disconnect();
                if (muteBtn.querySelector('svg[aria-label="已靜音"]')) muteBtn.click();
                insertType1FSBtn(v, muteBtn);
                delete v.dataset.setting;
            }
        });
        mo.observe(watchTarget, { childList: true, subtree: true });
        setTimeout(() => {
            mo.disconnect();
            delete v.dataset.setting;
        }, 10000);
    }

    const type1VideoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const v = entry.target;
            if (!isType1Video(v)) return;
            setupType1Video(v);
        });
    });

    const type1DomObserver = new MutationObserver(() => {
        document.querySelectorAll('video').forEach(v => {
            if (v.dataset.observed) return;
            v.dataset.observed = '1';
            type1VideoObserver.observe(v);
        });
    });

    type1DomObserver.observe(document.body, { childList: true, subtree: true });

    document.querySelectorAll('video').forEach(v => {
        v.dataset.observed = '1';
        type1VideoObserver.observe(v);
    });

    // ════════════════════════════════════════════════════════
    // TYPE 2：/reels/ 全螢幕捲動介面
    // ════════════════════════════════════════════════════════

    function isType2() {
        return location.href.includes('/reels/');
    }

    function type2GetCurrentVideo() {
        return Array.from(document.querySelectorAll('video')).find(v => {
            const rect = v.getBoundingClientRect();
            return (
                rect.top >= 0 &&
                rect.bottom <= window.innerHeight &&
                rect.width > 100 &&
                rect.height > 100 &&
                !v.paused &&
                !v.ended
            );
        });
    }

    function type2Unmute() {
        document.querySelector("svg[aria-label='已靜音']")?.parentNode?.click();
    }

    function type2FindMuteBtnForVideo(v) {
        let el = v.parentElement;
        for (let i = 0; i < 15; i++) {
            const svg = el?.querySelector("svg[aria-label='正在播放音效'], svg[aria-label='已靜音']");
            if (svg) return svg.parentNode;
            el = el?.parentElement;
        }
        return null;
    }

    function type2InsertFSBtn(v, muteBtn) {
        if (muteBtn.parentElement.querySelector('#IGReelsFSBtn')) return;

        const container = muteBtn.parentElement;
        container.style.flexDirection = 'row';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'flex-end';

        const bg = window.getComputedStyle(muteBtn).backgroundColor;

        const FSBtn = document.createElement('button');
        FSBtn.id = 'IGReelsFSBtn';
        FSBtn.type = 'button';
        FSBtn.style.cssText = `
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: ${bg};
            border: none;
            border-radius: 50%;
            cursor: pointer;
            margin-right: 8px;
        `;
        FSBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>`;

        FSBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            const currentVideo = type2GetCurrentVideo();
            if (!currentVideo) return;
            setTimeout(() => {
                enableBlock(currentVideo);
                currentVideo.requestFullscreen().catch(() => disableBlock());
            }, 0);
        });

        muteBtn.insertAdjacentElement('beforebegin', FSBtn);
    }

    function type2SetupVideo(v) {
        if (!isType2()) return;
        if (v.dataset.type2Setting) return;
        v.dataset.type2Setting = '1';

        const muteBtn = type2FindMuteBtnForVideo(v);
        if (muteBtn) {
            type2Unmute();
            type2InsertFSBtn(v, muteBtn);
            delete v.dataset.type2Setting;
            return;
        }

        const watchTarget = v.closest('[aria-label="Video player"]') || v.parentElement;
        const mo = new MutationObserver(() => {
            const muteBtn = type2FindMuteBtnForVideo(v);
            if (muteBtn) {
                mo.disconnect();
                type2Unmute();
                type2InsertFSBtn(v, muteBtn);
                delete v.dataset.type2Setting;
            }
        });
        mo.observe(watchTarget, { childList: true, subtree: true });
        setTimeout(() => {
            mo.disconnect();
            delete v.dataset.type2Setting;
        }, 10000);
    }

    const type2VideoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            if (!isType2()) return;
            type2SetupVideo(entry.target);
        });
    });

    const type2DomObserver = new MutationObserver(() => {
        if (!isType2()) return;
        document.querySelectorAll('video').forEach(v => {
            if (v.dataset.type2Observed) return;
            v.dataset.type2Observed = '1';
            type2VideoObserver.observe(v);
        });
    });

    type2DomObserver.observe(document.body, { childList: true, subtree: true });

    if (isType2()) {
        document.querySelectorAll('video').forEach(v => {
            v.dataset.type2Observed = '1';
            type2VideoObserver.observe(v);
        });
    }

})();