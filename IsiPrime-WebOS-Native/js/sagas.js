/**
 * IsiPrime webOS App - Sagas Browse View
 * Sidebar with saga/collection list + grid of movie posters.
 * Movies not in local catalog shown in grayscale, clickable to send as request.
 * D-pad navigation, Magic Remote hover/click support.
 *
 * Chromium ~53 compatible (no optional chaining, no nullish coalescing).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Sagas = {
        _container: null,
        _sidebarEl: null,
        _sagaListEl: null,
        _gridEl: null,
        _contentEl: null,
        _contentTitleEl: null,
        _sagaElements: [],
        _movieElements: [],
        _movieData: [],
        _activePanel: 'sagas',
        _prevPanel: 'sagas',
        _sagaFocusIndex: 0,
        _gridFocusIndex: 0,
        _selectedSagaId: null,
        _keyHandler: null,
        _allSagas: [],
        _navItems: [],
        _navFocusIndex: 0,
        _existingRequestIds: {},
        _toastTimer: null,
        _loadingEl: null,
        _sagaTooltipEl: null,
        _sagaTooltipTimer: null,
        _autoSelectTimer: null,

        // =============================================
        //  SHOW / HIDE
        // =============================================

        show: function(data, isBack) {
            var self = this;
            var savedSagaId = this._selectedSagaId;
            var savedSagaFocus = this._sagaFocusIndex;
            var savedGridFocus = this._gridFocusIndex;

            this._container = document.getElementById('sagas-view');
            this._container.style.display = '';
            this._container.innerHTML = '';

            // Cache nav items
            App.NavBar.initItems(this);

            // Build UI skeleton
            this._buildUI();

            // Setup key handler
            this._setupKeyHandler();

            // Load data from API
            this._showGridLoading('Cargando sagas...');

            // Load collections + existing requests in parallel
            Promise.all([
                App.API.getCollections(),
                App.API.getRequests()
            ]).then(function(results) {
                var collections = results[0] || [];
                var requests = results[1] || {};

                // Build existing request IDs map
                self._existingRequestIds = {};
                var reqList = requests.requests || requests || [];
                if (Array.isArray(reqList)) {
                    for (var r = 0; r < reqList.length; r++) {
                        if (reqList[r].tmdbId) {
                            self._existingRequestIds[reqList[r].tmdbId] = reqList[r].id || true;
                        }
                    }
                }

                // Sort collections by name
                self._allSagas = [];
                for (var c = 0; c < collections.length; c++) {
                    var coll = collections[c];
                    self._allSagas.push({
                        id: coll.id,
                        name: coll.name,
                        count: coll.movies ? coll.movies.length : 0,
                        poster: coll.poster || null
                    });
                }
                self._allSagas.sort(function(a, b) {
                    return a.name.localeCompare(b.name, 'es');
                });

                // Build sidebar
                self._buildSagaList();

                if (isBack && savedSagaId) {
                    // Restore previous selection
                    self._selectSaga(savedSagaId);
                    self._sagaFocusIndex = savedSagaFocus;
                    self._activePanel = 'grid';
                    self._gridFocusIndex = savedGridFocus;
                    // Focus will be set after grid loads
                } else if (self._allSagas.length > 0) {
                    // Select first saga
                    self._activePanel = 'sagas';
                    self._sagaFocusIndex = 0;
                    self._updateSagaFocus(0);
                    self._selectSaga(self._allSagas[0].id);
                } else {
                    self._showGridLoading('No hay sagas disponibles');
                }
            }).catch(function(err) {
                console.error('Error loading sagas:', err);
                self._showGridLoading('Error al cargar sagas');
            });
        },

        hide: function() {
            App.SidebarGridView.hide(this);
            this._sagaElements = [];
            this._movieElements = [];
            this._movieData = [];
            this._allSagas = [];
            this._navItems = [];
            this._sidebarEl = null;
            this._sagaListEl = null;
            this._gridEl = null;
            this._contentEl = null;
            this._contentTitleEl = null;
            this._loadingEl = null;
            if (this._sagaTooltipTimer) {
                clearTimeout(this._sagaTooltipTimer);
                this._sagaTooltipTimer = null;
            }
            if (this._toastTimer) {
                clearTimeout(this._toastTimer);
                this._toastTimer = null;
            }
            var existingToast = document.querySelector('.toast');
            if (existingToast && existingToast.parentNode) {
                existingToast.parentNode.removeChild(existingToast);
            }
            this._sagaTooltipEl = null;
        },

        // =============================================
        //  BUILD UI
        // =============================================

        _buildUI: function() {
            var layout = App.SidebarGridView.buildLayout(this._container, 'Sagas');
            this._sidebarEl = layout.sidebarEl;
            this._sagaListEl = layout.listEl;
            this._contentEl = layout.contentEl;
            this._contentTitleEl = layout.contentTitleEl;
            this._gridEl = layout.gridEl;

            // Saga-specific: name tooltip (large floating label)
            this._sagaTooltipEl = document.createElement('div');
            this._sagaTooltipEl.className = 'saga-name-tooltip';
            this._sagaTooltipEl.style.display = 'none';
            this._container.appendChild(this._sagaTooltipEl);
        },

        _showSagaTooltip: function(text, targetEl) {
            if (!this._sagaTooltipEl) return;
            this._sagaTooltipEl.textContent = text;
            this._sagaTooltipEl.style.display = 'block';

            // Position to the right of sidebar, vertically aligned with the item
            var rect = targetEl.getBoundingClientRect();
            var containerRect = this._container.getBoundingClientRect();
            this._sagaTooltipEl.style.top = (rect.top - containerRect.top + rect.height / 2) + 'px';
            this._sagaTooltipEl.style.left = '310px'; // just past the 300px sidebar

            if (this._sagaTooltipTimer) clearTimeout(this._sagaTooltipTimer);
            var self = this;
            this._sagaTooltipTimer = setTimeout(function() {
                self._hideSagaTooltip();
            }, 3000);
        },

        _hideSagaTooltip: function() {
            if (this._sagaTooltipTimer) {
                clearTimeout(this._sagaTooltipTimer);
                this._sagaTooltipTimer = null;
            }
            if (this._sagaTooltipEl) {
                this._sagaTooltipEl.style.display = 'none';
            }
        },

        _buildSagaList: function() {
            var self = this;
            this._sagaElements = [];
            this._sagaListEl.innerHTML = '';

            for (var i = 0; i < this._allSagas.length; i++) {
                var saga = this._allSagas[i];
                var item = document.createElement('div');
                item.className = 'genre-list-item focusable';
                item.setAttribute('data-saga-id', saga.id);

                var nameSpan = document.createElement('span');
                nameSpan.className = 'genre-name';
                nameSpan.textContent = saga.name;
                item.appendChild(nameSpan);

                var countSpan = document.createElement('span');
                countSpan.className = 'genre-count';
                countSpan.textContent = saga.count;
                item.appendChild(countSpan);

                this._sagaListEl.appendChild(item);
                this._sagaElements.push(item);

                (function(idx, el, sid) {
                    el.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._activePanel = 'sagas';
                        self._sagaFocusIndex = idx;
                        self._clearGridFocus();
                        self._updateSagaFocus(idx);
                        self._selectSaga(sid);
                    });
                    el.addEventListener('mouseenter', function() {
                        self._activePanel = 'sagas';
                        self._clearGridFocus();
                        self._updateSagaFocus(idx);
                        self._showSagaTooltip(self._allSagas[idx].name, el);
                    });
                    el.addEventListener('mouseleave', function() {
                        self._hideSagaTooltip();
                    });
                })(i, item, saga.id);
            }

            // Mark first as active
            if (this._sagaElements.length > 0) {
                this._sagaElements[0].classList.add('active');
            }
        },

        // =============================================
        //  SAGA SELECTION & GRID
        // =============================================

        _selectSaga: function(sagaId) {
            var self = this;
            this._selectedSagaId = sagaId;

            // Update active state on sidebar
            for (var g = 0; g < this._sagaElements.length; g++) {
                this._sagaElements[g].classList.remove('active');
                if (this._sagaElements[g].getAttribute('data-saga-id') === String(sagaId)) {
                    this._sagaElements[g].classList.add('active');
                }
            }

            // Show loading
            this._showGridLoading('Cargando...');

            // Fetch full collection from TMDB
            App.API.getCollectionFull(sagaId).then(function(data) {
                if (!data || data.error) {
                    self._showGridLoading('Error al cargar saga');
                    return;
                }

                self._contentTitleEl.textContent = data.name + ' (' + data.totalParts + ' peliculas, ' + data.localParts + ' en catalogo)';
                self._buildMovieGrid(data.parts || []);

                // Reset grid focus
                self._gridFocusIndex = 0;
                if (self._contentEl) {
                    self._contentEl.scrollTop = 0;
                }

                // If returning from back, restore grid focus
                if (self._activePanel === 'grid' && self._movieElements.length > 0) {
                    var idx = self._gridFocusIndex;
                    if (idx >= self._movieElements.length) idx = 0;
                    self._updateGridFocus(idx);
                }
            }).catch(function(err) {
                console.error('Error loading saga:', err);
                self._showGridLoading('Error de conexion');
            });
        },

        _showGridLoading: function(text) {
            this._gridEl.innerHTML = '';
            this._movieElements = [];
            this._movieData = [];

            this._loadingEl = document.createElement('div');
            this._loadingEl.className = 'saga-loading';
            this._loadingEl.textContent = text;
            this._gridEl.appendChild(this._loadingEl);
        },

        _buildMovieGrid: function(parts) {
            var self = this;
            this._gridEl.innerHTML = '';
            this._movieElements = [];
            this._movieData = parts;

            for (var i = 0; i < parts.length; i++) {
                var movie = parts[i];

                var item = document.createElement('div');
                item.className = 'genre-movie-item focusable';
                if (!movie.inCatalog) {
                    item.className += ' saga-unavailable';
                }

                var posterWrapper = document.createElement('div');
                posterWrapper.className = 'poster-wrapper';

                var img = document.createElement('img');
                img.className = 'poster-img';
                img.alt = movie.title || '';

                if (movie.poster) {
                    img.setAttribute('data-src', App.Config.posterUrl(movie.poster));
                    if (App.Images && App.Images.observe) {
                        App.Images.observe(img);
                    }
                }

                posterWrapper.appendChild(img);

                // "Pedida" badge for already-requested non-local movies
                if (!movie.inCatalog && self._existingRequestIds[movie.tmdbId]) {
                    var badge = document.createElement('div');
                    badge.className = 'saga-badge-requested';
                    badge.textContent = 'Pedida';
                    posterWrapper.appendChild(badge);
                }

                item.appendChild(posterWrapper);

                // Title
                var title = document.createElement('div');
                title.className = 'poster-title';
                title.textContent = movie.title || '';
                item.appendChild(title);

                // Year
                var yearEl = document.createElement('div');
                yearEl.className = 'saga-year';
                yearEl.textContent = movie.year || '';
                item.appendChild(yearEl);

                this._gridEl.appendChild(item);
                this._movieElements.push(item);

                // Click + hover for Magic Remote
                (function(idx, el, mov) {
                    el.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._onMovieSelect(idx, mov);
                    });
                    el.addEventListener('mouseenter', function() {
                        self._activePanel = 'grid';
                        self._clearSagaFocus();
                        self._updateGridFocus(idx);
                        if (mov.title && App._showHoverTooltip) {
                            var label = mov.title;
                            if (mov.year) label += ' (' + mov.year + ')';
                            if (!mov.inCatalog) label += ' - No disponible';
                            App._showHoverTooltip(label, el);
                        }
                    });
                })(i, item, movie);
            }
        },

        // =============================================
        //  MOVIE SELECT
        // =============================================

        _onMovieSelect: function(index, movie) {
            if (movie.inCatalog) {
                // Find in App._videos by tmdbId and navigate to DETAIL
                var videos = App._videos || [];
                var found = null;
                for (var i = 0; i < videos.length; i++) {
                    if (videos[i].tmdbId === movie.tmdbId) {
                        found = videos[i];
                        break;
                    }
                }
                if (found) {
                    App.Router.navigate('DETAIL', found);
                } else {
                    this._showToast('Pelicula no encontrada en catalogo', 'error');
                }
            } else {
                // Submit as request
                this._submitRequest(index, movie);
            }
        },

        _submitRequest: function(index, movie) {
            var self = this;

            // If already requested, cancel/delete it
            if (this._existingRequestIds[movie.tmdbId]) {
                var requestId = this._existingRequestIds[movie.tmdbId];
                App.API.deleteRequest(requestId).then(function(data) {
                    if (data && data.success) {
                        delete self._existingRequestIds[movie.tmdbId];
                        self._showToast(movie.title + ' peticion cancelada', 'info');

                        // Remove "Pedida" badge
                        if (self._movieElements[index]) {
                            var badge = self._movieElements[index].querySelector('.saga-badge-requested');
                            if (badge) badge.parentNode.removeChild(badge);
                        }
                    } else {
                        self._showToast('Error al cancelar peticion', 'error');
                    }
                }).catch(function() {
                    self._showToast('Error de conexion', 'error');
                });
                return;
            }

            var movies = [{
                tmdbId: movie.tmdbId,
                title: movie.title || '',
                year: movie.year || '',
                poster: movie.poster || ''
            }];

            App.API.submitRequests(movies, 'TV').then(function(data) {
                if (data && data.success) {
                    if (data.duplicates > 0) {
                        self._showToast(movie.title + ' ya estaba solicitada', 'info');
                    } else {
                        self._showToast(movie.title + ' enviada a peticiones', 'success');
                    }
                    // Mark as requested — store the request ID for cancellation
                    var addedId = (data.added && data.added.length > 0) ? data.added[0].id : true;
                    self._existingRequestIds[movie.tmdbId] = addedId;

                    // Add "Pedida" badge to the grid item
                    if (self._movieElements[index]) {
                        var wrapper = self._movieElements[index].querySelector('.poster-wrapper');
                        if (wrapper && !wrapper.querySelector('.saga-badge-requested')) {
                            var badge = document.createElement('div');
                            badge.className = 'saga-badge-requested';
                            badge.textContent = 'Pedida';
                            wrapper.appendChild(badge);
                        }
                    }
                } else {
                    self._showToast('Error al enviar peticion', 'error');
                }
            }).catch(function() {
                self._showToast('Error de conexion', 'error');
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
        //  FOCUS MANAGEMENT (delegates to SidebarGridView)
        // =============================================

        _updateSagaFocus: function(index) {
            this._sagaFocusIndex = App.SidebarGridView.updateFocus(
                this._sagaElements, index, this._sidebarEl);
            // Saga-specific: show large tooltip with saga name
            if (this._allSagas[this._sagaFocusIndex]) {
                this._showSagaTooltip(
                    this._allSagas[this._sagaFocusIndex].name,
                    this._sagaElements[this._sagaFocusIndex]);
            }
        },

        _clearSagaFocus: function() {
            App.SidebarGridView.clearFocus(this._sagaElements);
            this._hideSagaTooltip();
        },

        _updateGridFocus: function(index) {
            this._gridFocusIndex = App.SidebarGridView.updateFocus(
                this._movieElements, index, this._contentEl);
        },

        _clearGridFocus: function() {
            App.SidebarGridView.clearFocus(this._movieElements);
        },

        _clearAllFocus: function() {
            this._clearSagaFocus();
            this._clearGridFocus();
            App.NavBar.clearFocus(this);
        },

        // =============================================
        //  NAV PANEL
        // =============================================

        _switchToNav: function() {
            this._prevPanel = this._activePanel;
            this._clearAllFocus();
            App.NavBar.switchTo(this, 'sagas');
        },

        _handleNavNav: function(key) {
            var self = this;
            App.NavBar.handleKey(this, key, function() {
                if (self._prevPanel === 'grid' && self._movieElements.length > 0) {
                    self._activePanel = 'grid';
                    self._updateGridFocus(self._gridFocusIndex);
                } else {
                    self._activePanel = 'sagas';
                    self._updateSagaFocus(self._sagaFocusIndex);
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
                sagas: function(key) { self._handleSagasNav(key); },
                grid: function(key) { self._handleGridNav(key); }
            });
        },

        // =============================================
        //  SAGAS PANEL NAVIGATION
        // =============================================

        _autoSelectSaga: function(idx) {
            var self = this;
            if (this._autoSelectTimer) clearTimeout(this._autoSelectTimer);
            this._autoSelectTimer = setTimeout(function() {
                var saga = self._allSagas[idx];
                if (saga && saga.id !== self._selectedSagaId) {
                    self._selectSaga(saga.id);
                }
            }, 300);
        },

        _handleSagasNav: function(key) {
            var idx = this._sagaFocusIndex;
            var total = this._sagaElements.length;

            switch (key) {
                case App.Config.KEYS.UP:
                    if (idx > 0) {
                        this._updateSagaFocus(idx - 1);
                        this._autoSelectSaga(idx - 1);
                    } else {
                        this._clearSagaFocus();
                        this._switchToNav();
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx < total - 1) {
                        this._updateSagaFocus(idx + 1);
                        this._autoSelectSaga(idx + 1);
                    }
                    break;

                case App.Config.KEYS.LEFT:
                    this._clearSagaFocus();
                    this._switchToNav();
                    break;

                case App.Config.KEYS.RIGHT:
                case App.Config.KEYS.OK:
                    var saga = this._allSagas[idx];
                    if (saga) {
                        var sameSaga = (saga.id === this._selectedSagaId);
                        if (!sameSaga) this._selectSaga(saga.id);
                        if (this._movieElements.length > 0) {
                            this._activePanel = 'grid';
                            this._clearSagaFocus();
                            this._updateGridFocus(sameSaga ? this._gridFocusIndex : 0);
                        }
                    }
                    break;
            }
        },

        // =============================================
        //  GRID PANEL NAVIGATION
        // =============================================

        _handleGridNav: function(key) {
            var self = this;
            App.SidebarGridView.handleGridNav(this, key, {
                sidebarPanel: 'sagas',
                onSidebarRestore: function() { self._updateSagaFocus(self._sagaFocusIndex); },
                onNav: function() { self._switchToNav(); },
                onOK: function(idx) {
                    if (self._movieData[idx]) self._onMovieSelect(idx, self._movieData[idx]);
                }
            });
        }
    };
})();
