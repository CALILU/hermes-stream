/**
 * IsiPrime webOS App - Detail Overlay
 * Shows movie/series details: backdrop, metadata, genres, cast, play/favorite buttons.
 * D-pad navigation for buttons and cast scroll.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Detail = {
        _movie: null,
        _container: null,
        _isFavorite: false,
        _buttons: [],
        _focusedBtnIndex: 0,
        _castItems: [],
        _focusedCastIndex: 0,
        _focusZone: 'buttons', // 'buttons' or 'cast'
        _keyHandler: null,

        /**
         * Show the detail overlay for a movie.
         */
        show: function(movie) {
            this._movie = movie;
            this._container = document.getElementById('detail-overlay');
            this._container.style.display = '';
            this._container.innerHTML = '';
            this._buttons = [];
            this._focusedBtnIndex = 0;
            this._castItems = [];
            this._focusedCastIndex = 0;
            this._focusZone = 'buttons';

            // Check if movie is in favorites (favorites can be strings or objects)
            this._isFavorite = false;
            if (App._favorites) {
                for (var i = 0; i < App._favorites.length; i++) {
                    var fav = App._favorites[i];
                    var favPath = (typeof fav === 'string') ? fav : fav.videoPath;
                    if (favPath === movie.filename) {
                        this._isFavorite = true;
                        break;
                    }
                }
            }

            this._buildDOM();
            this._setupKeyHandler();

            // Mejora 5: Prefetch — pre-warm connection for video streaming
            // When user opens detail, pre-fetch video-info and HEAD the stream
            if (movie.filename) {
                var preUrl = App.Config.SERVER_URL + '/video-info/' + encodeURIComponent(movie.filename);
                if (App.API._accessToken) preUrl += '?token=' + encodeURIComponent(App.API._accessToken);
                App.API._xhrGet(preUrl, function() { /* just warm the connection */ });
            }
        },

        /**
         * Build the detail view DOM.
         */
        _buildDOM: function() {
            var movie = this._movie;
            var container = this._container;

            // Backdrop image
            if (movie.backdrop) {
                var backdrop = document.createElement('img');
                backdrop.className = 'detail-backdrop';
                backdrop.src = App.Config.backdropUrl(movie.backdrop);
                backdrop.alt = '';
                container.appendChild(backdrop);
            }

            // Gradient overlay
            var gradient = document.createElement('div');
            gradient.className = 'detail-gradient';
            container.appendChild(gradient);

            // Content area
            var content = document.createElement('div');
            content.className = 'detail-content';

            // Title
            var title = document.createElement('h1');
            title.className = 'detail-title';
            title.textContent = movie.title || movie.filename || '';
            content.appendChild(title);

            // Meta row: year, runtime, rating
            var meta = document.createElement('div');
            meta.className = 'detail-meta';

            var year = movie.releaseDate ? movie.releaseDate.substring(0, 4) : '';
            if (year) {
                var yearSpan = document.createElement('span');
                yearSpan.className = 'detail-meta-item';
                yearSpan.textContent = year;
                meta.appendChild(yearSpan);
            }

            if (movie.runtime) {
                var runtimeSpan = document.createElement('span');
                runtimeSpan.className = 'detail-meta-item';
                var hours = Math.floor(movie.runtime / 60);
                var mins = movie.runtime % 60;
                if (hours > 0) {
                    runtimeSpan.textContent = hours + 'h ' + mins + 'min';
                } else {
                    runtimeSpan.textContent = mins + ' min';
                }
                meta.appendChild(runtimeSpan);
            }

            if (movie.rating) {
                var ratingSpan = document.createElement('span');
                ratingSpan.className = 'detail-meta-item detail-rating';
                ratingSpan.textContent = '\u2605 ' + movie.rating.toFixed(1);
                meta.appendChild(ratingSpan);
            }

            if (movie.size) {
                var sizeSpan = document.createElement('span');
                sizeSpan.className = 'detail-meta-item';
                sizeSpan.textContent = movie.size;
                meta.appendChild(sizeSpan);
            }

            content.appendChild(meta);

            // Genre tags
            if (movie.genreIds && movie.genreIds.length > 0) {
                var genresDiv = document.createElement('div');
                genresDiv.className = 'detail-genres';

                movie.genreIds.forEach(function(gid) {
                    var name = App.getGenreName(gid);
                    if (name) {
                        var tag = document.createElement('span');
                        tag.className = 'detail-genre-tag';
                        tag.textContent = name;
                        genresDiv.appendChild(tag);
                    }
                });

                content.appendChild(genresDiv);
            }

            // Overview / synopsis
            if (movie.overview) {
                var overview = document.createElement('p');
                overview.className = 'detail-overview';
                overview.textContent = movie.overview;
                content.appendChild(overview);
            }

            // Action buttons
            var buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'detail-buttons';

            var playBtn = document.createElement('button');
            playBtn.className = 'detail-btn detail-btn-primary focusable';
            playBtn.textContent = '\u25B6 Reproducir';
            playBtn.setAttribute('data-action', 'play');
            buttonsDiv.appendChild(playBtn);

            var favBtn = document.createElement('button');
            favBtn.className = 'detail-btn detail-btn-secondary focusable';
            favBtn.textContent = this._isFavorite ? '\u2665 En favoritos' : '\u2661 Favorito';
            favBtn.setAttribute('data-action', 'favorite');
            buttonsDiv.appendChild(favBtn);

            content.appendChild(buttonsDiv);
            this._buttons = [playBtn, favBtn];

            // Magic Remote pointer: click handlers for buttons
            var self = this;
            playBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                self._play();
            });
            favBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                self._toggleFavorite();
            });

            // Magic Remote pointer: hover to focus buttons
            playBtn.addEventListener('mouseenter', function() {
                self._focusZone = 'buttons';
                self._clearCastFocus();
                self._setButtonFocus(0);
            });
            favBtn.addEventListener('mouseenter', function() {
                self._focusZone = 'buttons';
                self._clearCastFocus();
                self._setButtonFocus(1);
            });

            // Cast section
            this._castItems = [];
            if (movie.cast && movie.cast.length > 0) {
                var castSection = document.createElement('div');
                castSection.className = 'detail-cast-section';

                var castTitle = document.createElement('h3');
                castTitle.className = 'detail-cast-title';
                castTitle.textContent = 'Reparto \u2014 selecciona para ver filmograf\u00eda';
                castSection.appendChild(castTitle);

                var castScroll = document.createElement('div');
                castScroll.className = 'detail-cast-scroll';
                this._castScrollEl = castScroll;

                var castLimit = movie.cast.length;
                for (var c = 0; c < castLimit; c++) {
                    var actor = movie.cast[c];
                    var castItem = document.createElement('div');
                    castItem.className = 'cast-item';
                    castItem.setAttribute('data-actor-name', actor.name || '');
                    castItem.setAttribute('data-actor-photo', actor.photo || '');
                    castItem.setAttribute('data-cast-index', String(c));

                    var photo = document.createElement('img');
                    photo.className = 'cast-photo';
                    photo.alt = actor.name || '';
                    photo.setAttribute('data-src', App.Config.posterUrl(actor.photo, 'h632'));

                    var nameDiv = document.createElement('div');
                    nameDiv.className = 'cast-name';
                    nameDiv.textContent = actor.name || '';

                    var charDiv = document.createElement('div');
                    charDiv.className = 'cast-character';
                    charDiv.textContent = actor.character || '';

                    castItem.appendChild(photo);
                    castItem.appendChild(nameDiv);
                    castItem.appendChild(charDiv);
                    castScroll.appendChild(castItem);
                    this._castItems.push(castItem);

                    // Lazy load cast photo
                    if (App.Images && App.Images.observe) {
                        App.Images.observe(photo);
                    }

                    // Hover tooltip (Magic Remote pointer)
                    (function(item, name) {
                        item.addEventListener('mouseenter', function() {
                            if (name) App._showHoverTooltip(name, item);
                        });
                        item.addEventListener('mouseleave', function() {
                            App._hideHoverTooltip();
                        });
                    })(castItem, actor.name || '');
                }

                // Event delegation: single click handler on the scroll container
                var self = this;
                castScroll.addEventListener('click', function(e) {
                    // Find the closest .cast-item ancestor
                    var target = e.target;
                    var castEl = null;
                    while (target && target !== castScroll) {
                        if (target.classList && target.classList.contains('cast-item')) {
                            castEl = target;
                            break;
                        }
                        target = target.parentElement;
                    }
                    if (!castEl) return;

                    e.stopPropagation();
                    var idx = parseInt(castEl.getAttribute('data-cast-index'), 10);
                    console.log('[Detail] cast click, index:', idx, 'name:', castEl.getAttribute('data-actor-name'));
                    self._focusZone = 'cast';
                    self._setCastFocus(idx);
                    self._clearButtonFocus();
                    self._openActor(castEl);
                });

                castSection.appendChild(castScroll);
                content.appendChild(castSection);
            }

            container.appendChild(content);

            // Set initial focus on play button
            this._setButtonFocus(0);
        },

        /**
         * Set focus on a button by index.
         */
        _setButtonFocus: function(index) {
            if (index < 0 || index >= this._buttons.length) return;

            // Remove focused from all buttons
            this._buttons.forEach(function(btn) {
                btn.classList.remove('focused');
            });

            this._focusedBtnIndex = index;
            this._buttons[index].classList.add('focused');
        },

        /**
         * Clear button focus visual.
         */
        _clearButtonFocus: function() {
            this._buttons.forEach(function(btn) {
                btn.classList.remove('focused');
            });
        },

        /**
         * Set focus on a cast item by index.
         */
        _setCastFocus: function(index) {
            if (index < 0 || index >= this._castItems.length) return;

            for (var i = 0; i < this._castItems.length; i++) {
                this._castItems[i].classList.remove('focused');
            }

            this._focusedCastIndex = index;
            this._castItems[index].classList.add('focused');

            // Vertical scroll: ensure cast section is visible in detail-content
            var content = this._container.querySelector('.detail-content');
            if (content) {
                var castSection = this._container.querySelector('.detail-cast-section');
                if (castSection) {
                    var csRect = castSection.getBoundingClientRect();
                    var ctRect = content.getBoundingClientRect();
                    if (csRect.bottom > ctRect.bottom) {
                        content.scrollTop += csRect.bottom - ctRect.bottom + 40;
                    }
                }
            }
        },

        /**
         * Clear cast focus visual.
         */
        _clearCastFocus: function() {
            for (var i = 0; i < this._castItems.length; i++) {
                this._castItems[i].classList.remove('focused');
            }
        },

        /**
         * Open actor filmography view.
         */
        _openActor: function(castItem) {
            var name = castItem.getAttribute('data-actor-name');
            var photo = castItem.getAttribute('data-actor-photo');
            console.log('[Detail] openActor:', name, photo);
            if (!name) return;

            App.Router.navigate('ACTOR', { name: name, photo: photo });
        },

        /**
         * Setup keyboard handler for detail overlay.
         */
        _setupKeyHandler: function() {
            var self = this;

            // Disable Focus module (we handle keys ourselves in detail)
            if (App.Focus && App.Focus.disable) {
                App.Focus.disable();
            }

            this._keyHandler = function(e) {
                if (!self._container || self._container.style.display === 'none') return;

                var key = e.keyCode;
                e.preventDefault();
                // stopImmediatePropagation prevents Router's global BACK handler from also firing
                e.stopImmediatePropagation();

                if (self._focusZone === 'buttons') {
                    self._handleButtonsNav(key);
                } else {
                    self._handleCastNav(key);
                }
            };

            document.addEventListener('keydown', this._keyHandler, true);
        },

        /**
         * Handle D-pad in buttons zone.
         */
        _handleButtonsNav: function(key) {
            var self = this;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (this._focusedBtnIndex > 0) {
                        this._setButtonFocus(this._focusedBtnIndex - 1);
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (this._focusedBtnIndex < this._buttons.length - 1) {
                        this._setButtonFocus(this._focusedBtnIndex + 1);
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (this._castItems.length > 0) {
                        this._focusZone = 'cast';
                        this._clearButtonFocus();
                        this._setCastFocus(0);
                    }
                    break;

                case App.Config.KEYS.OK:
                    this._onButtonSelect();
                    break;

                case App.Config.KEYS.BACK:
                    this._goBack();
                    break;

                case App.Config.KEYS.PLAY:
                    this._play();
                    break;
            }
        },

        /**
         * Get number of cast items per row based on container width.
         */
        _getCastColumnsPerRow: function() {
            if (!this._castScrollEl || this._castItems.length < 2) return 1;
            // Compare top offset of items to detect row breaks
            var firstTop = this._castItems[0].offsetTop;
            for (var i = 1; i < this._castItems.length; i++) {
                if (this._castItems[i].offsetTop !== firstTop) {
                    return i;
                }
            }
            return this._castItems.length; // all in one row
        },

        /**
         * Handle D-pad in cast zone.
         */
        _handleCastNav: function(key) {
            var cols = this._getCastColumnsPerRow();
            var idx = this._focusedCastIndex;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (idx > 0) {
                        this._setCastFocus(idx - 1);
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (idx < this._castItems.length - 1) {
                        this._setCastFocus(idx + 1);
                    }
                    break;

                case App.Config.KEYS.UP:
                    if (idx - cols >= 0) {
                        // Move up one row
                        this._setCastFocus(idx - cols);
                    } else {
                        // First row: go back to buttons
                        this._focusZone = 'buttons';
                        this._clearCastFocus();
                        this._setButtonFocus(this._focusedBtnIndex);
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx + cols < this._castItems.length) {
                        // Move down one row
                        this._setCastFocus(idx + cols);
                    } else if (idx + cols >= this._castItems.length && idx < this._castItems.length - 1) {
                        // Partial last row: go to last item
                        this._setCastFocus(this._castItems.length - 1);
                    }
                    break;

                case App.Config.KEYS.OK:
                    this._openActor(this._castItems[this._focusedCastIndex]);
                    break;

                case App.Config.KEYS.BACK:
                    this._goBack();
                    break;

                case App.Config.KEYS.PLAY:
                    this._play();
                    break;
            }
        },

        /**
         * Handle button selection.
         */
        _onButtonSelect: function() {
            var btn = this._buttons[this._focusedBtnIndex];
            if (!btn) return;

            var action = btn.getAttribute('data-action');
            if (action === 'play') {
                this._play();
            } else if (action === 'favorite') {
                this._toggleFavorite();
            }
        },

        /**
         * Start playback for the current movie.
         */
        _play: function() {
            var movie = this._movie;

            // Check for saved progress (API returns snake_case fields)
            var startPos = 0;
            var duration = 0;
            if (App._continueWatching) {
                for (var i = 0; i < App._continueWatching.length; i++) {
                    if (App._continueWatching[i].video_path === movie.filename) {
                        startPos = App._continueWatching[i].position_seconds || 0;
                        duration = App._continueWatching[i].duration_seconds || 0;
                        break;
                    }
                }
            }

            App.Router.navigate('PLAYER', {
                url: App.API.streamUrl(movie.filename),
                title: movie.title || movie.filename,
                videoPath: movie.filename,
                startPosition: startPos,
                duration: duration
            });
        },

        /**
         * Toggle favorite status for the current movie.
         */
        _toggleFavorite: function() {
            var self = this;
            this._isFavorite = !this._isFavorite;

            // Update button text immediately for responsiveness
            var favBtn = this._buttons[1];
            if (favBtn) {
                favBtn.textContent = this._isFavorite ? '\u2665 En favoritos' : '\u2661 Favorito';
            }

            // Send API call
            App.API.toggleFavorite(this._movie.filename, this._isFavorite).then(function() {
                return App.refreshData();
            }).catch(function(err) {
                console.error('Error toggling favorite:', err);
                // Revert on error
                self._isFavorite = !self._isFavorite;
                if (favBtn) {
                    favBtn.textContent = self._isFavorite ? '\u2665 En favoritos' : '\u2661 Favorito';
                }
            });
        },

        /**
         * Go back from detail to previous view.
         * Router.back() calls _hideView(DETAIL) -> this.hide(), so no need to call hide() here.
         */
        _goBack: function() {
            if (App.Router && App.Router.back) {
                App.Router.back();
            }
        },

        /**
         * Hide the detail overlay and clean up.
         */
        hide: function() {
            // Remove key handler
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler, true);
                this._keyHandler = null;
            }

            // Clear DOM
            if (this._container) {
                this._container.style.display = 'none';
                this._container.innerHTML = '';
            }

            // Unregister focus groups
            if (App.Focus) {
                if (App.Focus.unregisterGroup) {
                    App.Focus.unregisterGroup('detail-buttons');
                    App.Focus.unregisterGroup('detail-cast');
                }
                // Re-enable Focus module
                if (App.Focus.enable) {
                    App.Focus.enable();
                }
            }

            this._buttons = [];
            this._castItems = [];
            this._castScrollEl = null;
            this._movie = null;
            this._focusZone = 'buttons';
        }
    };
})();
