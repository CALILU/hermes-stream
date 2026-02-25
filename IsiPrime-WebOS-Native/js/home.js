/**
 * IsiPrime webOS App - Home View
 * Renders genre carousels for movies, series, and favorites.
 * D-pad navigation between rows (vertical) and within rows (horizontal via Carousel).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Home = {
        _carousels: [],
        _container: null,
        _currentSection: 'movies',
        _rowGroupIds: [],

        /**
         * Show home view and build the current section.
         * Can be called with explicit data or with no args (uses cached App._* data).
         * The Router calls show(data) with a single arg or undefined on back navigation.
         */
        show: function(videos, genres, continueWatching, favorites) {
            // If called from Router with no meaningful data, use cached values
            if (!Array.isArray(videos)) {
                videos = App._videos || [];
                genres = App._genres || [];
                continueWatching = App._continueWatching || [];
                favorites = App._favorites || [];
            }

            this._container = document.getElementById('home-view');
            this._container.style.display = '';
            this._container.innerHTML = '';
            this._destroyCarousels();
            this._rowGroupIds = [];

            if (this._currentSection === 'movies') {
                this._buildMoviesView(videos, genres, continueWatching);
            } else if (this._currentSection === 'series') {
                this._buildSeriesView();
            } else if (this._currentSection === 'favorites') {
                this._buildFavoritesView(videos, favorites);
            }
        },

        /**
         * Build movie carousels grouped by genre.
         */
        _buildMoviesView: function(videos, genres, continueWatching) {
            var self = this;
            var container = this._container;

            // Row 1: "Continuar viendo" (if there are items)
            if (continueWatching && continueWatching.length > 0) {
                var cwItems = this._matchContinueWatching(videos, continueWatching);
                if (cwItems.length > 0) {
                    this._createGenreRow(container, 'Continuar viendo', cwItems, 'cw', function(item) {
                        return self._renderPosterItem(item, continueWatching);
                    }, function(item) {
                        self._onMovieSelect(item);
                    });
                }
            }

            // Row 2: "Agregado recientemente" (latest 20 movies by addedDate)
            var recentMovies = this._getRecentMovies(videos, 20);
            if (recentMovies.length > 0) {
                this._createGenreRow(container, 'Agregado recientemente', recentMovies, 'recent', function(item) {
                    return self._renderPosterItem(item, continueWatching);
                }, function(item) {
                    self._onMovieSelect(item);
                });
            }

            // Group movies by primary genre (genreIds[0])
            var genreGroups = {};
            var genreOrder = [];

            videos.forEach(function(movie) {
                var gid = (movie.genreIds && movie.genreIds.length > 0) ? movie.genreIds[0] : 0;
                if (!genreGroups[gid]) {
                    genreGroups[gid] = [];
                    genreOrder.push(gid);
                }
                genreGroups[gid].push(movie);
            });

            // Sort genres by number of movies (descending)
            genreOrder.sort(function(a, b) {
                return genreGroups[b].length - genreGroups[a].length;
            });

            // Create a carousel for each genre with >= 3 movies
            genreOrder.forEach(function(gid) {
                var movies = genreGroups[gid];
                if (movies.length < 3) return;

                var genreName = gid === 0 ? 'Otros' : App.getGenreName(gid);
                if (!genreName) genreName = 'Otros';

                self._createGenreRow(container, genreName, movies, 'genre-' + gid, function(item) {
                    return self._renderPosterItem(item, continueWatching);
                }, function(item) {
                    self._onMovieSelect(item);
                });
            });

            // Focus the first carousel
            if (this._carousels.length > 0) {
                var firstGroupId = this._rowGroupIds[0];
                if (firstGroupId && App.Focus && App.Focus.setActiveGroup) {
                    App.Focus.setActiveGroup(firstGroupId, 0);
                }
            }
        },

        /**
         * Build series carousels.
         */
        _buildSeriesView: function() {
            var self = this;
            var container = this._container;

            // Show loading indicator
            var loadingDiv = document.createElement('div');
            loadingDiv.className = 'genre-row';
            loadingDiv.innerHTML = '<div class="genre-title">Cargando series...</div>';
            container.appendChild(loadingDiv);

            App.API.getSeries().then(function(series) {
                App._series = series || [];
                container.innerHTML = '';
                self._destroyCarousels();
                self._rowGroupIds = [];

                if (App._series.length === 0) {
                    var emptyDiv = document.createElement('div');
                    emptyDiv.className = 'genre-row';
                    emptyDiv.innerHTML = '<div class="genre-title">No hay series disponibles</div>';
                    container.appendChild(emptyDiv);
                    return;
                }

                // Group series by genre
                var genreGroups = {};
                var genreOrder = [];

                App._series.forEach(function(s) {
                    var gid = (s.genreIds && s.genreIds.length > 0) ? s.genreIds[0] : 0;
                    if (!genreGroups[gid]) {
                        genreGroups[gid] = [];
                        genreOrder.push(gid);
                    }
                    genreGroups[gid].push(s);
                });

                genreOrder.sort(function(a, b) {
                    return genreGroups[b].length - genreGroups[a].length;
                });

                // If few genres, show all as one list
                if (genreOrder.length <= 1 || App._series.length < 10) {
                    self._createGenreRow(container, 'Todas las series', App._series, 'series-all', function(item) {
                        return self._renderSeriesItem(item);
                    }, function(item) {
                        if (App.Router && App.Router.navigate) {
                            App.Router.navigate('SERIES', item);
                        }
                    });
                } else {
                    genreOrder.forEach(function(gid) {
                        var items = genreGroups[gid];
                        if (items.length < 2) return;

                        var genreName = gid === 0 ? 'Otros' : App.getGenreName(gid);
                        if (!genreName) genreName = 'Otros';

                        self._createGenreRow(container, genreName, items, 'series-' + gid, function(item) {
                            return self._renderSeriesItem(item);
                        }, function(item) {
                            if (App.Router && App.Router.navigate) {
                                App.Router.navigate('SERIES', item);
                            }
                        });
                    });
                }

                // Focus first carousel
                if (self._carousels.length > 0 && self._rowGroupIds.length > 0) {
                    App.Focus.setActiveGroup(self._rowGroupIds[0], 0);
                }
            }).catch(function(err) {
                console.error('Error loading series:', err);
                container.innerHTML = '';
                var errorDiv = document.createElement('div');
                errorDiv.className = 'genre-row';
                errorDiv.innerHTML = '<div class="genre-title">Error al cargar series</div>';
                container.appendChild(errorDiv);
            });
        },

        /**
         * Build favorites view.
         */
        _buildFavoritesView: function(videos, favorites) {
            var self = this;
            var container = this._container;

            if (!favorites || favorites.length === 0) {
                var emptyDiv = document.createElement('div');
                emptyDiv.className = 'genre-row';
                emptyDiv.innerHTML = '<div class="genre-title">No tienes favoritos guardados</div>';
                container.appendChild(emptyDiv);
                return;
            }

            // Match favorite videoPath to video objects
            var favMovies = [];
            favorites.forEach(function(fav) {
                var movie = self._findVideoByPath(videos, fav.videoPath);
                if (movie) {
                    favMovies.push(movie);
                }
            });

            if (favMovies.length === 0) {
                var emptyDiv2 = document.createElement('div');
                emptyDiv2.className = 'genre-row';
                emptyDiv2.innerHTML = '<div class="genre-title">No se encontraron favoritos</div>';
                container.appendChild(emptyDiv2);
                return;
            }

            this._createGenreRow(container, 'Mis favoritos', favMovies, 'favorites', function(item) {
                return self._renderPosterItem(item, App._continueWatching);
            }, function(item) {
                self._onMovieSelect(item);
            });

            // Focus first carousel
            if (this._carousels.length > 0 && this._rowGroupIds.length > 0) {
                App.Focus.setActiveGroup(this._rowGroupIds[0], 0);
            }
        },

        /**
         * Create a genre row with title and carousel.
         */
        _createGenreRow: function(container, title, items, groupId, renderItem, onSelect) {
            var self = this;
            var row = document.createElement('div');
            row.className = 'genre-row';

            var titleEl = document.createElement('div');
            titleEl.className = 'genre-title';
            titleEl.textContent = title;
            row.appendChild(titleEl);

            var carouselContainer = document.createElement('div');
            carouselContainer.className = 'carousel-container';
            row.appendChild(carouselContainer);

            container.appendChild(row);

            // Create carousel using the Carousel module
            if (App.Carousel && App.Carousel.create) {
                var carousel = App.Carousel.create(carouselContainer, items, {
                    groupId: groupId,
                    itemWidth: App.Config.POSTER_WIDTH,
                    gap: App.Config.POSTER_GAP,
                    onSelect: function(item) {
                        if (onSelect) onSelect(item);
                    },
                    onFocus: function(item, index) {
                        // Scroll the row into view if needed
                        self._ensureRowVisible(row);
                    },
                    renderItem: renderItem
                });

                carousel.groupId = groupId;
                this._carousels.push(carousel);
                this._rowGroupIds.push(groupId);
            }
        },

        /**
         * Render a movie poster item for the carousel.
         * Returns a DOM element.
         */
        _renderPosterItem: function(movie, continueWatching) {
            var item = document.createElement('div');
            item.className = 'carousel-item focusable';

            var wrapper = document.createElement('div');
            wrapper.className = 'poster-wrapper';

            var img = document.createElement('img');
            img.className = 'poster-img';
            img.alt = movie.title || '';
            img.setAttribute('data-src', App.Config.posterUrl(movie.poster));

            wrapper.appendChild(img);
            item.appendChild(wrapper);

            var titleDiv = document.createElement('div');
            titleDiv.className = 'poster-title';
            titleDiv.textContent = movie.title || movie.filename || '';
            item.appendChild(titleDiv);

            // Add progress bar if the movie has saved progress
            if (continueWatching) {
                var progress = null;
                for (var i = 0; i < continueWatching.length; i++) {
                    if (continueWatching[i].videoPath === movie.filename) {
                        progress = continueWatching[i];
                        break;
                    }
                }
                if (progress && progress.duration && progress.duration > 0) {
                    var pct = Math.min(100, Math.round((progress.position / progress.duration) * 100));
                    if (pct > 0) {
                        var progressBar = document.createElement('div');
                        progressBar.className = 'poster-progress';
                        progressBar.style.width = pct + '%';
                        item.appendChild(progressBar);
                    }
                }
            }

            // Add "Nuevo" badge for movies added in the last 7 days
            if (movie.addedDate) {
                var addedTime = new Date(movie.addedDate).getTime();
                var sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                if (addedTime > sevenDaysAgo) {
                    var badge = document.createElement('div');
                    badge.className = 'poster-badge';
                    badge.textContent = 'Nuevo';
                    wrapper.appendChild(badge);
                }
            }

            // Start lazy loading observation
            if (App.Images && App.Images.observe) {
                App.Images.observe(img);
            }

            return item;
        },

        /**
         * Render a series poster item for the carousel.
         */
        _renderSeriesItem: function(series) {
            var item = document.createElement('div');
            item.className = 'carousel-item focusable';

            var wrapper = document.createElement('div');
            wrapper.className = 'poster-wrapper';

            var img = document.createElement('img');
            img.className = 'poster-img';
            img.alt = series.name || series.title || '';
            var posterPath = series.poster || series.poster_path || null;
            img.setAttribute('data-src', App.Config.posterUrl(posterPath));

            wrapper.appendChild(img);
            item.appendChild(wrapper);

            var titleDiv = document.createElement('div');
            titleDiv.className = 'poster-title';
            titleDiv.textContent = series.name || series.title || series.folder || '';
            item.appendChild(titleDiv);

            if (App.Images && App.Images.observe) {
                App.Images.observe(img);
            }

            return item;
        },

        /**
         * Match continue watching entries to full video objects.
         */
        _matchContinueWatching: function(videos, continueWatching) {
            var self = this;
            var result = [];
            continueWatching.forEach(function(cw) {
                var movie = self._findVideoByPath(videos, cw.videoPath);
                if (movie) {
                    result.push(movie);
                }
            });
            return result;
        },

        /**
         * Find a video object by its filename/videoPath.
         */
        _findVideoByPath: function(videos, videoPath) {
            for (var i = 0; i < videos.length; i++) {
                if (videos[i].filename === videoPath) {
                    return videos[i];
                }
            }
            return null;
        },

        /**
         * Get the most recently added movies.
         */
        _getRecentMovies: function(videos, count) {
            var sorted = videos.slice().sort(function(a, b) {
                var dateA = a.addedDate ? new Date(a.addedDate).getTime() : 0;
                var dateB = b.addedDate ? new Date(b.addedDate).getTime() : 0;
                return dateB - dateA;
            });
            return sorted.slice(0, count);
        },

        /**
         * Handle movie selection (navigate to detail).
         */
        _onMovieSelect: function(movie) {
            if (App.Router && App.Router.navigate) {
                App.Router.navigate('DETAIL', movie);
            }
        },

        /**
         * Ensure a row is scrolled into view.
         */
        _ensureRowVisible: function(row) {
            if (!row || !this._container) return;
            var containerRect = this._container.getBoundingClientRect();
            var rowRect = row.getBoundingClientRect();

            // If row is below the visible area, scroll down
            if (rowRect.top > containerRect.bottom - 200) {
                this._container.scrollTop += rowRect.top - containerRect.top - 80;
            }
            // If row is above the visible area, scroll up
            if (rowRect.bottom < containerRect.top + 80) {
                this._container.scrollTop -= containerRect.top - rowRect.top + 80;
            }
        },

        /**
         * Hide the home view.
         */
        hide: function() {
            if (this._container) {
                this._container.style.display = 'none';
            }
        },

        /**
         * Refresh data and rebuild current section.
         */
        refresh: function() {
            var self = this;
            return App.refreshData().then(function() {
                self.show(App._videos, App._genres, App._continueWatching, App._favorites);
            });
        },

        /**
         * Switch to a different section (movies, series, favorites).
         */
        switchSection: function(section) {
            this._currentSection = section;
            this.show(App._videos, App._genres, App._continueWatching, App._favorites);
        },

        /**
         * Destroy all carousels and clean up.
         */
        _destroyCarousels: function() {
            this._carousels.forEach(function(c) {
                if (c && c.destroy) c.destroy();
            });
            this._carousels = [];

            // Clear images queue
            if (App.Images && App.Images.clearQueue) {
                App.Images.clearQueue();
            }
        },

        /**
         * Full cleanup when view is destroyed.
         */
        destroy: function() {
            this._destroyCarousels();
            this._rowGroupIds = [];
        }
    };
})();
