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
        _cachedFeatured: null,
        _scrollTooltipHandler: null,
        _scrollLazyHandler: null,
        _savedScrollTop: 0,
        _savedRowIndex: -1,
        _savedCarouselIndex: 0,
        _savedMovieId: null,
        _savedGroupId: null,
        _savedSection: null,
        _cachedGenreOrder: null,
        _cachedGenreGroups: null,

        /**
         * Show home view and build the current section.
         * Can be called with explicit data or with no args (uses cached App._* data).
         * The Router calls show(data) with a single arg or undefined on back navigation.
         */
        show: function(videos, genres, continueWatching, favorites, isBack) {
            // If called from Router with no meaningful data, use cached values
            if (!Array.isArray(videos)) {
                // Router calls show(data, isBack) — data may be undefined
                if (typeof videos === 'undefined' || videos === null) {
                    isBack = genres; // second arg is isBack when called from Router
                }
                videos = App._videos || [];
                genres = App._genres || [];
                continueWatching = App._continueWatching || [];
                favorites = App._favorites || [];
            }

            var restoreScroll = isBack && this._savedSection === this._currentSection && this._savedRowIndex >= 0;

            this._container = document.getElementById('home-view');
            this._container.style.display = '';
            // Hide container during restore to avoid visual flash
            if (restoreScroll) {
                this._container.style.visibility = 'hidden';
            }
            this._container.innerHTML = '';

            // Hide tooltip on scroll (Magic Remote mouseleave unreliable)
            if (this._scrollTooltipHandler) {
                this._container.removeEventListener('scroll', this._scrollTooltipHandler);
            }
            this._scrollTooltipHandler = function() { App._hideHoverTooltip(); };
            this._container.addEventListener('scroll', this._scrollTooltipHandler);
            this._destroyCarousels();
            this._rowGroupIds = [];
            this._lazyRows = [];

            if (this._currentSection === 'movies') {
                this._buildMoviesView(videos, genres, continueWatching, restoreScroll);
            } else if (this._currentSection === 'series') {
                this._buildSeriesView();
            } else if (this._currentSection === 'favorites') {
                this._buildFavoritesView(videos, favorites);
            }

            // Restore scroll position and focused row when coming back
            if (restoreScroll) {
                var self = this;
                var savedGroupId = this._savedGroupId;
                var savedCarousel = this._savedCarouselIndex;
                var savedMovieId = this._savedMovieId;
                var savedScroll = this._savedScrollTop;

                // Force init ALL lazy rows synchronously so the target carousel exists
                var cwData = App._continueWatching || [];
                for (var i = 0; i < this._lazyRows.length; i++) {
                    if (!this._lazyRows[i].initialized) {
                        this._initLazyRow(this._lazyRows[i], cwData);
                    }
                }
                // Restore scroll position
                this._container.scrollTop = savedScroll;

                // Find the carousel by groupId
                var targetCarousel = null;
                if (savedGroupId) {
                    for (var c = 0; c < this._carousels.length; c++) {
                        if (this._carousels[c].groupId === savedGroupId) {
                            targetCarousel = this._carousels[c];
                            break;
                        }
                    }
                }
                if (targetCarousel) {
                    // Find the movie by identifier in the carousel
                    var focusIdx = savedCarousel;
                    if (savedMovieId) {
                        for (var m = 0; m < targetCarousel._items.length; m++) {
                            var item = targetCarousel._items[m];
                            if (item.filename === savedMovieId || item.tmdbId === savedMovieId) {
                                focusIdx = m;
                                break;
                            }
                        }
                    }
                    targetCarousel.focusAt(focusIdx);
                    App.Focus._currentGroup = targetCarousel.groupId;
                }

                // Show container after everything is positioned
                setTimeout(function() {
                    if (self._container) {
                        self._container.style.visibility = '';
                    }
                }, 20);
            }

            this._savedRowIndex = -1;
        },

        /**
         * Build movie carousels grouped by genre.
         */
        /**
         * Build the Netflix-style featured section at the top.
         * 1 large item (2 slots) + 3 small items = 5 slots.
         */
        _buildFeaturedSection: function(container, videos) {
            var self = this;

            // Select 5 movies: current year releases (by releaseDate), with backdrop
            var currentYear = new Date().getFullYear();
            var withBackdrop = videos.filter(function(v) { return v.backdrop; });

            // Filter by current year release
            var currentYearMovies = withBackdrop.filter(function(v) {
                return v.releaseDate && v.releaseDate.substring(0, 4) === String(currentYear);
            });

            // Fallback to previous year if not enough
            if (currentYearMovies.length < 5) {
                var prevYear = withBackdrop.filter(function(v) {
                    return v.releaseDate && v.releaseDate.substring(0, 4) === String(currentYear - 1);
                });
                currentYearMovies = currentYearMovies.concat(prevYear);
            }

            // Sort by release date descending (most recent first)
            currentYearMovies.sort(function(a, b) {
                var dateA = a.releaseDate || '';
                var dateB = b.releaseDate || '';
                return dateB.localeCompare(dateA);
            });

            // Shuffle top candidates to vary each app open (Fisher-Yates on top 15)
            var pool = currentYearMovies.slice(0, 15);
            for (var s = pool.length - 1; s > 0; s--) {
                var j = Math.floor(Math.random() * (s + 1));
                var tmp = pool[s];
                pool[s] = pool[j];
                pool[j] = tmp;
            }

            var featured;
            if (this._cachedFeatured) {
                // Reuse same selection within this app session
                featured = this._cachedFeatured;
            } else {
                featured = pool.slice(0, 5);
                if (featured.length < 5) {
                    // Not enough current/prev year, fill from most recent releases
                    var remaining = withBackdrop.filter(function(v) {
                        return featured.indexOf(v) === -1;
                    });
                    remaining.sort(function(a, b) {
                        return (b.releaseDate || '').localeCompare(a.releaseDate || '');
                    });
                    for (var r = 0; r < remaining.length && featured.length < 5; r++) {
                        featured.push(remaining[r]);
                    }
                }
                this._cachedFeatured = featured;
            }
            if (featured.length < 5) return; // Not enough movies with backdrops

            // Build section
            var section = document.createElement('div');
            section.className = 'featured-section';

            var title = document.createElement('div');
            title.className = 'featured-title';
            title.textContent = 'Estrenos ' + currentYear;
            section.appendChild(title);

            var grid = document.createElement('div');
            grid.className = 'featured-grid';

            var items = [];
            var focusElements = [];

            for (var i = 0; i < featured.length; i++) {
                var movie = featured[i];
                var isLarge = (i === 0);

                var el = document.createElement('div');
                el.className = 'featured-item focusable ' + (isLarge ? 'featured-item-large' : 'featured-item-small');
                el.setAttribute('data-featured-index', i);

                var img = document.createElement('img');
                img.className = 'featured-item-img';
                img.alt = movie.title || '';
                // Large uses backdrop, small uses poster
                img.setAttribute('data-src', isLarge ? App.Config.backdropUrl(movie.backdrop) : App.Config.posterUrl(movie.poster));
                img.onload = function() { this.classList.add('loaded'); };

                var overlay = document.createElement('div');
                overlay.className = 'featured-item-overlay';

                var titleEl = document.createElement('div');
                titleEl.className = 'featured-item-title';
                titleEl.textContent = movie.title || '';

                overlay.appendChild(titleEl);
                el.appendChild(img);
                el.appendChild(overlay);
                grid.appendChild(el);

                if (App.Images && App.Images.observe) {
                    App.Images.observe(img);
                }

                // Click/pointer support (Magic Remote)
                (function(idx, mov, element) {
                    element.addEventListener('click', function(e) {
                        e.stopPropagation();
                        self._onMovieSelect(mov);
                    });
                    element.addEventListener('mouseenter', function() {
                        // Focus this item visually
                        for (var f = 0; f < focusElements.length; f++) {
                            focusElements[f].classList.remove('focused');
                        }
                        element.classList.add('focused');
                        self._updateFeaturedInfo(mov, infoBar);
                        // Set featured as active focus group
                        if (App.Focus && App.Focus.setActiveGroup) {
                            App.Focus.setActiveGroup('featured', idx);
                        }
                        // Show hover tooltip
                        var title = mov.title || '';
                        if (title) App._showHoverTooltip(title, element);
                    });
                    element.addEventListener('mouseleave', function() {
                        App._hideHoverTooltip();
                    });
                })(i, movie, el);

                items.push(movie);
                focusElements.push(el);
            }

            section.appendChild(grid);

            // Info bar (updates on focus)
            var infoBar = document.createElement('div');
            infoBar.className = 'featured-info-bar';
            infoBar.id = 'featured-info-bar';
            section.appendChild(infoBar);

            container.appendChild(section);

            // Register focus group
            var groupId = 'featured';
            App.Focus.registerGroup(groupId, focusElements, {
                orientation: 'horizontal',
                onFocus: function(el, index) {
                    self._updateFeaturedInfo(items[index], infoBar);
                    self._ensureRowVisible(section);
                },
                onSelect: function(el, index) {
                    self._onMovieSelect(items[index]);
                }
            });
            this._rowGroupIds.push(groupId);

            // Show info for first item immediately
            this._updateFeaturedInfo(items[0], infoBar);
        },

        /**
         * Update the featured info bar with movie details.
         */
        _updateFeaturedInfo: function(movie, infoBar) {
            if (!movie || !infoBar) return;

            var year = movie.releaseDate ? movie.releaseDate.substring(0, 4) : '';
            var genres = [];
            if (movie.genreIds) {
                for (var i = 0; i < Math.min(movie.genreIds.length, 2); i++) {
                    var name = App.getGenreName(movie.genreIds[i]);
                    if (name) genres.push(name);
                }
            }
            var duration = '';
            if (movie.runtime) {
                var h = Math.floor(movie.runtime / 60);
                var m = movie.runtime % 60;
                duration = h > 0 ? h + 'h ' + m + 'min' : m + ' min';
            }
            var rating = movie.rating ? ('★ ' + movie.rating.toFixed(1)) : '';

            var parts = [];
            parts.push('<span class="featured-info-type">Película</span>');
            if (genres.length > 0) parts.push(genres.join(', '));
            if (year) parts.push(year);
            if (duration) parts.push(duration);
            if (rating) parts.push('<span class="featured-info-rating">' + rating + '</span>');

            infoBar.innerHTML = parts.join(' <span class="featured-info-separator">·</span> ');
            // Synopsis below info bar
            var synopsisEl = infoBar.parentNode.querySelector('.featured-synopsis');
            if (!synopsisEl) {
                synopsisEl = document.createElement('div');
                synopsisEl.className = 'featured-synopsis';
                infoBar.parentNode.insertBefore(synopsisEl, infoBar.nextSibling);
            }
            synopsisEl.textContent = movie.overview || '';
            infoBar.classList.add('visible');
        },

        _buildMoviesView: function(videos, genres, continueWatching, restoreScroll) {
            var self = this;
            var container = this._container;

            // Featured section (Netflix-style)
            this._buildFeaturedSection(container, videos);

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

            // Reuse cached genre order on back navigation (avoid reshuffle)
            var genreGroups;
            var genreOrder;
            if (restoreScroll && this._cachedGenreOrder && this._cachedGenreGroups) {
                genreGroups = this._cachedGenreGroups;
                genreOrder = this._cachedGenreOrder;
            } else {
                // Group movies by primary genre (genreIds[0])
                genreGroups = {};
                genreOrder = [];

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

                // Shuffle movies within each genre (Fisher-Yates)
                genreOrder.forEach(function(gid) {
                    var movies = genreGroups[gid];
                    for (var sh = movies.length - 1; sh > 0; sh--) {
                        var rj = Math.floor(Math.random() * (sh + 1));
                        var temp = movies[sh];
                        movies[sh] = movies[rj];
                        movies[rj] = temp;
                    }
                });

                // Cache for back navigation
                this._cachedGenreOrder = genreOrder;
                this._cachedGenreGroups = genreGroups;
            }

            // Create genre rows lazily — only initialize carousel when scrolled into view
            var lazyRows = [];
            genreOrder.forEach(function(gid) {
                var movies = genreGroups[gid];
                if (movies.length < 3) return;

                var genreName = gid === 0 ? 'Otros' : App.getGenreName(gid);
                if (!genreName) genreName = 'Otros';

                // Create the row DOM but defer carousel creation
                var groupId = 'genre-' + gid;
                var row = document.createElement('div');
                row.className = 'genre-row';

                var titleEl = document.createElement('div');
                titleEl.className = 'genre-title';
                titleEl.textContent = genreName;
                row.appendChild(titleEl);

                var carouselContainer = document.createElement('div');
                carouselContainer.className = 'carousel-container';
                row.appendChild(carouselContainer);

                container.appendChild(row);

                var lazyEntry = {
                    row: row,
                    container: carouselContainer,
                    movies: movies,
                    groupId: groupId,
                    initialized: false
                };

                // Register a focus group with a dummy element so D-pad DOWN can land here
                // On focus, the carousel gets initialized and replaces the dummy
                (function(entry) {
                    var dummy = document.createElement('div');
                    dummy.className = 'carousel-item focusable';
                    dummy.style.cssText = 'width:1px;height:1px;opacity:0;position:absolute;';
                    carouselContainer.appendChild(dummy);

                    App.Focus.registerGroup(entry.groupId, [dummy], {
                        orientation: 'horizontal',
                        onFocus: function() {
                            // Lazy init: create carousel on first D-pad focus
                            if (!entry.initialized) {
                                carouselContainer.removeChild(dummy);
                                self._initLazyRow(entry, continueWatching);
                            }
                        },
                        onSelect: function() {}
                    });
                })(lazyEntry);

                self._rowGroupIds.push(groupId);
                lazyRows.push(lazyEntry);
            });

            // Lazy init: observe which rows become visible
            self._lazyRows = lazyRows;
            self._initLazyObserver(continueWatching);

            // Focus the first carousel (skip if restoring scroll — handled in show())
            if (!restoreScroll && this._carousels.length > 0) {
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

            // Match favorite filenames to video objects
            var favMovies = [];
            favorites.forEach(function(fav) {
                // fav can be a string (filename) or object with videoPath
                var path = (typeof fav === 'string') ? fav : fav.videoPath;
                var movie = self._findVideoByPath(videos, path);
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

            // Add progress bar if the movie has saved progress (API returns snake_case fields)
            if (continueWatching) {
                var progress = null;
                for (var i = 0; i < continueWatching.length; i++) {
                    if (continueWatching[i].video_path === movie.filename) {
                        progress = continueWatching[i];
                        break;
                    }
                }
                if (progress && progress.duration_seconds && progress.duration_seconds > 0) {
                    var pct = Math.min(100, Math.round((progress.position_seconds / progress.duration_seconds) * 100));
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
                var movie = self._findVideoByPath(videos, cw.video_path);
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
         * Initialize lazy observer for genre rows.
         * Uses scroll listener (IntersectionObserver unreliable on webOS 4.0).
         */
        _initLazyObserver: function(continueWatching) {
            var self = this;
            if (!this._lazyRows || this._lazyRows.length === 0) return;

            // Check which rows are visible and init them
            function checkVisibleRows() {
                if (!self._container) return;
                var viewTop = self._container.scrollTop;
                var viewBottom = viewTop + self._container.clientHeight;

                for (var i = 0; i < self._lazyRows.length; i++) {
                    var lr = self._lazyRows[i];
                    if (lr.initialized) continue;

                    // Row position relative to container
                    var rowTop = lr.row.offsetTop;
                    // Init if within 600px of visible area (1 screen ahead)
                    if (rowTop < viewBottom + 600) {
                        self._initLazyRow(lr, continueWatching);
                    }
                }
            }

            // Check on scroll (throttled)
            var scrollThrottle = null;
            if (this._scrollLazyHandler) {
                this._container.removeEventListener('scroll', this._scrollLazyHandler);
            }
            this._scrollLazyHandler = function() {
                if (scrollThrottle) return;
                scrollThrottle = setTimeout(function() {
                    scrollThrottle = null;
                    checkVisibleRows();
                }, 100);
            };
            this._container.addEventListener('scroll', this._scrollLazyHandler);

            // Initial check (first few rows)
            checkVisibleRows();
        },

        /**
         * Initialize a lazy genre row — create its carousel.
         */
        _initLazyRow: function(lr, continueWatching) {
            var self = this;
            if (lr.initialized) return;
            lr.initialized = true;

            if (App.Carousel && App.Carousel.create) {
                var carousel = App.Carousel.create(lr.container, lr.movies, {
                    groupId: lr.groupId,
                    itemWidth: App.Config.POSTER_WIDTH,
                    gap: App.Config.POSTER_GAP,
                    onSelect: function(item) {
                        self._onMovieSelect(item);
                    },
                    onFocus: function(item, index) {
                        self._ensureRowVisible(lr.row);
                    },
                    renderItem: function(item) {
                        return self._renderPosterItem(item, continueWatching);
                    }
                });
                carousel.groupId = lr.groupId;
                self._carousels.push(carousel);
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
                // Save scroll and focus state for restoration on back
                this._savedScrollTop = this._container.scrollTop || 0;
                this._savedSection = this._currentSection;
                this._savedRowIndex = -1;
                this._savedCarouselIndex = 0;

                // Find which carousel is currently focused and save movie identity
                var activeGroupId = App.Focus._currentGroup;
                this._savedGroupId = activeGroupId || null;
                this._savedMovieId = null;
                if (activeGroupId) {
                    for (var i = 0; i < this._carousels.length; i++) {
                        if (this._carousels[i].groupId === activeGroupId) {
                            this._savedRowIndex = i;
                            var fi = this._carousels[i]._focusIndex || 0;
                            this._savedCarouselIndex = fi;
                            // Save movie identifier to find it after reshuffle
                            var focusedItem = this._carousels[i]._items[fi];
                            if (focusedItem) {
                                this._savedMovieId = focusedItem.filename || focusedItem.tmdbId || null;
                            }
                            break;
                        }
                    }
                }

                if (this._scrollTooltipHandler) {
                    this._container.removeEventListener('scroll', this._scrollTooltipHandler);
                    this._scrollTooltipHandler = null;
                }
                if (this._scrollLazyHandler) {
                    this._container.removeEventListener('scroll', this._scrollLazyHandler);
                    this._scrollLazyHandler = null;
                }
                // Release memory: destroy carousels, focus groups, and DOM
                this._destroyCarousels();
                this._rowGroupIds = [];
                this._lazyRows = [];
                this._container.innerHTML = '';
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

            // Unregister all focus groups from this view
            if (App.Focus && App.Focus.unregisterGroup) {
                for (var i = 0; i < this._rowGroupIds.length; i++) {
                    App.Focus.unregisterGroup(this._rowGroupIds[i]);
                }
            }

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
            this._lazyRows = [];
        }
    };
})();
