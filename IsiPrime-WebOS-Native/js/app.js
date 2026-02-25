/**
 * IsiPrime webOS App - Application Bootstrap
 * Initializes all modules, handles auth flow, loads data, starts the home view.
 * Must be loaded LAST (after all other modules).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    // ---- Cached Data ----
    App._videos = [];
    App._genres = [];
    App._genreMap = {};
    App._continueWatching = [];
    App._favorites = [];
    App._series = [];

    /**
     * Get genre name by TMDB genre ID.
     */
    App.getGenreName = function(id) {
        return App._genreMap[id] || '';
    };

    /**
     * Refresh user-specific data (continue watching + favorites).
     * Called after returning from player or toggling favorites.
     */
    App.refreshData = function() {
        return Promise.all([
            App.API.getContinueWatching(),
            App.API.getFavorites()
        ]).then(function(results) {
            App._continueWatching = (results[0] && results[0].videos) ? results[0].videos : [];
            App._favorites = (results[1] && results[1].favorites) ? results[1].favorites : [];
        }).catch(function(err) {
            console.error('Error refreshing data:', err);
        });
    };

    /**
     * Main initialization. Handles auth, loads data, shows home view.
     */
    App.init = function() {
        var loadingScreen = document.getElementById('loading-screen');
        var appContainer = document.getElementById('app-container');

        // 1. Show loading screen
        loadingScreen.style.display = 'flex';
        appContainer.style.display = 'none';

        // 2. Initialize modules
        App.Images.init();
        if (App.Focus && App.Focus.init) {
            App.Focus.init();
        }
        if (App.Router && App.Router.init) {
            App.Router.init();
        }

        // 3. Check auth
        return App.API.init().then(function(isLocal) {
            if (isLocal) {
                // LAN auto-auth, proceed
                return true;
            }

            // Try restoring session from stored refresh token
            if (App.API.hasStoredSession()) {
                return App.API.restoreSession().then(function() {
                    return true;
                }).catch(function() {
                    return false;
                });
            }

            return false;
        }).then(function(authenticated) {
            if (!authenticated) {
                // Show login screen
                loadingScreen.style.display = 'none';
                App.Login.show();
                return;
            }

            // 4. Load all data in parallel
            return Promise.all([
                App.API.getVideos(),
                App.API.getGenres(),
                App.API.getContinueWatching(),
                App.API.getFavorites()
            ]).then(function(results) {
                App._videos = results[0] || [];
                App._genres = results[1] || [];

                // Build genre map { id: name }
                App._genreMap = {};
                App._genres.forEach(function(g) {
                    App._genreMap[g.id] = g.name;
                });

                App._continueWatching = (results[2] && results[2].videos) ? results[2].videos : [];
                App._favorites = (results[3] && results[3].favorites) ? results[3].favorites : [];

                // 5. Hide loading, show app
                loadingScreen.style.display = 'none';
                appContainer.style.display = '';

                // 6. Setup nav bar
                App._setupNav();

                // 7. Navigate to HOME via Router (which calls App.Home.show)
                // Home.show() will use the cached App._* data
                if (App.Router && App.Router.navigate) {
                    App.Router.navigate('HOME');
                } else {
                    // Fallback if Router not available
                    App.Home.show(App._videos, App._genres, App._continueWatching, App._favorites);
                }
            });
        }).catch(function(err) {
            console.error('App init error:', err);
            loadingScreen.style.display = 'none';
            // Show login as fallback
            App.Login.show();
        });
    };

    /**
     * Called after successful login from Login screen.
     */
    App.onLoginSuccess = function() {
        App.Login.hide();
        App.init();
    };

    /**
     * Setup navigation bar focus group and key handling.
     */
    App._setupNav = function() {
        var navItems = document.querySelectorAll('#nav-bar .nav-item');
        if (!navItems.length) return;

        var itemsArray = [];
        for (var i = 0; i < navItems.length; i++) {
            itemsArray.push(navItems[i]);
        }

        if (App.Focus && App.Focus.registerGroup) {
            App.Focus.registerGroup('nav', itemsArray, {
                orientation: 'horizontal',
                onFocus: function(item) {
                    // Add focused class to current, remove from others
                    itemsArray.forEach(function(el) { el.classList.remove('focused'); });
                    item.classList.add('focused');
                },
                onSelect: function(item) {
                    var view = item.getAttribute('data-view');
                    App._onNavSelect(view, itemsArray);
                }
            });
        }

    };

    /**
     * Handle nav item selection.
     */
    App._onNavSelect = function(view, navItems) {
        // Update active state on nav items
        navItems.forEach(function(el) {
            el.classList.remove('active');
            if (el.getAttribute('data-view') === view) {
                el.classList.add('active');
            }
        });

        var currentState = App.Router.getCurrentState();

        if (view === 'search') {
            // Navigate to Search via Router so BACK works correctly
            if (currentState !== 'SEARCH') {
                App.Router.navigate('SEARCH');
            }
            return;
        }

        // If currently in Search, hide it and return to HOME
        if (currentState === 'SEARCH') {
            App.Router.clearStack();
            // Set the desired section BEFORE replacing so Home.show only renders once
            if (view === 'home') {
                App.Home._currentSection = 'movies';
            } else if (view === 'series') {
                App.Home._currentSection = 'series';
            } else if (view === 'favorites') {
                App.Home._currentSection = 'favorites';
            }
            App.Router.replace('HOME');
            return;
        }

        // Already in HOME - just switch section
        if (view === 'home') {
            App.Home.switchSection('movies');
        } else if (view === 'series') {
            App.Home.switchSection('series');
        } else if (view === 'favorites') {
            App.Home.switchSection('favorites');
        }
    };

    /**
     * Navigate from nav bar to content area (DOWN key).
     * Called by Focus module when DOWN is pressed on nav group.
     */
    App.focusContent = function() {
        if (App.Home && App.Home._carousels && App.Home._carousels.length > 0) {
            var firstCarousel = App.Home._carousels[0];
            if (firstCarousel && firstCarousel.groupId) {
                App.Focus.setActiveGroup(firstCarousel.groupId, 0);
            }
        }
    };

    // ---- Start the app when DOM is ready ----
    document.addEventListener('DOMContentLoaded', function() {
        App.init();
    });
})();
