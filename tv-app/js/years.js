/**
 * IsiPrime webOS App - Years Browse View
 * Sidebar with year list + grid of movie posters.
 * D-pad navigation, Magic Remote hover/click support.
 *
 * Cloned from genre.js — filters by release year instead of genre.
 * Chromium ~87 compatible (no optional chaining, no nullish coalescing).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Years = {
        _container: null,       // #years-view element
        _sidebarEl: null,       // sidebar container
        _yearListEl: null,      // year list container
        _gridEl: null,          // movie grid container
        _contentEl: null,       // right panel
        _contentTitleEl: null,  // title above grid
        _yearElements: [],      // year list DOM items
        _movieElements: [],     // movie poster DOM items
        _movieData: [],         // movies currently shown in grid
        _activePanel: 'years',  // 'years', 'grid', or 'nav'
        _prevPanel: 'years',    // panel before switching to nav (for DOWN return)
        _yearFocusIndex: 0,
        _gridFocusIndex: 0,
        _selectedYear: null,    // null = "Todas"
        _keyHandler: null,
        _allYears: [],          // [{year, count}] sorted descending
        _navItems: [],
        _navFocusIndex: 0,
        _autoSelectTimer: null,

        // =============================================
        //  SHOW / HIDE
        // =============================================

        show: function(data, isBack) {
            // Save state before rebuilding (properties persist across hide/show)
            var savedYear = this._selectedYear;
            var savedYearFocus = this._yearFocusIndex;
            var savedGridFocus = this._gridFocusIndex;

            this._container = document.getElementById('years-view');
            this._container.style.display = '';
            this._container.innerHTML = '';

            // Cache nav items
            App.NavBar.initItems(this);

            // Build sorted year list with counts
            this._buildYearData();

            // Build UI
            this._buildUI();

            // Setup key handler
            this._setupKeyHandler();

            if (isBack) {
                // Restore previous selection and grid position
                this._selectYear(savedYear);
                this._yearFocusIndex = savedYearFocus;
                this._activePanel = 'grid';
                this._gridFocusIndex = savedGridFocus;
                if (savedGridFocus >= 0 && savedGridFocus < this._movieElements.length) {
                    this._updateGridFocus(savedGridFocus);
                } else {
                    this._updateGridFocus(0);
                }
            } else {
                // Fresh start: select "Todas", focus sidebar
                this._selectYear(null);
                this._activePanel = 'years';
                this._yearFocusIndex = 0;
                this._updateYearFocus(0);
            }
        },

        hide: function() {
            App.SidebarGridView.hide(this);
            this._yearElements = [];
            this._movieElements = [];
            this._movieData = [];
            this._allYears = [];
            this._navItems = [];
            this._sidebarEl = null;
            this._yearListEl = null;
            this._gridEl = null;
            this._contentEl = null;
            this._contentTitleEl = null;
        },

        // =============================================
        //  DATA
        // =============================================

        _buildYearData: function() {
            var videos = App._videos || [];
            var yearCountMap = {};  // { year: count }

            for (var i = 0; i < videos.length; i++) {
                var rd = videos[i].releaseDate;
                var year = (rd && rd.length >= 4) ? rd.substring(0, 4) : null;
                var key = year || 'sin-fecha';
                if (!yearCountMap[key]) {
                    yearCountMap[key] = 0;
                }
                yearCountMap[key]++;
            }

            this._allYears = [];

            var keys = Object.keys(yearCountMap);
            for (var k = 0; k < keys.length; k++) {
                var y = keys[k];
                this._allYears.push({
                    year: y,
                    name: y === 'sin-fecha' ? 'Sin fecha' : y,
                    count: yearCountMap[y]
                });
            }

            // Sort descending by year (newest first), "sin-fecha" at the end
            this._allYears.sort(function(a, b) {
                if (a.year === 'sin-fecha') return 1;
                if (b.year === 'sin-fecha') return -1;
                return b.year.localeCompare(a.year);
            });
        },

        // =============================================
        //  BUILD UI
        // =============================================

        _buildUI: function() {
            var layout = App.SidebarGridView.buildLayout(
                this._container, 'A\u00f1os', 'Todas las pel\u00edculas');
            this._sidebarEl = layout.sidebarEl;
            this._yearListEl = layout.listEl;
            this._contentEl = layout.contentEl;
            this._contentTitleEl = layout.contentTitleEl;
            this._gridEl = layout.gridEl;
            this._buildYearList();
        },

        _buildYearList: function() {
            var self = this;
            this._yearElements = [];
            this._yearListEl.innerHTML = '';

            var totalMovies = (App._videos || []).length;

            // "Todas" item first
            var allItem = document.createElement('div');
            allItem.className = 'genre-list-item focusable active';
            allItem.setAttribute('data-year', '');

            var allName = document.createElement('span');
            allName.className = 'genre-name';
            allName.textContent = 'Todas';
            allItem.appendChild(allName);

            var allCount = document.createElement('span');
            allCount.className = 'genre-count';
            allCount.textContent = totalMovies;
            allItem.appendChild(allCount);

            this._yearListEl.appendChild(allItem);
            this._yearElements.push(allItem);

            // Click + hover for Magic Remote
            (function(idx, el) {
                el.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self._activePanel = 'years';
                    self._yearFocusIndex = idx;
                    self._clearGridFocus();
                    self._updateYearFocus(idx);
                    self._selectYear(null);
                });
                el.addEventListener('mouseenter', function() {
                    self._activePanel = 'years';
                    self._clearGridFocus();
                    self._updateYearFocus(idx);
                });
            })(0, allItem);

            // Year items
            for (var i = 0; i < this._allYears.length; i++) {
                var yearObj = this._allYears[i];
                var item = document.createElement('div');
                item.className = 'genre-list-item focusable';
                item.setAttribute('data-year', yearObj.year);

                var nameSpan = document.createElement('span');
                nameSpan.className = 'genre-name';
                nameSpan.textContent = yearObj.name;
                item.appendChild(nameSpan);

                var countSpan = document.createElement('span');
                countSpan.className = 'genre-count';
                countSpan.textContent = yearObj.count;
                item.appendChild(countSpan);

                this._yearListEl.appendChild(item);
                this._yearElements.push(item);

                (function(idx, el, yr) {
                    el.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._activePanel = 'years';
                        self._yearFocusIndex = idx;
                        self._clearGridFocus();
                        self._updateYearFocus(idx);
                        self._selectYear(yr);
                    });
                    el.addEventListener('mouseenter', function() {
                        self._activePanel = 'years';
                        self._clearGridFocus();
                        self._updateYearFocus(idx);
                    });
                })(i + 1, item, yearObj.year);
            }
        },

        // =============================================
        //  YEAR SELECTION & GRID
        // =============================================

        _selectYear: function(year) {
            this._selectedYear = year;
            var videos = App._videos || [];
            var filtered;

            if (year === null || year === undefined) {
                // "Todas" - show all
                filtered = videos.slice();
            } else if (year === 'sin-fecha') {
                // Movies without releaseDate
                filtered = [];
                for (var i = 0; i < videos.length; i++) {
                    var rd = videos[i].releaseDate;
                    if (!rd || rd.length < 4) {
                        filtered.push(videos[i]);
                    }
                }
            } else {
                // Filter by year
                filtered = [];
                for (var j = 0; j < videos.length; j++) {
                    var rd2 = videos[j].releaseDate;
                    if (rd2 && rd2.substring(0, 4) === year) {
                        filtered.push(videos[j]);
                    }
                }
            }

            // Sort alphabetically by title
            filtered.sort(function(a, b) {
                var ta = (a.title || '').toLowerCase();
                var tb = (b.title || '').toLowerCase();
                if (ta < tb) return -1;
                if (ta > tb) return 1;
                return 0;
            });

            // Update active state on year list
            for (var g = 0; g < this._yearElements.length; g++) {
                this._yearElements[g].classList.remove('active');
            }
            if (year === null || year === undefined) {
                if (this._yearElements.length > 0) {
                    this._yearElements[0].classList.add('active');
                }
            } else {
                for (var k = 0; k < this._yearElements.length; k++) {
                    if (this._yearElements[k].getAttribute('data-year') === year) {
                        this._yearElements[k].classList.add('active');
                        break;
                    }
                }
            }

            // Update content title
            if (year === null || year === undefined) {
                this._contentTitleEl.textContent = 'Todas las pel\u00edculas (' + filtered.length + ')';
            } else {
                var displayName = year === 'sin-fecha' ? 'Sin fecha' : year;
                this._contentTitleEl.textContent = displayName + ' (' + filtered.length + ')';
            }

            // Build grid
            this._buildMovieGrid(filtered);

            // Reset grid focus
            this._gridFocusIndex = 0;

            // Scroll content to top
            if (this._contentEl) {
                this._contentEl.scrollTop = 0;
            }
        },

        _buildMovieGrid: function(movies) {
            var self = this;
            this._gridEl.innerHTML = '';
            this._movieElements = [];
            this._movieData = movies;

            for (var i = 0; i < movies.length; i++) {
                var movie = movies[i];

                var item = document.createElement('div');
                item.className = 'genre-movie-item focusable';

                var posterWrapper = document.createElement('div');
                posterWrapper.className = 'poster-wrapper';

                var img = document.createElement('img');
                img.className = 'poster-img';
                img.alt = movie.title || '';

                img.setAttribute('data-src', App.Config.posterUrl(movie.poster));
                if (App.Images && App.Images.observe) {
                    App.Images.observe(img);
                }

                posterWrapper.appendChild(img);
                item.appendChild(posterWrapper);

                var title = document.createElement('div');
                title.className = 'poster-title';
                title.textContent = movie.title || '';
                item.appendChild(title);

                this._gridEl.appendChild(item);
                this._movieElements.push(item);

                // Click + hover for Magic Remote
                (function(idx, el, mov) {
                    el.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        App.Router.navigate('DETAIL', mov);
                    });
                    el.addEventListener('mouseenter', function() {
                        self._activePanel = 'grid';
                        self._clearYearFocus();
                        self._updateGridFocus(idx);
                        if (mov.title && App._showHoverTooltip) {
                            App._showHoverTooltip(mov.title, el);
                        }
                    });
                })(i, item, movie);
            }
        },

        // =============================================
        //  FOCUS MANAGEMENT (delegates to SidebarGridView)
        // =============================================

        _updateYearFocus: function(index) {
            this._yearFocusIndex = App.SidebarGridView.updateFocus(
                this._yearElements, index, this._sidebarEl);
        },

        _clearYearFocus: function() {
            App.SidebarGridView.clearFocus(this._yearElements);
        },

        _updateGridFocus: function(index) {
            this._gridFocusIndex = App.SidebarGridView.updateFocus(
                this._movieElements, index, this._contentEl);
        },

        _clearGridFocus: function() {
            App.SidebarGridView.clearFocus(this._movieElements);
        },

        _clearAllFocus: function() {
            this._clearYearFocus();
            this._clearGridFocus();
            App.NavBar.clearFocus(this);
        },

        // =============================================
        //  NAV PANEL
        // =============================================

        _switchToNav: function() {
            this._prevPanel = this._activePanel;
            this._clearAllFocus();
            App.NavBar.switchTo(this, 'years');
        },

        _handleNavNav: function(key) {
            var self = this;
            App.NavBar.handleKey(this, key, function() {
                if (self._prevPanel === 'grid' && self._movieElements.length > 0) {
                    self._activePanel = 'grid';
                    self._updateGridFocus(self._gridFocusIndex);
                } else {
                    self._activePanel = 'years';
                    self._updateYearFocus(self._yearFocusIndex);
                }
            });
        },

        // =============================================
        //  KEY HANDLER
        // =============================================

        _setupKeyHandler: function() {
            var self = this;
            App.SidebarGridView.setupKeyHandler(this, {
                nav: function(key) { self._handleNavNav(key); },
                years: function(key) { self._handleYearsNav(key); },
                grid: function(key) { self._handleGridNav(key); }
            });
        },

        // =============================================
        //  YEARS PANEL NAVIGATION
        // =============================================

        _handleYearsNav: function(key) {
            var idx = this._yearFocusIndex;
            var total = this._yearElements.length;

            switch (key) {
                case App.Config.KEYS.UP:
                    if (idx > 0) {
                        this._updateYearFocus(idx - 1);
                        this._autoSelectYear();
                    } else {
                        this._clearYearFocus();
                        this._switchToNav();
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx < total - 1) {
                        this._updateYearFocus(idx + 1);
                        this._autoSelectYear();
                    }
                    break;

                case App.Config.KEYS.LEFT:
                    this._clearYearFocus();
                    this._switchToNav();
                    break;

                case App.Config.KEYS.RIGHT:
                case App.Config.KEYS.OK:
                    if (this._autoSelectTimer) { clearTimeout(this._autoSelectTimer); this._autoSelectTimer = null; }
                    this._selectCurrentYear();
                    if (this._movieElements.length > 0) {
                        this._activePanel = 'grid';
                        this._clearYearFocus();
                        this._updateGridFocus(0);
                    }
                    break;
            }
        },

        _autoSelectYear: function() {
            var self = this;
            if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
            this._autoSelectTimer = setTimeout(function() {
                self._selectCurrentYear();
            }, 300);
        },

        _selectCurrentYear: function() {
            var idx = this._yearFocusIndex;
            if (idx === 0) {
                this._selectYear(null);
            } else {
                var yearObj = this._allYears[idx - 1];
                if (yearObj) this._selectYear(yearObj.year);
            }
        },

        // =============================================
        //  GRID PANEL NAVIGATION
        // =============================================

        _handleGridNav: function(key) {
            var self = this;
            App.SidebarGridView.handleGridNav(this, key, {
                sidebarPanel: 'years',
                onSidebarRestore: function() { self._updateYearFocus(self._yearFocusIndex); },
                onNav: function() { self._switchToNav(); },
                onOK: function(idx) {
                    if (self._movieData[idx]) App.Router.navigate('DETAIL', self._movieData[idx]);
                }
            });
        }
    };
})();
