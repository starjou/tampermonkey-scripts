// ==UserScript==
// @name         Facebook Video Control
// @namespace    https://www.jk-web.com/
// @version      2.0
// @description  在 Facebook 的 Reels 顯示全螢幕控制器
// @author       Jacky Jou
// @match        https://www.facebook.com/*
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-video-control.js
// @downloadURL  https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-video-control.js
// ==/UserScript==
(function () {
    'use strict';

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

    // ── 工具函式 ────────────────────────────────────────────
    function isReelVideo(v) {
        if (!location.href.includes('/reel/')) return false;
        const rect = v.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 100) return false;
        return true;
    }

    function findBtn(v, label) {
        const fromSibling = v.nextElementSibling?.querySelector(`div[aria-label="${label}"]`);
        if (fromSibling) return fromSibling;
        let el = v.parentElement;
        for (let i = 0; i < 10; i++) {
            const btn = el?.querySelector(`div[aria-label="${label}"]`);
            if (btn) return btn;
            el = el?.parentElement;
        }
        return null;
    }

    function createFSBtn(v) {
        const FSBtn = document.createElement('div');
        FSBtn.id = 'RequestFullScreen';
        Object.assign(FSBtn.style, {
            width: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--secondary-button-background-on-media)',
            borderRadius: '44px',
            marginInlineStart: '8px',
            cursor: 'pointer'
        });

        FSBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            setTimeout(() => {
                enableBlock(v);
                v.requestFullscreen().catch(() => disableBlock());
            }, 0);
        });

        const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>`;
        const btnIcon = document.createElement('span');
        btnIcon.innerHTML = svgIcon;
        btnIcon.style.display = 'flex';
        FSBtn.appendChild(btnIcon);
        return FSBtn;
    }

    function insertFSBtn(v, sndBtn) {
        document.getElementById('RequestFullScreen')?.remove();
        const FSBtn = createFSBtn(v);
        sndBtn.parentNode.parentNode.parentNode.insertAdjacentElement('afterend', FSBtn);
    }

    // ── 核心：等控制列出現再插入按鈕 ────────────────────────
    function setupVideo(v) {
        const unmuteBtn = findBtn(v, '取消靜音');
        if (v.muted && unmuteBtn) unmuteBtn.click();

        const sndBtn = findBtn(v, '靜音');
        if (sndBtn) {
            insertFSBtn(v, sndBtn);
            return;
        }

        const watchTarget = v.closest('[aria-label="Video player"]') || v.parentElement;
        const mo = new MutationObserver(() => {
            const btn = findBtn(v, '靜音');
            if (btn) {
                mo.disconnect();
                const unmute = findBtn(v, '取消靜音');
                if (v.muted && unmute) unmute.click();
                insertFSBtn(v, btn);
            }
        });
        mo.observe(watchTarget, { childList: true, subtree: true });
        setTimeout(() => mo.disconnect(), 10000);
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
        document.querySelectorAll('video').forEach(v => {
            if (v.dataset.observed) return;
            v.dataset.observed = '1';
            videoObserver.observe(v);
        });
    });

    domObserver.observe(document.body, { childList: true, subtree: true });

    // 初次掃描
    document.querySelectorAll('video').forEach(v => {
        v.dataset.observed = '1';
        videoObserver.observe(v);
    });

})();