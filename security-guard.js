/**
 * ===================================================
 * MetaCleaner Pro — Advanced Anti-Theft & DevTools Neutralizer
 * Copyright (c) Fuad Visuals / MetaCleaner Pro
 * All rights reserved.
 * ===================================================
 */

(function () {
    'use strict';

    let isLocked = false;
    const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);

    function triggerLockdown(reason) {
        if (isLocked) return;
        isLocked = true;

        // Replace view with security lockdown shield
        document.body.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0d1117;color:#f85149;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;z-index:2147483647;text-align:center;padding:24px;box-sizing:border-box;">
                <div style="font-size:3.5rem;margin-bottom:1rem;">🛡️</div>
                <h1 style="font-size:1.8rem;margin:0 0 12px 0;color:#ff5555;font-weight:700;letter-spacing:-0.5px;">Developer Tools Detected</h1>
                <p style="font-size:0.95rem;color:#8b949e;max-width:500px;line-height:1.6;margin:0 0 24px 0;">
                    Inspection, console debugging, and source reverse-engineering are strictly prohibited on MetaCleaner Pro.
                </p>
                <div style="display:flex;gap:12px;align-items:center;">
                    <button onclick="window.location.reload()" style="background:#238636;color:#ffffff;border:none;padding:10px 20px;border-radius:6px;font-size:0.9rem;font-weight:600;cursor:pointer;transition:background 0.2s;">
                        Close DevTools & Refresh
                    </button>
                </div>
            </div>
        `;

        // Freeze DevTools via continuous debugger trap
        setInterval(function () {
            (function () {}.constructor('debugger')());
        }, 50);
    }

    // 1. Detect Docked DevTools via Window outer/inner size differential (Desktop only)
    if (!isMobile) {
        const checkWindowDelta = () => {
            const threshold = 160;
            const widthDiff = window.outerWidth - window.innerWidth > threshold;
            const heightDiff = window.outerHeight - window.innerHeight > threshold;
            if (widthDiff || heightDiff) {
                triggerLockdown('Dimensions');
            }
        };
        window.addEventListener('resize', checkWindowDelta);
        setInterval(checkWindowDelta, 800);
    }

    // 2. Active Anti-Debugger execution timing trap
    // When DevTools is opened, 'debugger' causes a pause of > 100ms
    setInterval(function () {
        const start = performance.now();
        (function () {}.constructor('debugger')());
        const end = performance.now();
        if (end - start > 100) {
            triggerLockdown('Debugger Timing');
        }
    }, 400);

    // 3. Detect Console opening via Object Getter
    try {
        const trapElement = new Image();
        Object.defineProperty(trapElement, 'id', {
            get: function () {
                triggerLockdown('Console Getter');
            }
        });
        setInterval(function () {
            console.log('%c', trapElement);
            console.clear();
        }, 1200);
    } catch (e) {}

    // 4. Disable Right-Click Context Menu (except in input / textarea)
    document.addEventListener('contextmenu', function (e) {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
            e.preventDefault();
            return false;
        }
    }, { capture: true });

    // 5. Disable DevTools / View Source Keyboard Shortcuts
    document.addEventListener('keydown', function (e) {
        const key = e.key || '';
        const keyCode = e.keyCode || 0;
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        // F12
        if (key === 'F12' || keyCode === 123) {
            e.preventDefault();
            e.stopPropagation();
            triggerLockdown('F12 Key');
            return false;
        }

        // Ctrl + Shift + I / J / C
        if (ctrl && shift && ['I', 'i', 'J', 'j', 'C', 'c'].includes(key)) {
            e.preventDefault();
            e.stopPropagation();
            triggerLockdown('Inspect Shortcut');
            return false;
        }

        // Ctrl + U (View Source)
        if (ctrl && (key === 'U' || key === 'u' || keyCode === 85)) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        // Ctrl + S (Save Page)
        if (ctrl && (key === 'S' || key === 's' || keyCode === 83)) {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag !== 'input' && tag !== 'textarea') {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }
    }, { capture: true });

    // 6. Prevent image / asset dragging
    document.addEventListener('dragstart', function (e) {
        if (e.target.tagName === 'IMG' || e.target.tagName === 'svg') {
            e.preventDefault();
        }
    });

})();
