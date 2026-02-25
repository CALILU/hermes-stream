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

            // Check if movie is in favorites
            this._isFavorite = false;
            if (App._favorites) {
                for (var i = 0; i < App._favorites.length; i++) {
                    if (App._favorites[i].videoPath === movie.filename) {
                        this._isFavorite = true;
                        break;
                    }
                }
            }

            this._buildDOM();
            this._setupKeyHandler();
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

            // Cast section
            if (movie.cast && movie.cast.length > 0) {
                var castSection = document.createElement('div');
                castSection.className = 'detail-cast-section';

                var castTitle = document.createElement('h3');
                castTitle.className = 'detail-cast-title';
                castTitle.textContent = 'Reparto';
                castSection.appendChild(castTitle);

                var castScroll = document.createElement('div');
                castScroll.className = 'detail-cast-scroll';

                var castLimit = Math.min(movie.cast.length, 10);
                for (var c = 0; c < castLimit; c++) {
                    var actor = movie.cast[c];
                    var castItem = document.createElement('div');
                    castItem.className = 'cast-item';

                    var photo = document.createElement('img');
                    photo.className = 'cast-photo';
                    photo.alt = actor.name || '';
                    if (actor.profile_path) {
                        photo.src = App.Config.posterUrl(actor.profile_path, 'w185');
                    } else {
                        photo.src = 'assets/placeholder.svg';
                    }

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
                }

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

            // Remove focused from all
            this._buttons.forEach(function(btn) {
                btn.classList.remove('focused');
            });

            this._focusedBtnIndex = index;
            this._buttons[index].classList.add('focused');
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

                switch (key) {
                    case App.Config.KEYS.LEFT:
                        if (self._focusedBtnIndex > 0) {
                            self._setButtonFocus(self._focusedBtnIndex - 1);
                        }
                        break;

                    case App.Config.KEYS.RIGHT:
                        if (self._focusedBtnIndex < self._buttons.length - 1) {
                            self._setButtonFocus(self._focusedBtnIndex + 1);
                        }
                        break;

                    case App.Config.KEYS.OK:
                        self._onButtonSelect();
                        break;

                    case App.Config.KEYS.BACK:
                        self._goBack();
                        break;

                    case App.Config.KEYS.PLAY:
                        self._play();
                        break;
                }
            };

            document.addEventListener('keydown', this._keyHandler);
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

            // Check for saved progress
            var startPos = 0;
            var duration = 0;
            if (App._continueWatching) {
                for (var i = 0; i < App._continueWatching.length; i++) {
                    if (App._continueWatching[i].videoPath === movie.filename) {
                        startPos = App._continueWatching[i].position || 0;
                        duration = App._continueWatching[i].duration || 0;
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
                document.removeEventListener('keydown', this._keyHandler);
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
            this._movie = null;
        }
    };
})();
