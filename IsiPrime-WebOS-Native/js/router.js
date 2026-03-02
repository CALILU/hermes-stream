/**
 * IsiPrime webOS App - Router / State Machine
 * Manages view transitions and navigation history.
 *
 * States: LOADING, LOGIN, HOME, GENRE, YEARS, DETAIL, PLAYER, SERIES, SEARCH, ACTOR, REQUESTS
 *
 * Each view module must implement:
 *   show(data) - display the view with given data
 *   hide()     - hide the view and clean up
 */
(function() {
    'use strict';

    window.App = window.App || {};

    // View state constants
    var STATES = {
        LOADING: 'LOADING',
        LOGIN: 'LOGIN',
        HOME: 'HOME',
        GENRE: 'GENRE',
        YEARS: 'YEARS',
        SAGAS: 'SAGAS',
        DETAIL: 'DETAIL',
        PLAYER: 'PLAYER',
        SERIES: 'SERIES',
        SEARCH: 'SEARCH',
        ACTOR: 'ACTOR',
        REQUESTS: 'REQUESTS'
    };

    App.Router = {
        STATES: STATES,

        _stack: [],        // navigation history stack: [{ state, data }]
        _current: null,    // current state string
        _currentData: null, // current state data
        _backHandler: null,

        /**
         * Initialize router. Sets up global BACK key listener.
         */
        init: function() {
            var self = this;
            this._backHandler = function(e) {
                if (e.keyCode === App.Config.KEYS.BACK) {
                    e.preventDefault();
                    e.stopPropagation();
                    self.back();
                }
            };
            document.addEventListener('keydown', this._backHandler);
        },

        /**
         * Navigate to a new state.
         *
         * @param {string} state - Target state (from STATES).
         * @param {Object} data - Optional data to pass to the view.
         */
        navigate: function(state, data) {
            // Push current state to stack (if any)
            if (this._current && this._current !== STATES.LOADING && this._current !== STATES.LOGIN) {
                this._stack.push({
                    state: this._current,
                    data: this._currentData
                });
            }

            this._switchTo(state, data);
        },

        /**
         * Go back to previous state.
         * If stack is empty and current is HOME, exit the app (webOS).
         */
        back: function() {
            // Special case: PLAYER view may handle BACK internally
            if (this._current === STATES.PLAYER && App.Player && typeof App.Player.onBack === 'function') {
                var handled = App.Player.onBack();
                if (handled) return;
            }

            if (this._stack.length > 0) {
                var prev = this._stack.pop();
                this._switchTo(prev.state, prev.data, true);
            } else if (this._current === STATES.HOME) {
                // Exit app on webOS
                this._exitApp();
            } else {
                // Default: go to HOME
                this._switchTo(STATES.HOME, null, true);
            }
        },

        /**
         * Get current state.
         */
        getCurrentState: function() {
            return this._current;
        },

        /**
         * Clear navigation stack.
         */
        clearStack: function() {
            this._stack = [];
        },

        /**
         * Replace current state without pushing to history.
         */
        replace: function(state, data) {
            this._switchTo(state, data);
        },

        /**
         * Internal: switch from current view to target view.
         */
        _switchTo: function(state, data, isBack) {
            // Always hide tooltip on navigation
            App._hideHoverTooltip();

            // Hide current view
            if (this._current) {
                this._hideView(this._current);
            }

            this._current = state;
            this._currentData = data || null;

            // Show target view
            this._showView(state, data, isBack);

            // Update nav bar active state
            this._updateNavBar(state);
        },

        /**
         * Show a view by state name.
         */
        _showView: function(state, data, isBack) {
            switch (state) {
                case STATES.LOADING:
                    document.getElementById('loading-screen').style.display = 'flex';
                    break;

                case STATES.LOGIN:
                    document.getElementById('loading-screen').style.display = 'none';
                    App.Login.show();
                    break;

                case STATES.HOME:
                    this._ensureAppContainer();
                    if (App.Home && typeof App.Home.show === 'function') {
                        App.Home.show(data);
                    }
                    break;

                case STATES.GENRE:
                    this._ensureAppContainer();
                    if (App.Genre && typeof App.Genre.show === 'function') {
                        App.Genre.show(data, isBack);
                    }
                    break;

                case STATES.YEARS:
                    this._ensureAppContainer();
                    if (App.Years && typeof App.Years.show === 'function') {
                        App.Years.show(data, isBack);
                    }
                    break;

                case STATES.SAGAS:
                    this._ensureAppContainer();
                    if (App.Sagas && typeof App.Sagas.show === 'function') {
                        App.Sagas.show(data, isBack);
                    }
                    break;

                case STATES.DETAIL:
                    if (App.Detail && typeof App.Detail.show === 'function') {
                        App.Detail.show(data);
                    }
                    break;

                case STATES.PLAYER:
                    if (App.Player && typeof App.Player.show === 'function') {
                        App.Player.show(data);
                    }
                    break;

                case STATES.SERIES:
                    if (App.Series && typeof App.Series.show === 'function') {
                        App.Series.show(data);
                    }
                    break;

                case STATES.SEARCH:
                    if (App.Search && typeof App.Search.show === 'function') {
                        App.Search.show(data);
                    }
                    break;

                case STATES.ACTOR:
                    if (App.Actor && typeof App.Actor.show === 'function') {
                        App.Actor.show(data);
                    }
                    break;

                case STATES.REQUESTS:
                    if (App.Requests && typeof App.Requests.show === 'function') {
                        App.Requests.show(data);
                    }
                    break;
            }
        },

        /**
         * Hide a view by state name.
         */
        _hideView: function(state) {
            switch (state) {
                case STATES.LOADING:
                    document.getElementById('loading-screen').style.display = 'none';
                    break;

                case STATES.LOGIN:
                    App.Login.hide();
                    break;

                case STATES.HOME:
                    if (App.Home && typeof App.Home.hide === 'function') {
                        App.Home.hide();
                    }
                    break;

                case STATES.GENRE:
                    if (App.Genre && typeof App.Genre.hide === 'function') {
                        App.Genre.hide();
                    }
                    break;

                case STATES.YEARS:
                    if (App.Years && typeof App.Years.hide === 'function') {
                        App.Years.hide();
                    }
                    break;

                case STATES.SAGAS:
                    if (App.Sagas && typeof App.Sagas.hide === 'function') {
                        App.Sagas.hide();
                    }
                    break;

                case STATES.DETAIL:
                    if (App.Detail && typeof App.Detail.hide === 'function') {
                        App.Detail.hide();
                    }
                    break;

                case STATES.PLAYER:
                    if (App.Player && typeof App.Player.hide === 'function') {
                        App.Player.hide();
                    }
                    break;

                case STATES.SERIES:
                    if (App.Series && typeof App.Series.hide === 'function') {
                        App.Series.hide();
                    }
                    break;

                case STATES.SEARCH:
                    if (App.Search && typeof App.Search.hide === 'function') {
                        App.Search.hide();
                    }
                    break;

                case STATES.ACTOR:
                    if (App.Actor && typeof App.Actor.hide === 'function') {
                        App.Actor.hide();
                    }
                    break;

                case STATES.REQUESTS:
                    if (App.Requests && typeof App.Requests.hide === 'function') {
                        App.Requests.hide();
                    }
                    break;
            }
        },

        /**
         * Ensure app container is visible (called when transitioning from LOGIN to HOME).
         */
        _ensureAppContainer: function() {
            var appContainer = document.getElementById('app-container');
            if (appContainer.style.display === 'none') {
                appContainer.style.display = '';
            }
            document.getElementById('loading-screen').style.display = 'none';
        },

        /**
         * Update nav bar active item based on current state.
         */
        _updateNavBar: function(state) {
            var navItems = document.querySelectorAll('.nav-item');
            for (var i = 0; i < navItems.length; i++) {
                navItems[i].classList.remove('active');
            }

            // Map state to nav data-view
            var viewMap = {};
            viewMap[STATES.HOME] = 'home';
            viewMap[STATES.GENRE] = 'genres';
            viewMap[STATES.YEARS] = 'years';
            viewMap[STATES.SAGAS] = 'sagas';
            viewMap[STATES.SERIES] = 'series';
            viewMap[STATES.SEARCH] = 'search';
            viewMap[STATES.REQUESTS] = 'requests';

            var viewName = viewMap[state];
            if (viewName) {
                var activeNav = document.querySelector('.nav-item[data-view="' + viewName + '"]');
                if (activeNav) {
                    activeNav.classList.add('active');
                }
            }
        },

        /**
         * Exit the app on webOS.
         */
        _exitApp: function() {
            // webOS platform back (exits app)
            if (window.webOS && window.webOS.platformBack) {
                window.webOS.platformBack();
            } else if (window.webOSDev && window.webOSDev.platformBack) {
                window.webOSDev.platformBack();
            } else {
                // Fallback: try to close
                try {
                    window.close();
                } catch (e) {
                    // Cannot close
                }
            }
        }
    };
})();
