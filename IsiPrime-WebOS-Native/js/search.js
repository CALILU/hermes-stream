/**
 * IsiPrime webOS App - Search View
 * On-screen keyboard with search results panel.
 * Left panel: 6-column keyboard grid. Right panel: poster results.
 * D-pad navigation within keyboard grid, RIGHT to jump to results, LEFT to return.
 *
 * Chromium ~87 compatible (no optional chaining, no nullish coalescing).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    var KEYBOARD_COLS = 6;

    // Keyboard layout: letters, numbers, then action keys
    var KEYS_LAYOUT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    var RESULTS_COLS = 5;
    var MAX_RESULTS = 20;

    App.Search = {
        _container: null,       // #search-view element
        _searchText: '',        // current search string
        _displayEl: null,       // search text display span
        _resultsEl: null,       // results grid container
        _resultsTitleEl: null,  // results title element
        _resultItems: [],       // result DOM elements
        _resultData: [],        // matched movie data for current results
        _keyElements: [],       // keyboard key DOM elements (including action keys)
        _keyboardFocusIndex: 0, // current index in keyboard keys
        _resultsFocusIndex: 0,  // current index in results
        _activePanel: 'keyboard', // 'keyboard', 'results', or 'nav'
        _navItems: [],          // nav bar items for nav panel focus
        _navFocusIndex: 0,      // current index in nav items
        _debounceTimer: null,
        _keyHandler: null,      // custom key handler for grid navigation

        /**
         * Show the search view and build the UI.
         */
        show: function() {
            this._container = document.getElementById('search-view');
            this._container.style.display = '';
            this._container.innerHTML = '';
            this._searchText = '';
            this._resultItems = [];
            this._resultData = [];
            this._keyElements = [];
            this._keyboardFocusIndex = 0;
            this._resultsFocusIndex = 0;
            this._activePanel = 'keyboard';
            this._navItems = [];
            this._navFocusIndex = 0;

            // Capture nav items for nav panel focus
            var navItemEls = document.querySelectorAll('#nav-bar .nav-item');
            for (var n = 0; n < navItemEls.length; n++) {
                this._navItems.push(navItemEls[n]);
            }

            // --- Left panel: keyboard ---
            var leftPanel = document.createElement('div');
            leftPanel.className = 'search-left';

            // Search text display
            var inputDisplay = document.createElement('div');
            inputDisplay.className = 'search-input-display';

            var searchTextSpan = document.createElement('span');
            searchTextSpan.id = 'search-text';
            searchTextSpan.textContent = '';
            inputDisplay.appendChild(searchTextSpan);

            var cursor = document.createElement('span');
            cursor.className = 'search-input-cursor';
            inputDisplay.appendChild(cursor);

            leftPanel.appendChild(inputDisplay);

            // Keyboard grid
            var gridEl = document.createElement('div');
            gridEl.className = 'keyboard-grid';
            gridEl.id = 'keyboard-grid';

            this._keyElements = [];

            // Letter and number keys
            for (var i = 0; i < KEYS_LAYOUT.length; i++) {
                var keyChar = KEYS_LAYOUT[i];
                var keyEl = document.createElement('div');
                keyEl.className = 'keyboard-key focusable';
                keyEl.textContent = keyChar;
                keyEl.setAttribute('data-key', keyChar);
                gridEl.appendChild(keyEl);
                this._keyElements.push(keyEl);
            }

            // Space key (wide, spans 3 columns)
            var spaceEl = document.createElement('div');
            spaceEl.className = 'keyboard-key keyboard-key-wide keyboard-key-action focusable';
            spaceEl.textContent = 'ESPACIO';
            spaceEl.setAttribute('data-key', ' ');
            gridEl.appendChild(spaceEl);
            this._keyElements.push(spaceEl);

            // Delete key (wide, spans 3 columns)
            var delEl = document.createElement('div');
            delEl.className = 'keyboard-key keyboard-key-wide keyboard-key-action focusable';
            delEl.textContent = 'BORRAR';
            delEl.setAttribute('data-key', 'DEL');
            gridEl.appendChild(delEl);
            this._keyElements.push(delEl);

            leftPanel.appendChild(gridEl);
            this._container.appendChild(leftPanel);

            // --- Right panel: results ---
            var rightPanel = document.createElement('div');
            rightPanel.className = 'search-right';

            var resultsTitle = document.createElement('div');
            resultsTitle.className = 'search-results-title';
            resultsTitle.id = 'search-results-title';
            resultsTitle.textContent = '';
            rightPanel.appendChild(resultsTitle);

            var resultsGrid = document.createElement('div');
            resultsGrid.className = 'search-results-grid';
            resultsGrid.id = 'search-results-grid';
            rightPanel.appendChild(resultsGrid);

            this._container.appendChild(rightPanel);

            // Store references
            this._displayEl = searchTextSpan;
            this._resultsEl = resultsGrid;
            this._resultsTitleEl = resultsTitle;

            // --- Setup custom key handler for grid navigation ---
            // We do NOT use App.Focus for keyboard grid because it does not support
            // grid orientation. Instead, we manage keyboard focus ourselves.
            this._setupKeyHandler();

            // Set initial visual focus on first key
            this._updateKeyboardFocus(0);
        },

        /**
         * Setup custom key handler for:
         * - Grid navigation within keyboard (UP/DOWN moves by COLS, LEFT/RIGHT by 1)
         * - Grid navigation within results
         * - Switching between keyboard and results panels
         * - OK key to type/delete/select
         * - BACK key handled by router
         */
        _setupKeyHandler: function() {
            var self = this;

            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
            }

            // Disable the global Focus key handler while search is active,
            // since we manage all navigation ourselves
            if (App.Focus && App.Focus.disable) {
                App.Focus.disable();
            }

            this._keyHandler = function(e) {
                if (!self._container || self._container.style.display === 'none') return;

                var key = e.keyCode;

                // Let BACK key propagate to Router
                if (key === App.Config.KEYS.BACK) return;

                e.preventDefault();
                e.stopImmediatePropagation();

                if (self._activePanel === 'nav') {
                    self._handleNavNav(key);
                } else if (self._activePanel === 'keyboard') {
                    self._handleKeyboardNav(key);
                } else {
                    self._handleResultsNav(key);
                }
            };

            document.addEventListener('keydown', this._keyHandler);
        },

        /**
         * Handle D-pad navigation within the keyboard grid.
         */
        _handleKeyboardNav: function(key) {
            var idx = this._keyboardFocusIndex;
            var totalKeys = this._keyElements.length;

            // The last row has 2 wide keys: SPACE (index totalKeys-2) and DELETE (index totalKeys-1)
            // Regular keys: indices 0 to KEYS_LAYOUT.length - 1 (0 to 35)
            // Action keys: SPACE = 36, DELETE = 37
            var regularCount = KEYS_LAYOUT.length; // 36
            var isOnActionRow = idx >= regularCount;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (isOnActionRow) {
                        // Move between SPACE and DELETE
                        if (idx === regularCount + 1) {
                            this._updateKeyboardFocus(regularCount);
                        }
                        // At SPACE, LEFT does nothing (already at left edge)
                    } else {
                        var col = idx % KEYBOARD_COLS;
                        if (col > 0) {
                            this._updateKeyboardFocus(idx - 1);
                        }
                        // At left edge, do nothing
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (isOnActionRow) {
                        if (idx === regularCount) {
                            // From SPACE to DELETE
                            this._updateKeyboardFocus(regularCount + 1);
                        } else {
                            // From DELETE (rightmost action key) -> jump to results
                            this._switchToResults();
                        }
                    } else {
                        var colR = idx % KEYBOARD_COLS;
                        if (colR < KEYBOARD_COLS - 1 && idx + 1 < regularCount) {
                            this._updateKeyboardFocus(idx + 1);
                        } else {
                            // At right edge -> jump to results
                            this._switchToResults();
                        }
                    }
                    break;

                case App.Config.KEYS.UP:
                    if (isOnActionRow) {
                        // Move up from action row to last row of regular keys
                        // SPACE covers cols 0-2, DELETE covers cols 3-5
                        var targetCol = (idx === regularCount) ? 1 : 4; // middle of each wide key
                        var lastRegularRow = Math.floor((regularCount - 1) / KEYBOARD_COLS);
                        var target = lastRegularRow * KEYBOARD_COLS + targetCol;
                        if (target >= regularCount) target = regularCount - 1;
                        this._updateKeyboardFocus(target);
                    } else {
                        var rowU = Math.floor(idx / KEYBOARD_COLS);
                        if (rowU > 0) {
                            this._updateKeyboardFocus(idx - KEYBOARD_COLS);
                        } else {
                            // At top row -> switch to nav panel
                            this._switchToNav();
                        }
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (isOnActionRow) {
                        // Already at bottom, do nothing
                    } else {
                        var rowD = Math.floor(idx / KEYBOARD_COLS);
                        var nextIdx = idx + KEYBOARD_COLS;
                        if (nextIdx < regularCount) {
                            this._updateKeyboardFocus(nextIdx);
                        } else {
                            // Move to action row
                            var colD = idx % KEYBOARD_COLS;
                            if (colD < 3) {
                                this._updateKeyboardFocus(regularCount); // SPACE
                            } else {
                                this._updateKeyboardFocus(regularCount + 1); // DELETE
                            }
                        }
                    }
                    break;

                case App.Config.KEYS.OK:
                    this._onKeyPress(this._keyElements[idx]);
                    break;
            }
        },

        /**
         * Handle D-pad navigation within the results grid.
         */
        _handleResultsNav: function(key) {
            var idx = this._resultsFocusIndex;
            var total = this._resultItems.length;

            if (total === 0) {
                // No results, LEFT goes back to keyboard
                if (key === App.Config.KEYS.LEFT) {
                    this._switchToKeyboard();
                }
                return;
            }

            var cols = Math.min(total, RESULTS_COLS);

            switch (key) {
                case App.Config.KEYS.LEFT:
                    var colL = idx % cols;
                    if (colL > 0) {
                        this._updateResultsFocus(idx - 1);
                    } else {
                        // At left edge of results -> switch to keyboard
                        this._switchToKeyboard();
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (idx + 1 < total) {
                        var colLR = idx % cols;
                        if (colLR < cols - 1) {
                            this._updateResultsFocus(idx + 1);
                        }
                    }
                    break;

                case App.Config.KEYS.UP:
                    if (idx - cols >= 0) {
                        this._updateResultsFocus(idx - cols);
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx + cols < total) {
                        this._updateResultsFocus(idx + cols);
                    }
                    break;

                case App.Config.KEYS.OK:
                    this._onResultSelect(idx);
                    break;
            }
        },

        /**
         * Switch active panel from keyboard to results.
         */
        _switchToResults: function() {
            if (this._resultItems.length === 0) return;

            this._activePanel = 'results';
            this._clearKeyboardFocus();
            this._updateResultsFocus(this._resultsFocusIndex);
        },

        /**
         * Switch active panel from results to keyboard.
         */
        _switchToKeyboard: function() {
            this._activePanel = 'keyboard';
            this._clearResultsFocus();
            this._clearNavFocus();
            this._updateKeyboardFocus(this._keyboardFocusIndex);
        },

        /**
         * Switch active panel to nav bar.
         */
        _switchToNav: function() {
            this._activePanel = 'nav';
            this._clearKeyboardFocus();
            this._clearResultsFocus();

            // Find the active nav item to start focus on
            this._navFocusIndex = 0;
            for (var i = 0; i < this._navItems.length; i++) {
                if (this._navItems[i].getAttribute('data-view') === 'search') {
                    this._navFocusIndex = i;
                    break;
                }
            }

            this._updateNavFocus(this._navFocusIndex);
        },

        /**
         * Handle D-pad navigation within the nav bar.
         */
        _handleNavNav: function(key) {
            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (this._navFocusIndex > 0) {
                        this._updateNavFocus(this._navFocusIndex - 1);
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (this._navFocusIndex < this._navItems.length - 1) {
                        this._updateNavFocus(this._navFocusIndex + 1);
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    // Return to keyboard from nav
                    this._clearNavFocus();
                    this._activePanel = 'keyboard';
                    this._updateKeyboardFocus(this._keyboardFocusIndex);
                    break;

                case App.Config.KEYS.OK:
                    // Select nav item
                    var item = this._navItems[this._navFocusIndex];
                    if (item) {
                        var view = item.getAttribute('data-view');
                        if (view && typeof App._onNavSelect === 'function') {
                            var allNavItems = [];
                            for (var i = 0; i < this._navItems.length; i++) {
                                allNavItems.push(this._navItems[i]);
                            }
                            App._onNavSelect(view, allNavItems);
                        }
                    }
                    break;
            }
        },

        /**
         * Update nav focus visual.
         */
        _updateNavFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._navItems.length) index = this._navItems.length - 1;
            this._navFocusIndex = index;

            for (var i = 0; i < this._navItems.length; i++) {
                this._navItems[i].classList.remove('focused');
            }
            this._navItems[index].classList.add('focused');
        },

        /**
         * Clear nav focus visual.
         */
        _clearNavFocus: function() {
            for (var i = 0; i < this._navItems.length; i++) {
                this._navItems[i].classList.remove('focused');
            }
        },

        /**
         * Update keyboard focus visual.
         */
        _updateKeyboardFocus: function(index) {
            // Clamp index
            if (index < 0) index = 0;
            if (index >= this._keyElements.length) index = this._keyElements.length - 1;

            this._keyboardFocusIndex = index;

            // Remove all keyboard focus
            for (var i = 0; i < this._keyElements.length; i++) {
                this._keyElements[i].classList.remove('focused');
            }

            // Add focus to current
            this._keyElements[index].classList.add('focused');
        },

        /**
         * Clear keyboard focus visual.
         */
        _clearKeyboardFocus: function() {
            for (var i = 0; i < this._keyElements.length; i++) {
                this._keyElements[i].classList.remove('focused');
            }
        },

        /**
         * Update results focus visual.
         */
        _updateResultsFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._resultItems.length) index = this._resultItems.length - 1;

            this._resultsFocusIndex = index;

            // Remove all results focus
            for (var i = 0; i < this._resultItems.length; i++) {
                this._resultItems[i].classList.remove('focused');
            }

            // Add focus to current and scroll into view
            var el = this._resultItems[index];
            el.classList.add('focused');

            // Ensure the focused result is visible
            var rect = el.getBoundingClientRect();
            var parentRect = this._resultsEl.getBoundingClientRect();
            if (rect.bottom > parentRect.bottom || rect.top < parentRect.top) {
                el.scrollIntoView({ block: 'nearest' });
            }
        },

        /**
         * Clear results focus visual.
         */
        _clearResultsFocus: function() {
            for (var i = 0; i < this._resultItems.length; i++) {
                this._resultItems[i].classList.remove('focused');
            }
        },

        /**
         * Handle pressing OK on a keyboard key.
         */
        _onKeyPress: function(el) {
            if (!el) return;

            var keyVal = el.getAttribute('data-key');
            if (keyVal === 'DEL') {
                this._searchText = this._searchText.slice(0, -1);
            } else {
                this._searchText += keyVal.toLowerCase();
            }

            this._updateDisplay();
            this._doSearch();
        },

        /**
         * Update the search text display.
         */
        _updateDisplay: function() {
            if (this._displayEl) {
                this._displayEl.textContent = this._searchText;
            }
        },

        /**
         * Perform search with debounce.
         * Searches locally in cached App._videos and App._series arrays.
         */
        _doSearch: function() {
            var self = this;

            if (this._debounceTimer) {
                clearTimeout(this._debounceTimer);
            }

            this._debounceTimer = setTimeout(function() {
                var query = self._searchText.toLowerCase().trim();

                if (query.length < 2) {
                    self._showResults([], []);
                    return;
                }

                // Search movies
                var movieResults = [];
                var videos = App._videos || [];
                for (var i = 0; i < videos.length; i++) {
                    var v = videos[i];
                    var title = (v.title || v.filename || '').toLowerCase();
                    if (title.indexOf(query) !== -1) {
                        movieResults.push({ type: 'movie', data: v });
                    }
                }

                // Search series
                var seriesResults = [];
                var series = App._series || [];
                for (var j = 0; j < series.length; j++) {
                    var s = series[j];
                    var sTitle = (s.name || s.title || s.folder_name || '').toLowerCase();
                    if (sTitle.indexOf(query) !== -1) {
                        seriesResults.push({ type: 'series', data: s });
                    }
                }

                // Combine: movies first, then series
                var combined = movieResults.concat(seriesResults);
                self._showResults(combined, query);
            }, 300);
        },

        /**
         * Render search results.
         * @param {Array} results - Array of { type: 'movie'|'series', data: Object }
         * @param {string} query - The search query (empty string if query too short).
         */
        _showResults: function(results, query) {
            this._resultsEl.innerHTML = '';
            this._resultItems = [];
            this._resultData = [];
            this._resultsFocusIndex = 0;

            if (!query || query.length < 2) {
                this._resultsTitleEl.textContent = '';
                return;
            }

            if (results.length === 0) {
                this._resultsTitleEl.textContent = 'Sin resultados';
                var noResultsEl = document.createElement('div');
                noResultsEl.className = 'search-no-results';
                noResultsEl.textContent = 'No se encontraron resultados para "' + this._searchText + '"';
                this._resultsEl.appendChild(noResultsEl);
                return;
            }

            this._resultsTitleEl.textContent = results.length + ' resultado' + (results.length !== 1 ? 's' : '');

            var limit = Math.min(results.length, MAX_RESULTS);

            for (var i = 0; i < limit; i++) {
                var result = results[i];
                var itemEl = this._createResultItem(result, i);
                this._resultsEl.appendChild(itemEl);
                this._resultItems.push(itemEl);
                this._resultData.push(result);
            }
        },

        /**
         * Create a single result item DOM element.
         * @param {Object} result - { type: 'movie'|'series', data: Object }
         * @param {number} index
         * @returns {HTMLElement}
         */
        _createResultItem: function(result, index) {
            var data = result.data;
            var isSeries = result.type === 'series';

            var itemEl = document.createElement('div');
            itemEl.className = 'search-result-item focusable';
            itemEl.setAttribute('data-index', index);

            var wrapper = document.createElement('div');
            wrapper.className = 'poster-wrapper';

            var img = document.createElement('img');
            img.className = 'poster-img';

            var posterPath = isSeries
                ? (data.poster_path || data.poster || null)
                : (data.poster || data.poster_path || null);

            img.setAttribute('data-src', App.Config.posterUrl(posterPath));
            img.alt = (isSeries ? data.name : data.title) || '';
            img.onload = function() { img.classList.add('loaded'); };

            wrapper.appendChild(img);

            // Type badge for series
            if (isSeries) {
                var typeBadge = document.createElement('div');
                typeBadge.className = 'search-type-badge';
                typeBadge.textContent = 'Serie';
                wrapper.appendChild(typeBadge);
            }

            itemEl.appendChild(wrapper);

            var titleDiv = document.createElement('div');
            titleDiv.className = 'poster-title';
            titleDiv.textContent = (isSeries ? (data.name || data.title) : (data.title || data.filename)) || '';
            itemEl.appendChild(titleDiv);

            // Lazy load
            if (App.Images && App.Images.observe) {
                App.Images.observe(img);
            }

            return itemEl;
        },

        /**
         * Handle selecting a result item.
         * @param {number} index - Index in resultData array.
         */
        _onResultSelect: function(index) {
            if (index < 0 || index >= this._resultData.length) return;

            var result = this._resultData[index];

            if (result.type === 'series') {
                App.Router.navigate('SERIES', result.data);
            } else {
                App.Router.navigate('DETAIL', result.data);
            }
        },

        /**
         * Hide the search view and clean up.
         */
        hide: function() {
            if (this._container) {
                this._container.style.display = 'none';
                this._container.innerHTML = '';
            }

            if (this._debounceTimer) {
                clearTimeout(this._debounceTimer);
                this._debounceTimer = null;
            }

            // Remove custom key handler
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
                this._keyHandler = null;
            }

            // Re-enable global focus handler
            if (App.Focus && App.Focus.enable) {
                App.Focus.enable();
            }

            // Clean up state
            this._clearNavFocus();
            this._searchText = '';
            this._resultItems = [];
            this._resultData = [];
            this._keyElements = [];
            this._navItems = [];
            this._keyboardFocusIndex = 0;
            this._resultsFocusIndex = 0;
            this._navFocusIndex = 0;
            this._activePanel = 'keyboard';
            this._displayEl = null;
            this._resultsEl = null;
            this._resultsTitleEl = null;

            // Clear image queue
            if (App.Images && App.Images.clearQueue) {
                App.Images.clearQueue();
            }
        }
    };
})();
