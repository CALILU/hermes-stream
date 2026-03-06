/**
 * IsiPrime webOS App - Shared On-Screen Keyboard
 * Extracted from search.js and requests.js which both use
 * an identical 6-column keyboard (A-Z + Ñ + 0-9 + SPACE + DEL).
 *
 * Usage from a module:
 *   var KB = App.Keyboard;
 *   KB.buildKeys(ctx, gridEl);  // creates key DOM elements
 *   KB.updateFocus(ctx, index); // focus management
 *   KB.clearFocus(ctx);
 *   KB.onKeyPress(ctx, el);     // DEL or append char
 *   KB.handleNav(ctx, key, { onUp: fn, onDown: fn });
 *
 * ctx must have: _keyElements[], _keyboardFocusIndex, _searchText,
 *                _activePanel, _clearResultsFocus(), _updateKeyboardFocus(),
 *                _switchToResults(), _updateDisplay(), _doSearch()
 *
 * Chromium ~53 compatible (no optional chaining, no nullish coalescing).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    var KEYBOARD_COLS = 6;
    var KEYS_LAYOUT = 'ABCDEFGHIJKLMN\u00d1OPQRSTUVWXYZ0123456789'.split('');

    App.Keyboard = {

        COLS: KEYBOARD_COLS,
        LAYOUT: KEYS_LAYOUT,

        /**
         * Build keyboard key elements and append to gridEl.
         * Populates ctx._keyElements with all key DOM nodes.
         * Attaches click + hover handlers for Magic Remote.
         *
         * @param {Object} ctx - Module context (App.Search or App.Requests)
         * @param {HTMLElement} gridEl - Container for keyboard keys
         */
        buildKeys: function(ctx, gridEl) {
            ctx._keyElements = [];

            // Letter and number keys
            for (var i = 0; i < KEYS_LAYOUT.length; i++) {
                var keyEl = document.createElement('div');
                keyEl.className = 'keyboard-key focusable';
                keyEl.textContent = KEYS_LAYOUT[i];
                keyEl.setAttribute('data-key', KEYS_LAYOUT[i]);
                gridEl.appendChild(keyEl);
                ctx._keyElements.push(keyEl);
            }

            // Space key (full width)
            var spaceEl = document.createElement('div');
            spaceEl.className = 'keyboard-key keyboard-key-full keyboard-key-action focusable';
            spaceEl.textContent = 'ESPACIO';
            spaceEl.setAttribute('data-key', ' ');
            gridEl.appendChild(spaceEl);
            ctx._keyElements.push(spaceEl);

            // Delete key (half width — backspace)
            var delEl = document.createElement('div');
            delEl.className = 'keyboard-key keyboard-key-wide keyboard-key-action focusable';
            delEl.textContent = 'BORRAR';
            delEl.setAttribute('data-key', 'DEL');
            gridEl.appendChild(delEl);
            ctx._keyElements.push(delEl);

            // Clear key (half width — clear all)
            var clearEl = document.createElement('div');
            clearEl.className = 'keyboard-key keyboard-key-wide keyboard-key-action focusable';
            clearEl.textContent = 'LIMPIAR';
            clearEl.setAttribute('data-key', 'CLEAR');
            gridEl.appendChild(clearEl);
            ctx._keyElements.push(clearEl);

            // Click + hover for Magic Remote
            for (var ki = 0; ki < ctx._keyElements.length; ki++) {
                (function(keyIndex, keyElement) {
                    keyElement.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        ctx._activePanel = 'keyboard';
                        App.Keyboard.updateFocus(ctx, keyIndex);
                        App.Keyboard.onKeyPress(ctx, keyElement);
                    });
                    keyElement.addEventListener('mouseenter', function() {
                        if (ctx._activePanel !== 'keyboard') {
                            ctx._clearResultsFocus();
                        }
                        ctx._activePanel = 'keyboard';
                        App.Keyboard.updateFocus(ctx, keyIndex);
                    });
                })(ki, ctx._keyElements[ki]);
            }
        },

        /**
         * Update keyboard focus visual.
         * @param {Object} ctx - Module context
         * @param {number} index - Target index (clamped)
         */
        updateFocus: function(ctx, index) {
            if (index < 0) index = 0;
            if (index >= ctx._keyElements.length) index = ctx._keyElements.length - 1;
            ctx._keyboardFocusIndex = index;

            for (var i = 0; i < ctx._keyElements.length; i++) {
                ctx._keyElements[i].classList.remove('focused');
            }
            ctx._keyElements[index].classList.add('focused');
        },

        /**
         * Clear keyboard focus visual.
         * @param {Object} ctx - Module context
         */
        clearFocus: function(ctx) {
            for (var i = 0; i < ctx._keyElements.length; i++) {
                ctx._keyElements[i].classList.remove('focused');
            }
        },

        /**
         * Handle pressing OK on a keyboard key.
         * DEL removes last char; anything else appends lowercase.
         * Calls ctx._updateDisplay() and ctx._doSearch() after.
         *
         * @param {Object} ctx - Module context
         * @param {HTMLElement} el - Key element pressed
         */
        onKeyPress: function(ctx, el) {
            if (!el) return;
            var keyVal = el.getAttribute('data-key');
            if (keyVal === 'DEL') {
                ctx._searchText = ctx._searchText.slice(0, -1);
            } else if (keyVal === 'CLEAR') {
                ctx._searchText = '';
            } else {
                ctx._searchText += keyVal.toLowerCase();
            }
            ctx._updateDisplay();
            ctx._doSearch();
        },

        /**
         * Handle D-pad navigation within the keyboard grid.
         * Identical logic for LEFT/RIGHT/OK across modules.
         * UP at first row and DOWN at DEL vary by module — handled via callbacks.
         *
         * @param {Object} ctx - Module context
         * @param {number} key - keyCode
         * @param {Object} config
         * @param {Function} config.onUp - Called when UP at first row of letter keys
         * @param {Function} [config.onDown] - Called when DOWN at DEL_IDX (optional)
         */
        handleNav: function(ctx, key, config) {
            var idx = ctx._keyboardFocusIndex;
            var regularCount = KEYS_LAYOUT.length; // 37 (A-Z + Ñ + 0-9)
            var SPACE_IDX = regularCount;           // 37
            var DEL_IDX = regularCount + 1;         // 38
            var CLEAR_IDX = regularCount + 2;       // 39
            var isOnAction = idx >= regularCount;
            var KB = App.Keyboard;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (idx === CLEAR_IDX) {
                        KB.updateFocus(ctx, DEL_IDX);
                    } else if (!isOnAction) {
                        var col = idx % KEYBOARD_COLS;
                        if (col > 0) {
                            KB.updateFocus(ctx, idx - 1);
                        }
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (idx === DEL_IDX) {
                        KB.updateFocus(ctx, CLEAR_IDX);
                    } else if (isOnAction) {
                        ctx._switchToResults();
                    } else {
                        var colR = idx % KEYBOARD_COLS;
                        if (colR < KEYBOARD_COLS - 1 && idx + 1 < regularCount) {
                            KB.updateFocus(ctx, idx + 1);
                        } else {
                            ctx._switchToResults();
                        }
                    }
                    break;

                case App.Config.KEYS.UP:
                    if (idx === DEL_IDX || idx === CLEAR_IDX) {
                        KB.updateFocus(ctx, SPACE_IDX);
                    } else if (idx === SPACE_IDX) {
                        var lastRow = Math.floor((regularCount - 1) / KEYBOARD_COLS);
                        var target = lastRow * KEYBOARD_COLS + 2;
                        if (target >= regularCount) target = regularCount - 1;
                        KB.updateFocus(ctx, target);
                    } else {
                        var rowU = Math.floor(idx / KEYBOARD_COLS);
                        if (rowU > 0) {
                            KB.updateFocus(ctx, idx - KEYBOARD_COLS);
                        } else {
                            // Module-specific: search goes to nav, requests goes to tabs
                            config.onUp();
                        }
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx === DEL_IDX || idx === CLEAR_IDX) {
                        // Module-specific: requests goes to submit button
                        if (config.onDown) {
                            config.onDown();
                        }
                    } else if (idx === SPACE_IDX) {
                        KB.updateFocus(ctx, DEL_IDX);
                    } else {
                        var nextIdx = idx + KEYBOARD_COLS;
                        if (nextIdx < regularCount) {
                            KB.updateFocus(ctx, nextIdx);
                        } else {
                            KB.updateFocus(ctx, SPACE_IDX);
                        }
                    }
                    break;

                case App.Config.KEYS.OK:
                    KB.onKeyPress(ctx, ctx._keyElements[idx]);
                    break;
            }
        }
    };
})();
