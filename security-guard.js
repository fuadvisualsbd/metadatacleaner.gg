/**
 * ===================================================
 * MetaCleaner Pro — Client Security & Anti-Theft Guard
 * Copyright (c) Fuad Visuals / MetaCleaner Pro
 * All rights reserved.
 * ===================================================
 */

(function () {
    'use strict';

    // 1. Disable Right-Click Context Menu (except in input / textarea)
    document.addEventListener('contextmenu', function (e) {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
            e.preventDefault();
            return false;
        }
    }, { capture: true });

    // 2. Disable DevTools / View Source Keyboard Shortcuts
    document.addEventListener('keydown', function (e) {
        const key = e.key || '';
        const keyCode = e.keyCode || 0;
        const ctrl = e.ctrlKey || e.metaKey; // Windows Ctrl or Mac Cmd
        const shift = e.shiftKey;

        // F12
        if (key === 'F12' || keyCode === 123) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        // Ctrl + Shift + I (Inspect)
        // Ctrl + Shift + J (Console)
        // Ctrl + Shift + C (Element Inspect)
        if (ctrl && shift && (key === 'I' || key === 'i' || key === 'J' || key === 'j' || key === 'C' || key === 'c' || keyCode === 73 || keyCode === 74 || keyCode === 67)) {
            e.preventDefault();
            e.stopPropagation();
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

    // 3. Prevent dragging and dropping internal images/SVGs
    document.addEventListener('dragstart', function (e) {
        if (e.target.tagName === 'IMG' || e.target.tagName === 'svg') {
            e.preventDefault();
        }
    });

    // 4. Console Warning Header
    const logWarning = () => {
        try {
            console.clear();
            console.log(
                '%c⛔ STOP & WARNING!%c\n\nThis application and its source code are proprietary assets protected by copyright.\nUnauthorized inspection, modification, distribution, or reverse-engineering is strictly prohibited.',
                'color: #ff3344; font-size: 24px; font-weight: bold; text-shadow: 1px 1px 2px black;',
                'color: #f59e0b; font-size: 13px; font-weight: 500;'
            );
        } catch (e) {}
    };

    // Run warning
    logWarning();
    setInterval(logWarning, 60000);
})();
