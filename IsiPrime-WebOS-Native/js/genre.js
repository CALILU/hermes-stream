/**
 * IsiPrime webOS App - Genre Browse View
 * Sidebar with genre list + grid of movie posters.
 * D-pad navigation, Magic Remote hover/click support.
 *
 * Chromium ~87 compatible (no optional chaining, no nullish coalescing).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Genre = {
        _container: null,       // #genre-view element
        _sidebarEl: null,       // sidebar container
        _genreListEl: null,     // genre list UL
        _gridEl: null,          // movie grid container
        _contentEl: null,       // right panel (.genre-content)
        _contentTitleEl: null,  // genre title above grid
        _genreElements: [],     // genre list DOM items
        _movieElements: [],     // movie poster DOM items
        _movieData: [],         // movies currently shown in grid
        _activePanel: 'genres', // 'genres', 'grid', or 'nav'
        _prevPanel: 'genres',   // panel before switching to nav (for DOWN return)
        _genreFocusIndex: 0,
        _gridFocusIndex: 0,
        _selectedGenreId: null, // null = "Todas"
        _keyHandler: null,
        _allGenres: [],         // [{id, name, count}] sorted
        _navItems: [],
        _navFocusIndex: 0,

        // =============================================
        //  SHOW / HIDE
        // =============================================

        show: function(data, isBack) {
            // Save state before rebuilding (properties persist across hide/show)
            var savedGenreId = this._selectedGenreId;
            var savedGenreFocus = this._genreFocusIndex;
            var savedGridFocus = this._gridFocusIndex;

            this._container = document.getElementById('genre-view');
            this._container.style.display = '';
            this._container.innerHTML = '';

            // Cache nav items
            var navEls = document.querySelectorAll('#nav-bar .nav-item');
            this._navItems = [];
            for (var i = 0; i < navEls.length; i++) {
                this._navItems.push(navEls[i]);
            }

            // Build sorted genre list with counts (only genres that have movies)
            this._buildGenreData();

            // Build UI
            this._buildUI();

            // Setup key handler
            this._setupKeyHandler();

            if (isBack) {
                // Restore previous selection and grid position
                this._selectGenre(savedGenreId);
                this._genreFocusIndex = savedGenreFocus;
                this._activePanel = 'grid';
                this._gridFocusIndex = savedGridFocus;
                if (savedGridFocus >= 0 && savedGridFocus < this._movieElements.length) {
                    this._updateGridFocus(savedGridFocus);
                } else {
                    this._updateGridFocus(0);
                }
            } else {
                // Fresh start: select "Todas", focus sidebar
                this._selectGenre(null);
                this._activePanel = 'genres';
                this._genreFocusIndex = 0;
                this._updateGenreFocus(0);
            }
        },

        hide: function() {
            if (this._container) {
                this._container.style.display = 'none';
                this._container.innerHTML = '';
            }
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler, true);
                this._keyHandler = null;
            }
            if (App.Focus && App.Focus.enable) {
                App.Focus.enable();
            }
            if (App.Images && App.Images.clearQueue) {
                App.Images.clearQueue();
            }
            this._genreElements = [];
            this._movieElements = [];
            this._movieData = [];
            this._allGenres = [];
            this._navItems = [];
            this._sidebarEl = null;
            this._genreListEl = null;
            this._gridEl = null;
            this._contentEl = null;
            this._contentTitleEl = null;
        },

        // =============================================
        //  DATA
        // =============================================

        _buildGenreData: function() {
            var videos = App._videos || [];
            var genreCountMap = {};  // { genreId: count }

            for (var i = 0; i < videos.length; i++) {
                var ids = videos[i].genreIds;
                if (ids && ids.length) {
                    for (var j = 0; j < ids.length; j++) {
                        var gid = ids[j];
                        if (!genreCountMap[gid]) {
                            genreCountMap[gid] = 0;
                        }
                        genreCountMap[gid]++;
                    }
                }
            }

            var genres = App._genres || [];
            this._allGenres = [];

            for (var g = 0; g < genres.length; g++) {
                var count = genreCountMap[genres[g].id] || 0;
                if (count > 0) {
                    this._allGenres.push({
                        id: genres[g].id,
                        name: genres[g].name,
                        count: count
                    });
                }
            }

            // Sort alphabetically by name
            this._allGenres.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });
        },

        // =============================================
        //  BUILD UI
        // =============================================

        _buildUI: function() {
            // Sidebar
            this._sidebarEl = document.createElement('div');
            this._sidebarEl.className = 'genre-sidebar';

            var sidebarTitle = document.createElement('div');
            sidebarTitle.className = 'genre-sidebar-title';
            sidebarTitle.textContent = 'G\u00e9neros';
            this._sidebarEl.appendChild(sidebarTitle);

            this._genreListEl = document.createElement('div');
            this._genreListEl.className = 'genre-list';
            this._sidebarEl.appendChild(this._genreListEl);

            // Right panel
            this._contentEl = document.createElement('div');
            this._contentEl.className = 'genre-content';

            this._contentTitleEl = document.createElement('div');
            this._contentTitleEl.className = 'genre-content-title';
            this._contentTitleEl.textContent = 'Todas las pel\u00edculas';
            this._contentEl.appendChild(this._contentTitleEl);

            this._gridEl = document.createElement('div');
            this._gridEl.className = 'genre-grid';
            this._contentEl.appendChild(this._gridEl);

            this._container.appendChild(this._sidebarEl);
            this._container.appendChild(this._contentEl);

            // Build genre list items
            this._buildGenreList();
        },

        _buildGenreList: function() {
            var self = this;
            this._genreElements = [];
            this._genreListEl.innerHTML = '';

            var totalMovies = (App._videos || []).length;

            // "Todas" item first
            var allItem = document.createElement('div');
            allItem.className = 'genre-list-item focusable active';
            allItem.setAttribute('data-genre-id', '');

            var allName = document.createElement('span');
            allName.className = 'genre-name';
            allName.textContent = 'Todas';
            allItem.appendChild(allName);

            var allCount = document.createElement('span');
            allCount.className = 'genre-count';
            allCount.textContent = totalMovies;
            allItem.appendChild(allCount);

            this._genreListEl.appendChild(allItem);
            this._genreElements.push(allItem);

            // Click + hover for Magic Remote
            (function(idx, el) {
                el.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self._activePanel = 'genres';
                    self._genreFocusIndex = idx;
                    self._clearGridFocus();
                    self._updateGenreFocus(idx);
                    self._selectGenre(null);
                });
                el.addEventListener('mouseenter', function() {
                    self._activePanel = 'genres';
                    self._clearGridFocus();
                    self._updateGenreFocus(idx);
                });
            })(0, allItem);

            // Genre items
            for (var i = 0; i < this._allGenres.length; i++) {
                var genre = this._allGenres[i];
                var item = document.createElement('div');
                item.className = 'genre-list-item focusable';
                item.setAttribute('data-genre-id', genre.id);

                var nameSpan = document.createElement('span');
                nameSpan.className = 'genre-name';
                nameSpan.textContent = genre.name;
                item.appendChild(nameSpan);

                var countSpan = document.createElement('span');
                countSpan.className = 'genre-count';
                countSpan.textContent = genre.count;
                item.appendChild(countSpan);

                this._genreListEl.appendChild(item);
                this._genreElements.push(item);

                (function(idx, el, gid) {
                    el.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._activePanel = 'genres';
                        self._genreFocusIndex = idx;
                        self._clearGridFocus();
                        self._updateGenreFocus(idx);
                        self._selectGenre(gid);
                    });
                    el.addEventListener('mouseenter', function() {
                        self._activePanel = 'genres';
                        self._clearGridFocus();
                        self._updateGenreFocus(idx);
                    });
                })(i + 1, item, genre.id);
            }
        },

        // =============================================
        //  GENRE SELECTION & GRID
        // =============================================

        _selectGenre: function(genreId) {
            this._selectedGenreId = genreId;
            var videos = App._videos || [];
            var filtered;

            if (genreId === null || genreId === undefined) {
                // "Todas" - show all
                filtered = videos.slice();
            } else {
                // Filter by genreId (check ALL genreIds of each movie)
                filtered = [];
                for (var i = 0; i < videos.length; i++) {
                    var ids = videos[i].genreIds;
                    if (ids && ids.length) {
                        for (var j = 0; j < ids.length; j++) {
                            if (ids[j] === genreId) {
                                filtered.push(videos[i]);
                                break;
                            }
                        }
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

            // Update active state on genre list
            for (var g = 0; g < this._genreElements.length; g++) {
                this._genreElements[g].classList.remove('active');
            }
            // Find and activate the selected genre
            if (genreId === null || genreId === undefined) {
                if (this._genreElements.length > 0) {
                    this._genreElements[0].classList.add('active');
                }
            } else {
                for (var k = 0; k < this._genreElements.length; k++) {
                    var elGenreId = this._genreElements[k].getAttribute('data-genre-id');
                    if (elGenreId === String(genreId)) {
                        this._genreElements[k].classList.add('active');
                        break;
                    }
                }
            }

            // Update content title
            if (genreId === null || genreId === undefined) {
                this._contentTitleEl.textContent = 'Todas las pel\u00edculas (' + filtered.length + ')';
            } else {
                var genreName = App.getGenreName(genreId) || 'G\u00e9nero';
                this._contentTitleEl.textContent = genreName + ' (' + filtered.length + ')';
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

                // Use lazy loading with posterUrl helper
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
                        self._onMovieSelect(mov);
                    });
                    el.addEventListener('mouseenter', function() {
                        self._activePanel = 'grid';
                        self._clearGenreFocus();
                        self._updateGridFocus(idx);
                        // Show tooltip
                        if (mov.title && App._showHoverTooltip) {
                            App._showHoverTooltip(mov.title, el);
                        }
                    });
                })(i, item, movie);
            }
        },

        // =============================================
        //  GRID COLUMNS
        // =============================================

        _getGridCols: function() {
            if (this._movieElements.length < 2) return 1;
            // Use offsetTop instead of getBoundingClientRect — not affected by
            // CSS transform: scale() on the focused element
            var firstTop = this._movieElements[0].offsetTop;
            for (var c = 1; c < this._movieElements.length; c++) {
                if (this._movieElements[c].offsetTop > firstTop + 5) {
                    return c;
                }
            }
            return this._movieElements.length;
        },

        // =============================================
        //  FOCUS MANAGEMENT
        // =============================================

        _updateGenreFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._genreElements.length) index = this._genreElements.length - 1;
            this._genreFocusIndex = index;

            for (var i = 0; i < this._genreElements.length; i++) {
                this._genreElements[i].classList.remove('focused');
            }
            if (this._genreElements[index]) {
                this._genreElements[index].classList.add('focused');
                this._ensureVisible(this._genreElements[index], this._sidebarEl);
            }
        },

        _clearGenreFocus: function() {
            for (var i = 0; i < this._genreElements.length; i++) {
                this._genreElements[i].classList.remove('focused');
            }
        },

        _updateGridFocus: function(index) {
            if (this._movieElements.length === 0) return;
            if (index < 0) index = 0;
            if (index >= this._movieElements.length) index = this._movieElements.length - 1;
            this._gridFocusIndex = index;

            for (var i = 0; i < this._movieElements.length; i++) {
                this._movieElements[i].classList.remove('focused');
            }
            if (this._movieElements[index]) {
                this._movieElements[index].classList.add('focused');
                this._ensureVisible(this._movieElements[index], this._contentEl);
            }
        },

        _clearGridFocus: function() {
            for (var i = 0; i < this._movieElements.length; i++) {
                this._movieElements[i].classList.remove('focused');
            }
        },

        _clearAllFocus: function() {
            this._clearGenreFocus();
            this._clearGridFocus();
            this._clearNavFocus();
        },

        // =============================================
        //  NAV PANEL
        // =============================================

        _switchToNav: function() {
            // Remember which panel we came from so DOWN returns there
            this._prevPanel = this._activePanel;
            this._activePanel = 'nav';
            this._clearAllFocus();

            this._navFocusIndex = 0;
            for (var i = 0; i < this._navItems.length; i++) {
                if (this._navItems[i].getAttribute('data-view') === 'genres') {
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
                    // Return to the panel user was in before going to nav
                    if (this._prevPanel === 'grid' && this._movieElements.length > 0) {
                        this._activePanel = 'grid';
                        this._updateGridFocus(this._gridFocusIndex);
                    } else {
                        this._activePanel = 'genres';
                        this._updateGenreFocus(this._genreFocusIndex);
                    }
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

                // Let BACK propagate to router
                if (key === App.Config.KEYS.BACK) {
                    return;
                }

                e.preventDefault();
                e.stopImmediatePropagation();

                switch (self._activePanel) {
                    case 'nav':
                        self._handleNavNav(key);
                        break;
                    case 'genres':
                        self._handleGenresNav(key);
                        break;
                    case 'grid':
                        self._handleGridNav(key);
                        break;
                }
            };

            document.addEventListener('keydown', this._keyHandler, true);
        },

        // =============================================
        //  GENRES PANEL NAVIGATION
        // =============================================

        _handleGenresNav: function(key) {
            var idx = this._genreFocusIndex;
            var total = this._genreElements.length;

            switch (key) {
                case App.Config.KEYS.UP:
                    if (idx > 0) {
                        this._updateGenreFocus(idx - 1);
                    } else {
                        // Go to nav bar
                        this._clearGenreFocus();
                        this._switchToNav();
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx < total - 1) {
                        this._updateGenreFocus(idx + 1);
                    }
                    break;

                case App.Config.KEYS.LEFT:
                    // Go to nav bar from sidebar
                    this._clearGenreFocus();
                    this._switchToNav();
                    break;

                case App.Config.KEYS.RIGHT:
                case App.Config.KEYS.OK:
                    // Get target genre ID
                    var targetGenreId = null;
                    if (idx > 0 && this._allGenres[idx - 1]) {
                        targetGenreId = this._allGenres[idx - 1].id;
                    }
                    var sameGenre = (targetGenreId === this._selectedGenreId);
                    // Only rebuild grid if genre changed
                    if (!sameGenre) {
                        this._selectCurrentGenre();
                    }
                    // Move focus to grid
                    if (this._movieElements.length > 0) {
                        this._activePanel = 'grid';
                        this._clearGenreFocus();
                        // Restore previous grid position if same genre, else start at 0
                        this._updateGridFocus(sameGenre ? this._gridFocusIndex : 0);
                    }
                    break;
            }
        },

        _selectCurrentGenre: function() {
            var idx = this._genreFocusIndex;
            if (idx === 0) {
                // "Todas"
                this._selectGenre(null);
            } else {
                var genre = this._allGenres[idx - 1];
                if (genre) {
                    this._selectGenre(genre.id);
                }
            }
        },

        // =============================================
        //  GRID PANEL NAVIGATION
        // =============================================

        _handleGridNav: function(key) {
            var idx = this._gridFocusIndex;
            var total = this._movieElements.length;

            if (total === 0) {
                if (key === App.Config.KEYS.LEFT || key === App.Config.KEYS.UP) {
                    this._activePanel = 'genres';
                    this._updateGenreFocus(this._genreFocusIndex);
                }
                return;
            }

            var cols = this._getGridCols();
            var col = idx % cols;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (col > 0) {
                        this._updateGridFocus(idx - 1);
                    } else {
                        // At column 0, return to genre list
                        this._clearGridFocus();
                        this._activePanel = 'genres';
                        this._updateGenreFocus(this._genreFocusIndex);
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (col < cols - 1 && idx + 1 < total) {
                        this._updateGridFocus(idx + 1);
                    }
                    break;

                case App.Config.KEYS.UP:
                    if (idx - cols >= 0) {
                        this._updateGridFocus(idx - cols);
                    } else {
                        // At top row, go to nav bar
                        this._clearGridFocus();
                        this._switchToNav();
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx + cols < total) {
                        this._updateGridFocus(idx + cols);
                    } else if (idx < total - 1) {
                        // At last full row but partial row below — snap to last item
                        this._updateGridFocus(total - 1);
                    }
                    break;

                case App.Config.KEYS.OK:
                    if (this._movieData[idx]) {
                        this._onMovieSelect(this._movieData[idx]);
                    }
                    break;
            }
        },

        // =============================================
        //  MOVIE SELECT
        // =============================================

        _onMovieSelect: function(movie) {
            App.Router.navigate('DETAIL', movie);
        },

        // =============================================
        //  SCROLL HELPERS
        // =============================================

        _ensureVisible: function(el, container) {
            if (!el || !container) return;

            var elRect = el.getBoundingClientRect();
            var containerRect = container.getBoundingClientRect();
            var margin = 40; // extra margin so item isn't right at the edge

            // Check if element is above container viewport
            if (elRect.top < containerRect.top + margin) {
                var scrollUp = containerRect.top + margin - elRect.top;
                container.scrollTop = Math.max(0, container.scrollTop - scrollUp);
            }

            // Check if element is below container viewport
            if (elRect.bottom > containerRect.bottom - margin) {
                var scrollDown = elRect.bottom - containerRect.bottom + margin;
                container.scrollTop += scrollDown;
            }
        }
    };
})();
