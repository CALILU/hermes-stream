/**
 * IsiPrime webOS App - Requests View
 * Movie request system with on-screen keyboard (TMDB search) and requests list.
 * Two tabs: "Pedir" (search+request) and "Peticiones" (existing requests list).
 * D-pad navigation, custom key handler (like search.js).
 *
 * Chromium ~87 compatible (no optional chaining, no nullish coalescing).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    var KEYBOARD_COLS = 6;
    var KEYS_LAYOUT = 'ABCDEFGHIJKLMN\u00d1OPQRSTUVWXYZ0123456789'.split('');
    var RESULTS_COLS = 4;
    var MAX_RESULTS = 20;

    var STATUS_MAP = {
        pending:     { label: 'Pendiente',   color: '#f59e0b' },
        downloading: { label: 'Descargando', color: '#3b82f6' },
        downloaded:  { label: 'Descargado',  color: '#22c55e' },
        mp4:         { label: 'MP4',         color: '#a855f7' },
        server:      { label: 'En servidor', color: '#10b981' },
        rejected:    { label: 'Rechazada',   color: '#ef4444' }
    };

    var STATUS_ORDER = ['pending', 'downloading', 'downloaded', 'mp4', 'server', 'rejected'];

    App.Requests = {
        _container: null,
        _activeTab: 'search',       // 'search' or 'list'
        _activePanel: 'tabs',       // 'tabs', 'keyboard', 'results', 'submit', 'list', 'nav', 'statusMenu'

        // Keyboard state
        _searchText: '',
        _displayEl: null,
        _keyElements: [],
        _keyboardFocusIndex: 0,

        // TMDB results
        _resultsEl: null,
        _resultsTitleEl: null,
        _resultItems: [],
        _resultData: [],
        _resultsFocusIndex: 0,

        // Selection
        _selected: {},              // { tmdbId: movieData }
        _selectedCount: 0,
        _submitBtn: null,
        _existingTmdbIds: {},       // tmdbIds already requested
        _catalogTmdbIds: {},        // tmdbIds in local catalog
        _catalogTitles: {},         // normalized titles in local catalog

        // Tabs
        _tabEls: [],
        _tabFocusIndex: 0,

        // Nav
        _navItems: [],
        _navFocusIndex: 0,

        // List
        _listEl: null,
        _listItems: [],
        _listData: [],
        _listFocusIndex: 0,
        _allRequests: [],           // unfiltered requests
        _activeFilter: 'all',      // 'all' or a status key

        // Filters
        _filterEls: [],
        _filterFocusIndex: 0,

        // Status menu
        _statusMenuEl: null,
        _statusMenuItems: [],
        _statusMenuFocusIndex: 0,
        _statusMenuRequestId: null,

        // Misc
        _debounceTimer: null,
        _keyHandler: null,
        _toastTimer: null,
        _isAdmin: false,

        // =============================================
        //  SHOW / HIDE
        // =============================================

        show: function() {
            var self = this;
            this._container = document.getElementById('requests-view');
            this._container.style.display = '';
            this._container.innerHTML = '';
            this._resetState();

            // Detect admin (LAN users are admin)
            this._isAdmin = App.API._isLocal;

            // Capture nav items
            var navItemEls = document.querySelectorAll('#nav-bar .nav-item');
            for (var n = 0; n < navItemEls.length; n++) {
                this._navItems.push(navItemEls[n]);
            }

            // Load existing requests to know which tmdbIds are already requested
            App.API.getRequests().then(function(data) {
                var requests = (data && data.requests) ? data.requests : [];
                self._existingTmdbIds = {};
                for (var i = 0; i < requests.length; i++) {
                    var rid = requests[i].tmdbId || requests[i].tmdb_id;
                    if (rid) {
                        self._existingTmdbIds[rid] = true;
                    }
                }
            }).catch(function() {});

            // Build catalog lookup from local movies
            this._catalogTmdbIds = {};
            this._catalogTitles = {};
            var videos = App._videos || [];
            for (var v = 0; v < videos.length; v++) {
                var vid = videos[v];
                if (vid.tmdbId) {
                    this._catalogTmdbIds[String(vid.tmdbId)] = true;
                }
                if (vid.title) {
                    this._catalogTitles[vid.title.toLowerCase().trim()] = true;
                }
            }

            this._buildUI();
            this._setupKeyHandler();
            this._showTab('search');
        },

        hide: function() {
            if (this._container) {
                this._container.style.display = 'none';
                this._container.innerHTML = '';
            }
            if (this._debounceTimer) {
                clearTimeout(this._debounceTimer);
                this._debounceTimer = null;
            }
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler, true);
                this._keyHandler = null;
            }
            if (App.Focus && App.Focus.enable) {
                App.Focus.enable();
            }
            this._hideStatusMenu();
            this._resetState();
            if (App.Images && App.Images.clearQueue) {
                App.Images.clearQueue();
            }
        },

        _resetState: function() {
            this._searchText = '';
            this._keyElements = [];
            this._keyboardFocusIndex = 0;
            this._resultItems = [];
            this._resultData = [];
            this._resultsFocusIndex = 0;
            this._selected = {};
            this._selectedCount = 0;
            this._tabEls = [];
            this._tabFocusIndex = 0;
            this._navItems = [];
            this._navFocusIndex = 0;
            this._listItems = [];
            this._listData = [];
            this._listFocusIndex = 0;
            this._allRequests = [];
            this._activeFilter = 'all';
            this._filterEls = [];
            this._filterFocusIndex = 0;
            this._statusMenuItems = [];
            this._statusMenuFocusIndex = 0;
            this._statusMenuRequestId = null;
            this._activeTab = 'search';
            this._activePanel = 'tabs';
            this._displayEl = null;
            this._resultsEl = null;
            this._resultsTitleEl = null;
            this._submitBtn = null;
            this._listEl = null;
            this._statusMenuEl = null;
        },

        // =============================================
        //  BUILD UI
        // =============================================

        _buildUI: function() {
            // Tabs
            var tabBar = document.createElement('div');
            tabBar.className = 'requests-tabs';

            var tabSearch = document.createElement('button');
            tabSearch.className = 'requests-tab focusable active';
            tabSearch.textContent = 'Pedir';
            tabSearch.setAttribute('data-tab', 'search');

            var tabList = document.createElement('button');
            tabList.className = 'requests-tab focusable';
            tabList.textContent = 'Peticiones';
            tabList.setAttribute('data-tab', 'list');

            tabBar.appendChild(tabSearch);
            tabBar.appendChild(tabList);

            // Filter buttons (same bar, shown only on list tab)
            var filterContainer = document.createElement('div');
            filterContainer.className = 'requests-filters-inline';
            filterContainer.id = 'requests-filters-inline';
            filterContainer.style.display = 'none';
            tabBar.appendChild(filterContainer);
            this._filterContainer = filterContainer;

            this._container.appendChild(tabBar);

            this._tabEls = [tabSearch, tabList];

            // Click handlers for Magic Remote
            var self = this;
            tabSearch.addEventListener('click', function() { self._showTab('search'); });
            tabList.addEventListener('click', function() { self._showTab('list'); });

            // Search tab content
            var searchContent = document.createElement('div');
            searchContent.className = 'requests-search-content';
            searchContent.id = 'requests-search-content';

            // Left panel: keyboard
            var leftPanel = document.createElement('div');
            leftPanel.className = 'requests-search-left';

            var inputDisplay = document.createElement('div');
            inputDisplay.className = 'search-input-display';
            var searchTextSpan = document.createElement('span');
            searchTextSpan.id = 'requests-search-text';
            inputDisplay.appendChild(searchTextSpan);
            var cursor = document.createElement('span');
            cursor.className = 'search-input-cursor';
            inputDisplay.appendChild(cursor);
            leftPanel.appendChild(inputDisplay);

            var gridEl = document.createElement('div');
            gridEl.className = 'keyboard-grid';
            this._keyElements = [];

            for (var i = 0; i < KEYS_LAYOUT.length; i++) {
                var keyEl = document.createElement('div');
                keyEl.className = 'keyboard-key focusable';
                keyEl.textContent = KEYS_LAYOUT[i];
                keyEl.setAttribute('data-key', KEYS_LAYOUT[i]);
                gridEl.appendChild(keyEl);
                this._keyElements.push(keyEl);
            }

            var spaceEl = document.createElement('div');
            spaceEl.className = 'keyboard-key keyboard-key-full keyboard-key-action focusable';
            spaceEl.textContent = 'ESPACIO';
            spaceEl.setAttribute('data-key', ' ');
            gridEl.appendChild(spaceEl);
            this._keyElements.push(spaceEl);

            var delEl = document.createElement('div');
            delEl.className = 'keyboard-key keyboard-key-full keyboard-key-action focusable';
            delEl.textContent = 'BORRAR';
            delEl.setAttribute('data-key', 'DEL');
            gridEl.appendChild(delEl);
            this._keyElements.push(delEl);

            // Click + hover for Magic Remote on all keys
            for (var ki = 0; ki < this._keyElements.length; ki++) {
                (function(keyIndex, keyElement) {
                    keyElement.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._activePanel = 'keyboard';
                        self._updateKeyboardFocus(keyIndex);
                        self._onKeyPress(keyElement);
                    });
                    keyElement.addEventListener('mouseenter', function() {
                        if (self._activePanel !== 'keyboard') {
                            self._clearResultsFocus();
                        }
                        self._activePanel = 'keyboard';
                        self._updateKeyboardFocus(keyIndex);
                    });
                })(ki, this._keyElements[ki]);
            }

            leftPanel.appendChild(gridEl);

            // Submit button
            var submitBtn = document.createElement('button');
            submitBtn.className = 'requests-submit-btn focusable';
            submitBtn.textContent = 'Enviar peticiones (0)';
            submitBtn.style.display = 'none';
            leftPanel.appendChild(submitBtn);
            this._submitBtn = submitBtn;

            submitBtn.addEventListener('click', function() { self._submitRequests(); });

            searchContent.appendChild(leftPanel);

            // Right panel: TMDB results
            var rightPanel = document.createElement('div');
            rightPanel.className = 'requests-search-right';

            var resultsTitle = document.createElement('div');
            resultsTitle.className = 'search-results-title';
            rightPanel.appendChild(resultsTitle);

            var resultsGrid = document.createElement('div');
            resultsGrid.className = 'requests-tmdb-grid';
            rightPanel.appendChild(resultsGrid);

            searchContent.appendChild(rightPanel);
            this._container.appendChild(searchContent);

            this._displayEl = searchTextSpan;
            this._resultsEl = resultsGrid;
            this._resultsTitleEl = resultsTitle;

            // List tab content
            var listContent = document.createElement('div');
            listContent.className = 'requests-list-content';
            listContent.id = 'requests-list-content';
            listContent.style.display = 'none';
            this._container.appendChild(listContent);
            this._listEl = listContent;
        },

        // =============================================
        //  TABS
        // =============================================

        _showTab: function(tab) {
            this._activeTab = tab;
            var searchContent = document.getElementById('requests-search-content');
            var listContent = document.getElementById('requests-list-content');

            // Update tab active classes
            for (var i = 0; i < this._tabEls.length; i++) {
                this._tabEls[i].classList.remove('active');
            }

            if (tab === 'search') {
                if (searchContent) searchContent.style.display = '';
                if (listContent) listContent.style.display = 'none';
                if (this._filterContainer) this._filterContainer.style.display = 'none';
                this._tabEls[0].classList.add('active');
                this._activePanel = 'keyboard';
                this._updateKeyboardFocus(this._keyboardFocusIndex);
            } else {
                if (searchContent) searchContent.style.display = 'none';
                if (listContent) listContent.style.display = '';
                if (this._filterContainer) this._filterContainer.style.display = '';
                this._tabEls[1].classList.add('active');
                this._loadRequestsList();
            }
        },

        // =============================================
        //  KEY HANDLER
        // =============================================

        _setupKeyHandler: function() {
            var self = this;

            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler, true);
            }

            if (App.Focus && App.Focus.disable) {
                App.Focus.disable();
            }

            this._keyHandler = function(e) {
                if (!self._container || self._container.style.display === 'none') return;

                var key = e.keyCode;
                if (key === App.Config.KEYS.BACK) {
                    if (self._activePanel === 'statusMenu') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        self._hideStatusMenu();
                        self._activePanel = 'list';
                        if (self._listItems.length > 0) {
                            self._updateListFocus(self._listFocusIndex);
                        }
                    }
                    return;
                }

                // Color key shortcuts
                if (key === App.Config.KEYS.GREEN) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    self._showTab('search');
                    return;
                }
                if (key === App.Config.KEYS.YELLOW) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    self._showTab('list');
                    return;
                }

                e.preventDefault();
                e.stopImmediatePropagation();

                switch (self._activePanel) {
                    case 'nav':
                        self._handleNavNav(key);
                        break;
                    case 'tabs':
                        self._handleTabsNav(key);
                        break;
                    case 'keyboard':
                        self._handleKeyboardNav(key);
                        break;
                    case 'results':
                        self._handleResultsNav(key);
                        break;
                    case 'submit':
                        self._handleSubmitNav(key);
                        break;
                    case 'filters':
                        self._handleFiltersNav(key);
                        break;
                    case 'list':
                        self._handleListNav(key);
                        break;
                    case 'statusMenu':
                        self._handleStatusMenuNav(key);
                        break;
                }
            };

            document.addEventListener('keydown', this._keyHandler, true);
        },

        // =============================================
        //  NAV PANEL
        // =============================================

        _switchToNav: function() {
            this._activePanel = 'nav';
            this._clearAllFocus();

            this._navFocusIndex = 0;
            for (var i = 0; i < this._navItems.length; i++) {
                if (this._navItems[i].getAttribute('data-view') === 'requests') {
                    this._navFocusIndex = i;
                    break;
                }
            }
            this._updateNavFocus(this._navFocusIndex);
        },

        _handleNavNav: function(key) {
            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (this._navFocusIndex > 0) this._updateNavFocus(this._navFocusIndex - 1);
                    break;
                case App.Config.KEYS.RIGHT:
                    if (this._navFocusIndex < this._navItems.length - 1) this._updateNavFocus(this._navFocusIndex + 1);
                    break;
                case App.Config.KEYS.DOWN:
                    this._clearNavFocus();
                    this._activePanel = 'tabs';
                    this._updateTabFocus(this._tabFocusIndex);
                    break;
                case App.Config.KEYS.OK:
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

        _updateNavFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._navItems.length) index = this._navItems.length - 1;
            this._navFocusIndex = index;
            for (var i = 0; i < this._navItems.length; i++) {
                this._navItems[i].classList.remove('focused');
            }
            this._navItems[index].classList.add('focused');
        },

        _clearNavFocus: function() {
            for (var i = 0; i < this._navItems.length; i++) {
                this._navItems[i].classList.remove('focused');
            }
        },

        // =============================================
        //  TABS PANEL
        // =============================================

        _handleTabsNav: function(key) {
            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (this._tabFocusIndex > 0) this._updateTabFocus(this._tabFocusIndex - 1);
                    break;
                case App.Config.KEYS.RIGHT:
                    if (this._tabFocusIndex < this._tabEls.length - 1) {
                        this._updateTabFocus(this._tabFocusIndex + 1);
                    } else if (this._activeTab === 'list' && this._filterEls.length > 0) {
                        // From last tab, jump to filters
                        this._clearTabFocus();
                        this._activePanel = 'filters';
                        this._updateFilterFocus(0);
                    }
                    break;
                case App.Config.KEYS.UP:
                    this._clearTabFocus();
                    this._switchToNav();
                    break;
                case App.Config.KEYS.DOWN:
                    this._clearTabFocus();
                    if (this._activeTab === 'search') {
                        this._activePanel = 'keyboard';
                        this._updateKeyboardFocus(this._keyboardFocusIndex);
                    } else {
                        // Go to list directly (filters are on same row as tabs)
                        if (this._listItems.length > 0) {
                            this._activePanel = 'list';
                            this._updateListFocus(this._listFocusIndex);
                        }
                    }
                    break;
                case App.Config.KEYS.OK:
                    var tab = this._tabEls[this._tabFocusIndex].getAttribute('data-tab');
                    this._showTab(tab);
                    break;
            }
        },

        _updateTabFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._tabEls.length) index = this._tabEls.length - 1;
            this._tabFocusIndex = index;
            for (var i = 0; i < this._tabEls.length; i++) {
                this._tabEls[i].classList.remove('focused');
            }
            this._tabEls[index].classList.add('focused');
        },

        _clearTabFocus: function() {
            for (var i = 0; i < this._tabEls.length; i++) {
                this._tabEls[i].classList.remove('focused');
            }
        },

        // =============================================
        //  KEYBOARD PANEL (Search tab)
        // =============================================

        _handleKeyboardNav: function(key) {
            var idx = this._keyboardFocusIndex;
            var regularCount = KEYS_LAYOUT.length; // 37 (A-Z + Ñ + 0-9)
            var SPACE_IDX = regularCount;      // 37
            var DEL_IDX = regularCount + 1;    // 38
            var isOnAction = idx >= regularCount;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (!isOnAction) {
                        var col = idx % KEYBOARD_COLS;
                        if (col > 0) this._updateKeyboardFocus(idx - 1);
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (isOnAction) {
                        this._switchToResults();
                    } else {
                        var colR = idx % KEYBOARD_COLS;
                        if (colR < KEYBOARD_COLS - 1 && idx + 1 < regularCount) {
                            this._updateKeyboardFocus(idx + 1);
                        } else {
                            this._switchToResults();
                        }
                    }
                    break;

                case App.Config.KEYS.UP:
                    if (idx === DEL_IDX) {
                        this._updateKeyboardFocus(SPACE_IDX);
                    } else if (idx === SPACE_IDX) {
                        // Go to last row center
                        var lastRow = Math.floor((regularCount - 1) / KEYBOARD_COLS);
                        var target = lastRow * KEYBOARD_COLS + 2;
                        if (target >= regularCount) target = regularCount - 1;
                        this._updateKeyboardFocus(target);
                    } else {
                        var rowU = Math.floor(idx / KEYBOARD_COLS);
                        if (rowU > 0) {
                            this._updateKeyboardFocus(idx - KEYBOARD_COLS);
                        } else {
                            this._clearKeyboardFocus();
                            this._activePanel = 'tabs';
                            this._updateTabFocus(this._tabFocusIndex);
                        }
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx === DEL_IDX) {
                        if (this._submitBtn && this._submitBtn.style.display !== 'none') {
                            this._clearKeyboardFocus();
                            this._activePanel = 'submit';
                            this._submitBtn.classList.add('focused');
                        }
                    } else if (idx === SPACE_IDX) {
                        this._updateKeyboardFocus(DEL_IDX);
                    } else {
                        var nextIdx = idx + KEYBOARD_COLS;
                        if (nextIdx < regularCount) {
                            this._updateKeyboardFocus(nextIdx);
                        } else {
                            this._updateKeyboardFocus(SPACE_IDX);
                        }
                    }
                    break;

                case App.Config.KEYS.OK:
                    this._onKeyPress(this._keyElements[idx]);
                    break;
            }
        },

        _switchToResults: function() {
            if (this._resultItems.length === 0) return;
            this._activePanel = 'results';
            this._clearKeyboardFocus();
            this._updateResultsFocus(this._resultsFocusIndex);
        },

        _switchToKeyboard: function() {
            this._activePanel = 'keyboard';
            this._clearResultsFocus();
            this._updateKeyboardFocus(this._keyboardFocusIndex);
        },

        _updateKeyboardFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._keyElements.length) index = this._keyElements.length - 1;
            this._keyboardFocusIndex = index;
            for (var i = 0; i < this._keyElements.length; i++) {
                this._keyElements[i].classList.remove('focused');
            }
            this._keyElements[index].classList.add('focused');
        },

        _clearKeyboardFocus: function() {
            for (var i = 0; i < this._keyElements.length; i++) {
                this._keyElements[i].classList.remove('focused');
            }
        },

        // =============================================
        //  RESULTS PANEL (Search tab)
        // =============================================

        _getResultsCols: function() {
            if (this._resultItems.length < 2) return 1;
            // Use offsetTop — not affected by CSS transform: scale()
            var firstTop = this._resultItems[0].offsetTop;
            for (var c = 1; c < this._resultItems.length; c++) {
                if (this._resultItems[c].offsetTop > firstTop + 5) {
                    return c;
                }
            }
            return this._resultItems.length;
        },

        _handleResultsNav: function(key) {
            var idx = this._resultsFocusIndex;
            var total = this._resultItems.length;

            if (total === 0) {
                if (key === App.Config.KEYS.LEFT) this._switchToKeyboard();
                return;
            }

            var cols = this._getResultsCols();
            var col = idx % cols;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (col > 0) {
                        this._updateResultsFocus(idx - 1);
                    } else {
                        this._switchToKeyboard();
                    }
                    break;
                case App.Config.KEYS.RIGHT:
                    if (col < cols - 1 && idx + 1 < total) {
                        this._updateResultsFocus(idx + 1);
                    }
                    break;
                case App.Config.KEYS.UP:
                    if (idx - cols >= 0) {
                        this._updateResultsFocus(idx - cols);
                    } else {
                        // First row — go to tabs
                        this._clearResultsFocus();
                        this._activePanel = 'tabs';
                        this._updateTabFocus(this._tabFocusIndex);
                    }
                    break;
                case App.Config.KEYS.DOWN:
                    if (idx + cols < total) {
                        this._updateResultsFocus(idx + cols);
                    } else if (idx < total - 1) {
                        // Last full row but partial row below — snap to last item
                        this._updateResultsFocus(total - 1);
                    }
                    break;
                case App.Config.KEYS.OK:
                    this._toggleSelection(idx);
                    break;
            }
        },

        _updateResultsFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._resultItems.length) index = this._resultItems.length - 1;
            this._resultsFocusIndex = index;
            for (var i = 0; i < this._resultItems.length; i++) {
                this._resultItems[i].classList.remove('focused');
            }
            var el = this._resultItems[index];
            el.classList.add('focused');
            var rect = el.getBoundingClientRect();
            var parentRect = this._resultsEl.getBoundingClientRect();
            if (rect.bottom > parentRect.bottom || rect.top < parentRect.top) {
                el.scrollIntoView({ block: 'nearest' });
            }
        },

        _clearResultsFocus: function() {
            for (var i = 0; i < this._resultItems.length; i++) {
                this._resultItems[i].classList.remove('focused');
            }
        },

        // =============================================
        //  SUBMIT BUTTON
        // =============================================

        _handleSubmitNav: function(key) {
            switch (key) {
                case App.Config.KEYS.UP:
                    this._submitBtn.classList.remove('focused');
                    this._activePanel = 'keyboard';
                    // Focus the last action row key
                    this._updateKeyboardFocus(KEYS_LAYOUT.length);
                    break;
                case App.Config.KEYS.RIGHT:
                    if (this._resultItems.length > 0) {
                        this._submitBtn.classList.remove('focused');
                        this._activePanel = 'results';
                        this._updateResultsFocus(this._resultsFocusIndex);
                    }
                    break;
                case App.Config.KEYS.LEFT:
                    // Same as UP — go back to keyboard
                    this._submitBtn.classList.remove('focused');
                    this._activePanel = 'keyboard';
                    this._updateKeyboardFocus(KEYS_LAYOUT.length);
                    break;
                case App.Config.KEYS.OK:
                    this._submitRequests();
                    break;
            }
        },

        // =============================================
        //  KEYBOARD INPUT
        // =============================================

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

        _updateDisplay: function() {
            if (this._displayEl) {
                this._displayEl.textContent = this._searchText;
            }
        },

        // =============================================
        //  TMDB SEARCH
        // =============================================

        _doSearch: function() {
            var self = this;
            if (this._debounceTimer) clearTimeout(this._debounceTimer);

            this._debounceTimer = setTimeout(function() {
                var query = self._searchText.trim();
                if (query.length < 2) {
                    self._showTMDBResults([]);
                    return;
                }
                App.API.searchTMDB(query).then(function(data) {
                    var results = (data && data.results) ? data.results : [];
                    self._showTMDBResults(results);
                }).catch(function() {
                    self._showTMDBResults([]);
                });
            }, 300);
        },

        _showTMDBResults: function(results) {
            this._resultsEl.innerHTML = '';
            this._resultItems = [];
            this._resultData = [];
            this._resultsFocusIndex = 0;

            if (this._searchText.trim().length < 2) {
                this._resultsTitleEl.textContent = '';
                return;
            }

            if (results.length === 0) {
                this._resultsTitleEl.textContent = 'Sin resultados';
                return;
            }

            this._resultsTitleEl.textContent = results.length + ' resultado' + (results.length !== 1 ? 's' : '');

            var limit = Math.min(results.length, MAX_RESULTS);
            for (var i = 0; i < limit; i++) {
                var movie = results[i];
                var itemEl = this._createTMDBItem(movie, i);
                this._resultsEl.appendChild(itemEl);
                this._resultItems.push(itemEl);
                this._resultData.push(movie);
            }
        },

        _createTMDBItem: function(movie, index) {
            var self = this;
            var tmdbId = movie.tmdbId || movie.id;
            var title = movie.title || movie.name || '';
            var year = movie.year || '';
            if (!year && movie.releaseDate) {
                year = movie.releaseDate.substring(0, 4);
            }
            // Backend returns full URL in 'poster', or relative path in 'poster_path'
            var posterUrl = movie.poster || '';
            if (!posterUrl && movie.poster_path) {
                posterUrl = App.Config.posterUrl(movie.poster_path);
            }

            var itemEl = document.createElement('div');
            itemEl.className = 'requests-tmdb-item focusable';
            itemEl.setAttribute('data-index', index);

            var wrapper = document.createElement('div');
            wrapper.className = 'poster-wrapper';

            var img = document.createElement('img');
            img.className = 'poster-img';
            img.setAttribute('data-src', posterUrl || 'assets/placeholder.svg');
            img.alt = title;
            img.onload = function() { img.classList.add('loaded'); };
            wrapper.appendChild(img);

            // Selected overlay
            var overlay = document.createElement('div');
            overlay.className = 'requests-selected-overlay';
            overlay.style.display = 'none';
            var checkMark = document.createElement('div');
            checkMark.className = 'requests-selected-check';
            checkMark.textContent = '\u2713';
            overlay.appendChild(checkMark);
            wrapper.appendChild(overlay);

            // "Pedida" badge if already requested
            if (this._existingTmdbIds[tmdbId] || this._existingTmdbIds[movie.tmdbId]) {
                var badge = document.createElement('div');
                badge.className = 'requests-already-badge';
                badge.textContent = 'Pedida';
                wrapper.appendChild(badge);
            }

            // "En catálogo" badge if movie exists locally
            var inCatalog = this._catalogTmdbIds[String(tmdbId)] ||
                            (title && this._catalogTitles[title.toLowerCase().trim()]);
            if (inCatalog) {
                itemEl.classList.add('in-catalog');
                var catBadge = document.createElement('div');
                catBadge.className = 'requests-catalog-badge';
                catBadge.textContent = 'En cat\u00e1logo';
                wrapper.appendChild(catBadge);
            }

            itemEl.appendChild(wrapper);

            var titleDiv = document.createElement('div');
            titleDiv.className = 'poster-title';
            titleDiv.textContent = title + (year ? ' (' + year + ')' : '');
            itemEl.appendChild(titleDiv);

            // Check if currently selected
            if (this._selected[tmdbId]) {
                overlay.style.display = 'flex';
                itemEl.classList.add('selected');
            }

            // Lazy load
            if (App.Images && App.Images.observe) {
                App.Images.observe(img);
            }

            // Click handler (Magic Remote)
            (function(idx, element) {
                element.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self._activePanel = 'results';
                    self._clearKeyboardFocus();
                    self._updateResultsFocus(idx);
                    self._toggleSelection(idx);
                });
                element.addEventListener('mouseenter', function() {
                    self._activePanel = 'results';
                    self._clearKeyboardFocus();
                    self._updateResultsFocus(idx);
                    if (title) App._showHoverTooltip(title, element);
                });
                element.addEventListener('mouseleave', function() {
                    App._hideHoverTooltip();
                });
            })(index, itemEl);

            return itemEl;
        },

        // =============================================
        //  SELECTION
        // =============================================

        _toggleSelection: function(index) {
            if (index < 0 || index >= this._resultData.length) return;
            var movie = this._resultData[index];
            var tmdbId = movie.id || movie.tmdbId;
            var itemEl = this._resultItems[index];
            var overlay = itemEl.querySelector('.requests-selected-overlay');

            if (this._selected[tmdbId]) {
                delete this._selected[tmdbId];
                this._selectedCount--;
                itemEl.classList.remove('selected');
                if (overlay) overlay.style.display = 'none';
            } else {
                this._selected[tmdbId] = movie;
                this._selectedCount++;
                itemEl.classList.add('selected');
                if (overlay) overlay.style.display = 'flex';
            }

            this._updateSubmitButton();
        },

        _updateSubmitButton: function() {
            if (!this._submitBtn) return;
            if (this._selectedCount > 0) {
                this._submitBtn.style.display = '';
                this._submitBtn.textContent = 'Enviar peticiones (' + this._selectedCount + ')';
            } else {
                this._submitBtn.style.display = 'none';
            }
        },

        // =============================================
        //  SUBMIT
        // =============================================

        _submitRequests: function() {
            if (this._selectedCount === 0) return;

            var self = this;
            var movies = [];
            var keys = Object.keys(this._selected);
            for (var i = 0; i < keys.length; i++) {
                var m = this._selected[keys[i]];
                movies.push({
                    tmdbId: m.tmdbId || m.id,
                    title: m.title || m.name || '',
                    year: m.year || '',
                    poster: m.poster || m.poster_path || ''
                });
            }

            App.API.submitRequests(movies, 'TV').then(function(data) {
                if (data && data.success) {
                    var msg = data.created + ' peticion' + (data.created !== 1 ? 'es' : '') + ' enviada' + (data.created !== 1 ? 's' : '');
                    if (data.duplicates > 0) {
                        msg += ' (' + data.duplicates + ' duplicada' + (data.duplicates !== 1 ? 's' : '') + ')';
                    }
                    self._showToast(msg, 'success');
                    // Update existing ids
                    for (var k = 0; k < movies.length; k++) {
                        self._existingTmdbIds[movies[k].tmdbId] = true;
                    }
                    // Clear selection
                    self._selected = {};
                    self._selectedCount = 0;
                    self._updateSubmitButton();
                    // Refresh results to show "Pedida" badges
                    self._doSearch();
                } else {
                    self._showToast('Error al enviar peticiones', 'error');
                }
            }).catch(function() {
                self._showToast('Error de conexion', 'error');
            });
        },

        // =============================================
        //  LIST TAB
        // =============================================

        _loadRequestsList: function() {
            var self = this;
            if (!this._listEl) return;
            this._listEl.innerHTML = '';
            this._listItems = [];
            this._listData = [];
            this._listFocusIndex = 0;
            this._filterEls = [];
            this._filterFocusIndex = 0;

            // Show loading
            var loadingEl = document.createElement('div');
            loadingEl.className = 'requests-empty';
            loadingEl.textContent = 'Cargando...';
            this._listEl.appendChild(loadingEl);

            App.API.getRequests().then(function(data) {
                var requests = (data && data.requests) ? data.requests : [];
                self._allRequests = requests;
                self._listEl.innerHTML = '';

                if (requests.length === 0) {
                    var emptyEl = document.createElement('div');
                    emptyEl.className = 'requests-empty';
                    emptyEl.textContent = 'No hay peticiones';
                    self._listEl.appendChild(emptyEl);
                    return;
                }

                // Filter bar
                self._buildFilterBar();

                // Hint text
                if (self._isAdmin) {
                    var hint = document.createElement('div');
                    hint.className = 'requests-list-hint';
                    hint.textContent = 'OK = cambiar estado  |  ROJO = borrar';
                    self._listEl.appendChild(hint);
                }

                // Rows container
                var rowsContainer = document.createElement('div');
                rowsContainer.className = 'requests-rows-container';
                rowsContainer.id = 'requests-rows-container';
                self._listEl.appendChild(rowsContainer);

                self._renderFilteredList();

                self._activePanel = 'filters';
                if (self._filterEls.length > 0) {
                    self._updateFilterFocus(self._filterFocusIndex);
                }
            }).catch(function() {
                self._listEl.innerHTML = '';
                var errEl = document.createElement('div');
                errEl.className = 'requests-empty';
                errEl.textContent = 'Error al cargar peticiones';
                self._listEl.appendChild(errEl);
            });
        },

        _createListRow: function(request, index) {
            var self = this;
            var title = (request.title || 'Sin titulo');
            var year = request.year ? ' (' + request.year + ')' : '';
            var statusInfo = STATUS_MAP[request.status] || STATUS_MAP.pending;
            var posterSrc = request.poster || '';
            if (posterSrc && posterSrc.indexOf('http') !== 0) {
                posterSrc = App.Config.posterUrl(posterSrc);
            }

            var itemEl = document.createElement('div');
            itemEl.className = 'requests-list-item focusable';
            itemEl.setAttribute('data-index', index);

            var wrapper = document.createElement('div');
            wrapper.className = 'poster-wrapper';

            var img = document.createElement('img');
            img.className = 'poster-img';
            img.setAttribute('data-src', posterSrc || 'assets/placeholder.svg');
            img.alt = title;
            img.onload = function() { img.classList.add('loaded'); };
            wrapper.appendChild(img);

            // Status badge overlay
            var badgeEl = document.createElement('div');
            badgeEl.className = 'requests-list-badge';
            badgeEl.textContent = statusInfo.label;
            badgeEl.style.background = statusInfo.color;
            wrapper.appendChild(badgeEl);

            // Requested by overlay
            var byEl = document.createElement('div');
            byEl.className = 'requests-list-by';
            byEl.textContent = request.requestedBy || request.requested_by || '';
            wrapper.appendChild(byEl);

            itemEl.appendChild(wrapper);

            var titleDiv = document.createElement('div');
            titleDiv.className = 'poster-title';
            titleDiv.textContent = title + year;
            itemEl.appendChild(titleDiv);

            if (App.Images && App.Images.observe) {
                App.Images.observe(img);
            }

            // Click + hover handlers (Magic Remote)
            (function(idx, element) {
                element.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self._activePanel = 'list';
                    self._updateListFocus(idx);
                    if (self._isAdmin) self._showStatusMenu(idx);
                });
                element.addEventListener('mouseenter', function() {
                    self._activePanel = 'list';
                    self._updateListFocus(idx);
                    if (title) App._showHoverTooltip(title, element);
                });
                element.addEventListener('mouseleave', function() {
                    App._hideHoverTooltip();
                });
            })(index, itemEl);

            return itemEl;
        },

        // =============================================
        //  FILTERS
        // =============================================

        _buildFilterBar: function() {
            var self = this;
            if (!this._filterContainer) return;
            this._filterContainer.innerHTML = '';

            var filters = [{ key: 'all', label: 'Todas' }];
            for (var s = 0; s < STATUS_ORDER.length; s++) {
                filters.push({ key: STATUS_ORDER[s], label: STATUS_MAP[STATUS_ORDER[s]].label, color: STATUS_MAP[STATUS_ORDER[s]].color });
            }

            this._filterEls = [];
            for (var i = 0; i < filters.length; i++) {
                var f = filters[i];
                var btn = document.createElement('div');
                btn.className = 'requests-tab requests-filter-tab focusable';
                if (f.key === this._activeFilter) btn.classList.add('active');
                btn.setAttribute('data-filter', f.key);

                if (f.color) {
                    var dot = document.createElement('span');
                    dot.className = 'requests-filter-dot';
                    dot.style.background = f.color;
                    btn.appendChild(dot);
                }

                var label = document.createElement('span');
                label.textContent = f.label;
                btn.appendChild(label);

                // Count
                var count = 0;
                if (f.key === 'all') {
                    count = this._allRequests.length;
                } else {
                    for (var j = 0; j < this._allRequests.length; j++) {
                        if (this._allRequests[j].status === f.key) count++;
                    }
                }
                var countEl = document.createElement('span');
                countEl.className = 'requests-filter-count';
                countEl.textContent = count;
                btn.appendChild(countEl);

                this._filterContainer.appendChild(btn);
                this._filterEls.push(btn);

                // Click handler
                (function(key, idx) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        self._activePanel = 'filters';
                        self._filterFocusIndex = idx;
                        self._applyFilter(key);
                    });
                })(f.key, i);
            }
        },

        _applyFilter: function(filterKey) {
            this._activeFilter = filterKey;

            // Update active class on filter buttons
            for (var i = 0; i < this._filterEls.length; i++) {
                this._filterEls[i].classList.remove('active');
                if (this._filterEls[i].getAttribute('data-filter') === filterKey) {
                    this._filterEls[i].classList.add('active');
                }
            }

            this._renderFilteredList();
        },

        _renderFilteredList: function() {
            var container = document.getElementById('requests-rows-container');
            if (!container) return;
            container.innerHTML = '';
            this._listItems = [];
            this._listData = [];
            this._listFocusIndex = 0;

            var filtered = [];
            for (var i = 0; i < this._allRequests.length; i++) {
                if (this._activeFilter === 'all' || this._allRequests[i].status === this._activeFilter) {
                    filtered.push(this._allRequests[i]);
                }
            }

            if (filtered.length === 0) {
                var emptyEl = document.createElement('div');
                emptyEl.className = 'requests-empty';
                emptyEl.textContent = 'No hay peticiones con este estado';
                container.appendChild(emptyEl);
                return;
            }

            for (var j = 0; j < filtered.length; j++) {
                var row = this._createListRow(filtered[j], j);
                container.appendChild(row);
                this._listItems.push(row);
                this._listData.push(filtered[j]);
            }
        },

        _handleFiltersNav: function(key) {
            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (this._filterFocusIndex > 0) {
                        this._updateFilterFocus(this._filterFocusIndex - 1);
                    } else {
                        // Jump to tabs
                        this._clearFilterFocus();
                        this._activePanel = 'tabs';
                        this._updateTabFocus(this._tabEls.length - 1);
                    }
                    break;
                case App.Config.KEYS.RIGHT:
                    if (this._filterFocusIndex < this._filterEls.length - 1) this._updateFilterFocus(this._filterFocusIndex + 1);
                    break;
                case App.Config.KEYS.UP:
                    this._clearFilterFocus();
                    this._switchToNav();
                    break;
                case App.Config.KEYS.DOWN:
                    this._clearFilterFocus();
                    if (this._listItems.length > 0) {
                        this._activePanel = 'list';
                        this._updateListFocus(0);
                    }
                    break;
                case App.Config.KEYS.OK:
                    var filterKey = this._filterEls[this._filterFocusIndex].getAttribute('data-filter');
                    this._applyFilter(filterKey);
                    break;
            }
        },

        _updateFilterFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._filterEls.length) index = this._filterEls.length - 1;
            this._filterFocusIndex = index;
            for (var i = 0; i < this._filterEls.length; i++) {
                this._filterEls[i].classList.remove('focused');
            }
            this._filterEls[index].classList.add('focused');
        },

        _clearFilterFocus: function() {
            for (var i = 0; i < this._filterEls.length; i++) {
                this._filterEls[i].classList.remove('focused');
            }
        },

        // =============================================
        //  LIST NAVIGATION
        // =============================================

        _getListCols: function() {
            if (this._listItems.length < 2) return 1;
            // Use offsetTop — not affected by CSS transform: scale()
            var firstTop = this._listItems[0].offsetTop;
            for (var c = 1; c < this._listItems.length; c++) {
                if (this._listItems[c].offsetTop > firstTop + 5) {
                    return c;
                }
            }
            return this._listItems.length;
        },

        _handleListNav: function(key) {
            var idx = this._listFocusIndex;
            var total = this._listItems.length;
            var cols = this._getListCols();

            if (total === 0) {
                if (key === App.Config.KEYS.UP) {
                    this._activePanel = 'tabs';
                    this._updateTabFocus(this._tabFocusIndex);
                }
                return;
            }

            var col = idx % cols;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (col > 0) {
                        this._updateListFocus(idx - 1);
                    } else {
                        // At first column — go to filters or tabs
                        this._clearListFocus();
                        if (this._filterEls.length > 0) {
                            this._activePanel = 'filters';
                            this._updateFilterFocus(this._filterFocusIndex);
                        } else {
                            this._activePanel = 'tabs';
                            this._updateTabFocus(this._tabFocusIndex);
                        }
                    }
                    break;
                case App.Config.KEYS.RIGHT:
                    if (col < cols - 1 && idx + 1 < total) {
                        this._updateListFocus(idx + 1);
                    }
                    break;
                case App.Config.KEYS.UP:
                    if (idx - cols >= 0) {
                        this._updateListFocus(idx - cols);
                    } else {
                        // First row — go to filters or tabs
                        this._clearListFocus();
                        if (this._filterEls.length > 0) {
                            this._activePanel = 'filters';
                            this._updateFilterFocus(this._filterFocusIndex);
                        } else {
                            this._activePanel = 'tabs';
                            this._updateTabFocus(this._tabFocusIndex);
                        }
                    }
                    break;
                case App.Config.KEYS.DOWN:
                    if (idx + cols < total) {
                        this._updateListFocus(idx + cols);
                    } else if (idx < total - 1) {
                        // Last full row but partial row below — snap to last item
                        this._updateListFocus(total - 1);
                    }
                    break;
                case App.Config.KEYS.OK:
                    if (this._isAdmin) {
                        this._showStatusMenu(idx);
                    }
                    break;
                case App.Config.KEYS.RED:
                    if (this._isAdmin) {
                        this._deleteRequest(idx);
                    }
                    break;
            }
        },

        _updateListFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._listItems.length) index = this._listItems.length - 1;
            this._listFocusIndex = index;
            for (var i = 0; i < this._listItems.length; i++) {
                this._listItems[i].classList.remove('focused');
            }
            var el = this._listItems[index];
            el.classList.add('focused');
            var rect = el.getBoundingClientRect();
            var parentRect = this._listEl.getBoundingClientRect();
            if (rect.bottom > parentRect.bottom || rect.top < parentRect.top) {
                el.scrollIntoView({ block: 'nearest' });
            }
        },

        _clearListFocus: function() {
            for (var i = 0; i < this._listItems.length; i++) {
                this._listItems[i].classList.remove('focused');
            }
        },

        // =============================================
        //  STATUS MENU (Admin)
        // =============================================

        _showStatusMenu: function(listIndex) {
            if (!this._isAdmin) return;
            var self = this;
            var request = this._listData[listIndex];
            if (!request) return;

            this._hideStatusMenu();
            this._statusMenuRequestId = request.id;
            this._statusMenuFocusIndex = 0;

            var menuEl = document.createElement('div');
            menuEl.className = 'requests-status-menu';

            var menuTitle = document.createElement('div');
            menuTitle.className = 'requests-status-menu-title';
            menuTitle.textContent = 'Cambiar estado';
            menuEl.appendChild(menuTitle);

            this._statusMenuItems = [];
            for (var i = 0; i < STATUS_ORDER.length; i++) {
                var status = STATUS_ORDER[i];
                var info = STATUS_MAP[status];
                var optEl = document.createElement('div');
                optEl.className = 'requests-status-option focusable';
                if (status === request.status) {
                    optEl.classList.add('current');
                }
                optEl.setAttribute('data-status', status);

                var dot = document.createElement('span');
                dot.className = 'requests-status-dot';
                dot.style.background = info.color;
                optEl.appendChild(dot);

                var label = document.createElement('span');
                label.textContent = info.label;
                optEl.appendChild(label);

                menuEl.appendChild(optEl);
                this._statusMenuItems.push(optEl);

                // Click handler
                (function(s, idx) {
                    optEl.addEventListener('click', function(e) {
                        e.stopPropagation();
                        self._selectStatus(s);
                    });
                })(status, i);
            }

            this._container.appendChild(menuEl);
            this._statusMenuEl = menuEl;
            this._activePanel = 'statusMenu';
            this._updateStatusMenuFocus(0);
        },

        _hideStatusMenu: function() {
            if (this._statusMenuEl && this._statusMenuEl.parentNode) {
                this._statusMenuEl.parentNode.removeChild(this._statusMenuEl);
            }
            this._statusMenuEl = null;
            this._statusMenuItems = [];
            this._statusMenuRequestId = null;
        },

        _handleStatusMenuNav: function(key) {
            var idx = this._statusMenuFocusIndex;
            var total = this._statusMenuItems.length;

            switch (key) {
                case App.Config.KEYS.UP:
                    if (idx > 0) this._updateStatusMenuFocus(idx - 1);
                    break;
                case App.Config.KEYS.DOWN:
                    if (idx + 1 < total) this._updateStatusMenuFocus(idx + 1);
                    break;
                case App.Config.KEYS.OK:
                    var status = this._statusMenuItems[idx].getAttribute('data-status');
                    this._selectStatus(status);
                    break;
                case App.Config.KEYS.BACK:
                case App.Config.KEYS.LEFT:
                    this._hideStatusMenu();
                    this._activePanel = 'list';
                    this._updateListFocus(this._listFocusIndex);
                    break;
            }
        },

        _updateStatusMenuFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._statusMenuItems.length) index = this._statusMenuItems.length - 1;
            this._statusMenuFocusIndex = index;
            for (var i = 0; i < this._statusMenuItems.length; i++) {
                this._statusMenuItems[i].classList.remove('focused');
            }
            this._statusMenuItems[index].classList.add('focused');
        },

        _selectStatus: function(status) {
            var self = this;
            var id = this._statusMenuRequestId;
            if (!id) return;

            App.API.updateRequestStatus(id, status).then(function(data) {
                if (data && data.success) {
                    self._showToast('Estado actualizado', 'success');
                    self._hideStatusMenu();
                    self._activePanel = 'list';
                    self._loadRequestsList();
                } else {
                    self._showToast('Error al actualizar', 'error');
                }
            }).catch(function() {
                self._showToast('Error de conexion', 'error');
            });
        },

        _deleteRequest: function(listIndex) {
            var self = this;
            var request = this._listData[listIndex];
            if (!request) return;

            App.API.deleteRequest(request.id).then(function() {
                self._showToast('Peticion eliminada', 'success');
                self._loadRequestsList();
            }).catch(function() {
                self._showToast('Error al eliminar', 'error');
            });
        },

        // =============================================
        //  TOAST
        // =============================================

        _showToast: function(message, type) {
            if (this._toastTimer) clearTimeout(this._toastTimer);

            var existing = document.querySelector('.toast');
            if (existing) existing.parentNode.removeChild(existing);

            var toast = document.createElement('div');
            toast.className = 'toast toast-' + (type || 'info');
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(function() { toast.classList.add('visible'); }, 10);

            this._toastTimer = setTimeout(function() {
                toast.classList.remove('visible');
                setTimeout(function() {
                    if (toast.parentNode) toast.parentNode.removeChild(toast);
                }, 300);
            }, 3000);
        },

        // =============================================
        //  CLEAR ALL FOCUS
        // =============================================

        _clearAllFocus: function() {
            this._clearKeyboardFocus();
            this._clearResultsFocus();
            this._clearTabFocus();
            this._clearNavFocus();
            this._clearFilterFocus();
            this._clearListFocus();
            if (this._submitBtn) this._submitBtn.classList.remove('focused');
        }
    };
})();
