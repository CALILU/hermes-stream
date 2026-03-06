/**
 * IsiPrime webOS App - Actor Filmography View
 * Shows actor photo, name, and a grid of their movies.
 * Movies available on the server are highlighted; others are dimmed.
 * D-pad grid navigation (same pattern as search results).
 *
 * Chromium ~87 compatible (no optional chaining, no nullish coalescing).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    var GRID_COLS_DEFAULT = 7;

    /**
     * Helper: if url is already absolute (http), return as-is.
     * Otherwise treat as TMDB path and build via posterUrl.
     */
    function resolveImg(url, size) {
        if (!url) return App.Config.PLACEHOLDER_IMG;
        if (url.indexOf('http') === 0) return url;
        return App.Config.posterUrl(url, size);
    }

    App.Actor = {
        _container: null,
        _gridItems: [],
        _gridData: [],       // { title, poster, year, rating, overview, tmdbId, localMovie }
        _focusIndex: 0,
        _keyHandler: null,

        /**
         * Show the actor filmography view.
         * @param {Object} data - { name: string, photo: string }
         */
        show: function(data) {
            console.log('[Actor] show:', data.name);
            this._container = document.getElementById('actor-view');
            if (!this._container) {
                console.error('[Actor] #actor-view not found in DOM');
                return;
            }
            this._container.style.display = '';
            this._container.innerHTML = '';
            this._gridItems = [];
            this._gridData = [];
            this._focusIndex = 0;

            // Show loading state
            this._container.innerHTML =
                '<div class="actor-loading">' +
                    '<div class="loading-spinner"></div>' +
                    '<div class="actor-loading-text">Cargando filmograf\u00eda...</div>' +
                '</div>';

            var self = this;
            App.API.getActorFilmography(data.name).then(function(result) {
                console.log('[Actor] API response:', result ? (result.movies ? result.movies.length + ' movies' : 'no movies') : 'null');
                if (!result || !result.movies) {
                    self._showEmpty(data);
                    return;
                }
                self._render(data, result);
            }).catch(function(err) {
                console.error('[Actor] Error loading filmography:', err);
                self._showEmpty(data);
            });

            this._setupKeyHandler();
        },

        /**
         * Render filmography grid — only movies available on the server.
         */
        _render: function(data, result) {
            this._container.innerHTML = '';
            var actor = result.actor || {};
            var movies = result.movies || [];
            var localVideos = App._videos || [];

            // Filter: only movies available on the server
            var availableMovies = [];
            for (var i = 0; i < movies.length; i++) {
                var m = movies[i];
                var localMovie = this._findLocalMovie(m.title, m.tmdbId, localVideos);
                if (localMovie) {
                    availableMovies.push({ movie: m, local: localMovie });
                }
            }

            console.log('[Actor] Total from TMDB:', movies.length, '| Available locally:', availableMovies.length);

            // If no local movies, show empty state
            if (availableMovies.length === 0) {
                this._showEmpty(data);
                return;
            }

            // Header
            var header = document.createElement('div');
            header.className = 'actor-header';

            var photoEl = document.createElement('img');
            photoEl.className = 'actor-header-photo';
            photoEl.src = resolveImg(data.photo || actor.photo);
            photoEl.alt = data.name;
            header.appendChild(photoEl);

            var infoDiv = document.createElement('div');
            infoDiv.className = 'actor-header-info';

            var nameEl = document.createElement('h1');
            nameEl.className = 'actor-header-name';
            nameEl.textContent = data.name;
            infoDiv.appendChild(nameEl);

            var countEl = document.createElement('div');
            countEl.className = 'actor-header-count';
            countEl.textContent = availableMovies.length + ' pel\u00edcula' + (availableMovies.length !== 1 ? 's' : '') + ' disponible' + (availableMovies.length !== 1 ? 's' : '');
            infoDiv.appendChild(countEl);

            header.appendChild(infoDiv);
            this._container.appendChild(header);

            // Grid
            var grid = document.createElement('div');
            grid.className = 'actor-grid';
            this._gridEl = grid;

            for (var j = 0; j < availableMovies.length; j++) {
                var entry = availableMovies[j];

                this._gridData.push({
                    title: entry.movie.title,
                    poster: entry.movie.poster,
                    year: entry.movie.year,
                    rating: entry.movie.rating,
                    overview: entry.movie.overview,
                    tmdbId: entry.movie.tmdbId,
                    localMovie: entry.local
                });

                var item = this._createGridItem(entry.movie, entry.local, j);
                grid.appendChild(item);
                this._gridItems.push(item);
            }

            this._container.appendChild(grid);

            // Set initial focus
            if (this._gridItems.length > 0) {
                this._updateFocus(0);
            }
        },

        /**
         * Find a movie in local catalog by title or tmdbId.
         */
        _findLocalMovie: function(title, tmdbId, localVideos) {
            var normalizedTitle = (title || '').toLowerCase().trim();

            for (var i = 0; i < localVideos.length; i++) {
                var v = localVideos[i];

                // Match by tmdbId first
                if (tmdbId && v.tmdbId && String(v.tmdbId) === String(tmdbId)) {
                    return v;
                }

                // Match by title
                var localTitle = (v.title || '').toLowerCase().trim();
                if (localTitle && localTitle === normalizedTitle) {
                    return v;
                }
            }

            return null;
        },

        /**
         * Create a single grid item.
         */
        _createGridItem: function(movie, localMovie, index) {
            var item = document.createElement('div');
            item.className = 'actor-grid-item';
            item.setAttribute('data-index', index);

            var wrapper = document.createElement('div');
            wrapper.className = 'poster-wrapper';

            var img = document.createElement('img');
            img.className = 'poster-img';

            // poster from API is already a full URL — use resolveImg
            img.setAttribute('data-src', resolveImg(movie.poster));
            img.alt = movie.title || '';
            img.onload = function() { img.classList.add('loaded'); };

            wrapper.appendChild(img);

            // Year badge
            if (movie.year) {
                var yearBadge = document.createElement('div');
                yearBadge.className = 'poster-year';
                yearBadge.textContent = movie.year;
                wrapper.appendChild(yearBadge);
            }

            // Rating badge
            if (movie.rating) {
                var ratingBadge = document.createElement('div');
                ratingBadge.className = 'poster-badge';
                ratingBadge.textContent = '\u2605 ' + (typeof movie.rating === 'number' ? movie.rating.toFixed(1) : movie.rating);
                wrapper.appendChild(ratingBadge);
            }

            item.appendChild(wrapper);

            var titleDiv = document.createElement('div');
            titleDiv.className = 'poster-title';
            titleDiv.textContent = movie.title || '';
            item.appendChild(titleDiv);

            // Lazy load
            if (App.Images && App.Images.observe) {
                App.Images.observe(img);
            }

            // Click + hover handlers for Magic Remote
            var self = this;
            (function(idx, el, title) {
                el.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self._updateFocus(idx);
                    self._onSelect(idx);
                });
                el.addEventListener('mouseenter', function() {
                    self._updateFocus(idx);
                    if (title) App._showHoverTooltip(title, el);
                });
                el.addEventListener('mouseleave', function() {
                    App._hideHoverTooltip();
                });
            })(index, item, movie.title || '');

            return item;
        },

        /**
         * Show empty/error state.
         */
        _showEmpty: function(data) {
            this._container.innerHTML =
                '<div class="actor-header">' +
                    '<img class="actor-header-photo" src="' + resolveImg(data.photo) + '" alt="">' +
                    '<div class="actor-header-info">' +
                        '<h1 class="actor-header-name">' + (data.name || '') + '</h1>' +
                        '<div class="actor-header-count">No hay pel\u00edculas disponibles en el servidor</div>' +
                    '</div>' +
                '</div>';
        },

        /**
         * Update focus on grid item.
         */
        _updateFocus: function(index) {
            if (index < 0) index = 0;
            if (index >= this._gridItems.length) index = this._gridItems.length - 1;

            for (var i = 0; i < this._gridItems.length; i++) {
                this._gridItems[i].classList.remove('focused');
            }

            this._focusIndex = index;
            var el = this._gridItems[index];
            el.classList.add('focused');

            // Scroll into view
            var rect = el.getBoundingClientRect();
            var parentRect = this._container.getBoundingClientRect();
            if (rect.bottom > parentRect.bottom - 20) {
                el.scrollIntoView({ block: 'nearest' });
            } else if (rect.top < parentRect.top + 120) {
                el.scrollIntoView({ block: 'nearest' });
            }
        },

        /**
         * Handle selecting a grid item.
         */
        _onSelect: function(index) {
            if (index < 0 || index >= this._gridData.length) return;
            var data = this._gridData[index];

            if (data.localMovie) {
                App.Router.navigate('DETAIL', data.localMovie);
            }
            // No-op for unavailable movies
        },

        /**
         * Setup key handler.
         */
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
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    App.Router.back();
                    return;
                }

                e.preventDefault();
                e.stopImmediatePropagation();

                self._handleGridNav(key);
            };

            document.addEventListener('keydown', this._keyHandler, true);
        },

        /**
         * Handle grid navigation.
         */
        _handleGridNav: function(key) {
            var idx = this._focusIndex;
            var total = this._gridItems.length;

            if (total === 0) return;

            // Calculate columns from grid container width and item width (200px + 24px gap)
            var cols = GRID_COLS_DEFAULT;
            if (this._gridEl) {
                cols = Math.floor(this._gridEl.clientWidth / 224) || GRID_COLS_DEFAULT;
            }
            if (cols > total) cols = total;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (idx > 0) {
                        this._updateFocus(idx - 1);
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (idx + 1 < total) {
                        this._updateFocus(idx + 1);
                    }
                    break;

                case App.Config.KEYS.UP:
                    if (idx - cols >= 0) {
                        this._updateFocus(idx - cols);
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx + cols < total) {
                        this._updateFocus(idx + cols);
                    }
                    break;

                case App.Config.KEYS.OK:
                    this._onSelect(idx);
                    break;
            }
        },

        /**
         * Hide and clean up.
         */
        hide: function() {
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler, true);
                this._keyHandler = null;
            }

            if (this._container) {
                this._container.style.display = 'none';
                this._container.innerHTML = '';
            }

            if (App.Focus && App.Focus.enable) {
                App.Focus.enable();
            }

            if (App.Images && App.Images.clearQueue) {
                App.Images.clearQueue();
            }

            this._gridItems = [];
            this._gridData = [];
            this._gridEl = null;
            this._focusIndex = 0;
        }
    };
})();
