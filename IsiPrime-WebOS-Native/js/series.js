/**
 * IsiPrime webOS App - Series Detail View
 * Shows series header with backdrop, season tabs, and episode list.
 * D-pad navigation: LEFT/RIGHT on season tabs, UP/DOWN on episode list.
 *
 * Chromium ~87 compatible (no optional chaining, no nullish coalescing).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Series = {
        _container: null,       // #series-view element
        _series: null,          // current series data
        _currentSeason: 1,      // active season number
        _seasons: {},           // cached season data { 1: { episodes: [...] }, 2: {...} }
        _episodeElements: [],   // DOM elements for episode list focus
        _tabElements: [],       // DOM elements for season tabs focus
        _keyHandler: null,      // custom key handler for inter-group navigation
        _loading: false,        // loading lock

        /**
         * Show the series detail view.
         * @param {Object} series - Series data object from API.
         */
        show: function(series) {
            this._series = series;
            this._container = document.getElementById('series-view');
            this._container.style.display = '';
            this._container.innerHTML = '';
            this._seasons = {};
            this._currentSeason = 1;
            this._episodeElements = [];
            this._tabElements = [];
            this._loading = false;

            var numberOfSeasons = series.number_of_seasons || 1;

            // --- Header ---
            var header = document.createElement('div');
            header.className = 'series-header';

            var backdropPath = series.backdrop_path || series.backdrop || null;
            if (backdropPath) {
                var backdrop = document.createElement('img');
                backdrop.className = 'series-backdrop';
                backdrop.src = App.Config.backdropUrl(backdropPath);
                backdrop.alt = '';
                header.appendChild(backdrop);
            }

            var gradient = document.createElement('div');
            gradient.className = 'series-header-gradient';
            header.appendChild(gradient);

            var headerInfo = document.createElement('div');
            headerInfo.className = 'series-header-info';

            var title = document.createElement('h1');
            title.className = 'series-title';
            title.textContent = series.name || series.title || series.folder_name || '';
            headerInfo.appendChild(title);

            // Meta line: year, seasons, rating, overview
            var meta = document.createElement('div');
            meta.className = 'series-meta';
            var metaParts = [];

            var firstAirDate = series.first_air_date || '';
            if (firstAirDate) {
                metaParts.push(firstAirDate.substring(0, 4));
            }

            metaParts.push(numberOfSeasons + (numberOfSeasons === 1 ? ' temporada' : ' temporadas'));

            var rating = series.vote_average || 0;
            if (rating > 0) {
                metaParts.push('\u2605 ' + (typeof rating === 'number' ? rating.toFixed(1) : rating));
            }

            meta.textContent = metaParts.join(' \u00B7 ');
            headerInfo.appendChild(meta);

            // Overview (truncated)
            var overview = series.overview || '';
            if (overview) {
                var overviewEl = document.createElement('div');
                overviewEl.className = 'series-overview';
                overviewEl.textContent = overview.length > 300 ? overview.substring(0, 300) + '...' : overview;
                headerInfo.appendChild(overviewEl);
            }

            header.appendChild(headerInfo);
            this._container.appendChild(header);

            // --- Season Tabs ---
            var tabsContainer = document.createElement('div');
            tabsContainer.className = 'season-tabs';
            tabsContainer.id = 'season-tabs';

            this._tabElements = [];
            for (var s = 1; s <= numberOfSeasons; s++) {
                var tab = document.createElement('div');
                tab.className = 'season-tab focusable';
                if (s === 1) tab.classList.add('active');
                tab.setAttribute('data-season', s);
                tab.textContent = 'Temporada ' + s;
                tabsContainer.appendChild(tab);
                this._tabElements.push(tab);
            }

            this._container.appendChild(tabsContainer);

            // --- Episode List Container ---
            var episodeList = document.createElement('div');
            episodeList.className = 'episode-list';
            episodeList.id = 'episode-list';
            this._container.appendChild(episodeList);

            // --- Register focus groups ---
            var self = this;

            App.Focus.registerGroup('season-tabs', this._tabElements, {
                orientation: 'horizontal',
                loop: false,
                onFocus: function(el) {
                    // Visual highlight is handled by .focused class via Focus module
                },
                onSelect: function(el) {
                    var seasonNum = parseInt(el.getAttribute('data-season'), 10);
                    if (seasonNum && seasonNum !== self._currentSeason && !self._loading) {
                        self._loadSeason(seasonNum);
                    }
                }
            });

            // --- Setup custom key handler for navigation between groups ---
            this._setupKeyHandler();

            // --- Load first season ---
            this._loadSeason(1);

            // Focus on first season tab
            App.Focus.setActiveGroup('season-tabs', 0);
        },

        /**
         * Setup custom key handler for navigating between season-tabs and episode-list.
         * Since focus.js does not natively support vertical group switching
         * between our two groups (they are registered as separate groups
         * but the home-style row navigation is specific to Home view),
         * we handle it manually here.
         */
        _setupKeyHandler: function() {
            var self = this;

            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
            }

            this._keyHandler = function(e) {
                if (!self._container || self._container.style.display === 'none') return;

                var currentGroup = App.Focus.getCurrentGroup();
                var key = e.keyCode;

                // DOWN from season-tabs -> move to episode list
                if (key === App.Config.KEYS.DOWN && currentGroup === 'season-tabs') {
                    if (self._episodeElements.length > 0) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        App.Focus.setActiveGroup('episode-list', 0);
                    }
                    return;
                }

                // UP from episode-list when at first item -> move to season tabs
                if (key === App.Config.KEYS.UP && currentGroup === 'episode-list') {
                    var idx = App.Focus.getCurrentIndex();
                    if (idx === 0) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        // Restore focus to the active season tab
                        var activeTabIdx = self._currentSeason - 1;
                        App.Focus.setActiveGroup('season-tabs', activeTabIdx);
                    }
                    return;
                }

                // UP from season-tabs -> go to nav bar
                if (key === App.Config.KEYS.UP && currentGroup === 'season-tabs') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    App.Focus.setActiveGroup('nav');
                    return;
                }
            };

            document.addEventListener('keydown', this._keyHandler);
        },

        /**
         * Load a season's episodes (from cache or API).
         * @param {number} seasonNum - Season number to load.
         */
        _loadSeason: function(seasonNum) {
            var self = this;
            this._currentSeason = seasonNum;
            this._loading = true;

            // Update active tab visual
            for (var i = 0; i < this._tabElements.length; i++) {
                var tabSeason = parseInt(this._tabElements[i].getAttribute('data-season'), 10);
                if (tabSeason === seasonNum) {
                    this._tabElements[i].classList.add('active');
                } else {
                    this._tabElements[i].classList.remove('active');
                }
            }

            // Show loading in episode list
            var listEl = document.getElementById('episode-list');
            if (listEl) {
                listEl.innerHTML = '<div class="episode-loading">Cargando episodios...</div>';
            }

            // Check cache
            if (this._seasons[seasonNum]) {
                this._renderEpisodes(this._seasons[seasonNum]);
                this._loading = false;
                return;
            }

            // Fetch from API
            var tmdbId = this._series.tmdb_id;
            if (!tmdbId) {
                // Fallback: try folder-based endpoint
                this._loadSeasonByFolder(seasonNum);
                return;
            }

            App.API.getSeasonEpisodes(tmdbId, seasonNum).then(function(data) {
                self._seasons[seasonNum] = data;
                // Only render if this is still the selected season
                if (self._currentSeason === seasonNum) {
                    self._renderEpisodes(data);
                }
                self._loading = false;
            }).catch(function(err) {
                console.error('Error loading season ' + seasonNum + ':', err);
                if (self._currentSeason === seasonNum) {
                    var el = document.getElementById('episode-list');
                    if (el) {
                        el.innerHTML = '<div class="episode-loading">Error al cargar episodios</div>';
                    }
                }
                self._loading = false;
            });
        },

        /**
         * Fallback: load season by folder name (for non-enriched series).
         */
        _loadSeasonByFolder: function(seasonNum) {
            var self = this;
            var folderName = this._series.folder_name || this._series.name || '';

            App.API._fetch('/api/series/folder/' + encodeURIComponent(folderName) + '/season/' + seasonNum)
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    self._seasons[seasonNum] = data;
                    if (self._currentSeason === seasonNum) {
                        self._renderEpisodes(data);
                    }
                    self._loading = false;
                })
                .catch(function(err) {
                    console.error('Error loading season by folder:', err);
                    self._loading = false;
                });
        },

        /**
         * Render the episode list for a season.
         * @param {Object} seasonData - Season data with episodes array.
         */
        _renderEpisodes: function(seasonData) {
            var listEl = document.getElementById('episode-list');
            if (!listEl) return;

            listEl.innerHTML = '';
            this._episodeElements = [];

            var episodes = (seasonData && seasonData.episodes) ? seasonData.episodes : [];

            if (episodes.length === 0) {
                listEl.innerHTML = '<div class="episode-loading">No hay episodios disponibles</div>';
                App.Focus.unregisterGroup('episode-list');
                return;
            }

            var self = this;

            for (var i = 0; i < episodes.length; i++) {
                var ep = episodes[i];
                var item = this._createEpisodeItem(ep, i);
                listEl.appendChild(item);
                this._episodeElements.push(item);
            }

            // Register (or re-register) episode list focus group
            App.Focus.unregisterGroup('episode-list');

            App.Focus.registerGroup('episode-list', this._episodeElements, {
                orientation: 'vertical',
                onFocus: function(el) {
                    // Scroll into view is handled by focus.js _scrollIntoView
                },
                onSelect: function(el, index) {
                    var ep = episodes[index];
                    if (!ep) return;

                    // Determine the file to stream
                    var fileName = ep.filename || ep.file_path || null;
                    if (!fileName) {
                        // Episode not available on disk
                        return;
                    }

                    var folderName = self._series.folder_name || self._series.name || '';

                    // Pass bare filename — backend searches season subdirectories automatically
                    var epNum = ep.episode_number || (index + 1);
                    var seasonNum = self._currentSeason;

                    App.Router.navigate('PLAYER', {
                        url: App.API.streamSeriesUrl(folderName, fileName),
                        title: (self._series.name || self._series.title || folderName) +
                            ' - S' + self._padZero(seasonNum) +
                            'E' + self._padZero(epNum) +
                            (ep.name ? ' - ' + ep.name : ''),
                        videoPath: 'series/' + folderName + '/' + fileName,
                        startPosition: 0,
                        duration: ((ep.runtime || 45) * 60)
                    });
                }
            });
        },

        /**
         * Create a single episode item DOM element.
         * @param {Object} ep - Episode data.
         * @param {number} index - Index in the list.
         * @returns {HTMLElement}
         */
        _createEpisodeItem: function(ep, index) {
            var item = document.createElement('div');
            item.className = 'episode-item focusable';
            item.setAttribute('data-index', index);

            // Check if episode is available on disk
            var isAvailable = ep.available !== false && (ep.filename || ep.file_path);
            if (!isAvailable) {
                item.classList.add('episode-unavailable');
            }

            // Still image
            var still = document.createElement('img');
            still.className = 'episode-still';
            var stillUrl = ep.still || ep.still_path || null;
            if (stillUrl) {
                // ep.still is already a full URL from the backend
                // ep.still_path is a relative TMDB path (needs posterUrl)
                var imgSrc = ep.still ? stillUrl : App.Config.posterUrl(stillUrl, 'w300');
                still.setAttribute('data-src', imgSrc);
                still.alt = ep.name || '';
                App.Images.observe(still);
            } else {
                still.src = 'assets/placeholder.svg';
                still.alt = '';
            }
            item.appendChild(still);

            // Episode info container
            var info = document.createElement('div');
            info.className = 'episode-info';

            // Episode number
            var numEl = document.createElement('div');
            numEl.className = 'episode-number';
            numEl.textContent = 'Episodio ' + (ep.episode_number || (index + 1));
            info.appendChild(numEl);

            // Episode name
            var nameEl = document.createElement('div');
            nameEl.className = 'episode-name';
            nameEl.textContent = ep.name || 'Episodio ' + (ep.episode_number || (index + 1));
            info.appendChild(nameEl);

            // Overview (truncated)
            var overview = ep.overview || '';
            if (overview) {
                var overviewEl = document.createElement('div');
                overviewEl.className = 'episode-overview-text';
                overviewEl.textContent = overview.length > 150 ? overview.substring(0, 150) + '...' : overview;
                info.appendChild(overviewEl);
            }

            // Duration and air date
            var durationParts = [];
            if (ep.runtime) {
                durationParts.push(ep.runtime + ' min');
            }
            if (ep.air_date) {
                durationParts.push(ep.air_date);
            }
            if (durationParts.length > 0) {
                var durationEl = document.createElement('div');
                durationEl.className = 'episode-duration';
                durationEl.textContent = durationParts.join(' \u00B7 ');
                info.appendChild(durationEl);
            }

            item.appendChild(info);

            // Watched badge
            if (ep.watched) {
                var badge = document.createElement('span');
                badge.className = 'episode-watched-badge';
                badge.textContent = 'Visto';
                item.appendChild(badge);
            }

            // Unavailable indicator
            if (!isAvailable) {
                var unavailBadge = document.createElement('span');
                unavailBadge.className = 'episode-unavailable-badge';
                unavailBadge.textContent = 'No disponible';
                item.appendChild(unavailBadge);
            }

            return item;
        },

        /**
         * Pad a number to 2 digits.
         * @param {number} n
         * @returns {string}
         */
        _padZero: function(n) {
            return n < 10 ? '0' + n : '' + n;
        },

        /**
         * Hide the series view and clean up.
         */
        hide: function() {
            if (this._container) {
                this._container.style.display = 'none';
                this._container.innerHTML = '';
            }

            // Remove custom key handler
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
                this._keyHandler = null;
            }

            // Unregister focus groups
            App.Focus.unregisterGroup('season-tabs');
            App.Focus.unregisterGroup('episode-list');

            // Clear cached data
            this._seasons = {};
            this._episodeElements = [];
            this._tabElements = [];
            this._series = null;
            this._loading = false;

            // Clear image queue
            if (App.Images && App.Images.clearQueue) {
                App.Images.clearQueue();
            }
        }
    };
})();
