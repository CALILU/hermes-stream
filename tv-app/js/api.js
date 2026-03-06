/**
 * IsiPrime webOS App - API Client
 * HTTP client with JWT authentication and auto-refresh.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.API = {
        _accessToken: null,
        _refreshToken: localStorage.getItem('isiprime_refresh_token') || null,
        _isLocal: false,
        _refreshing: null,
        _tvSerial: null,
        _tvModel: null,

        /**
         * Initialize: detect TV serial number, then check LAN auth.
         * Returns true if locally authenticated.
         */
        init: function() {
            var self = this;
            return this._detectTVSerial().then(function() {
                return fetch(App.Config.SERVER_URL + '/api/auth/status', {
                    credentials: 'include',
                    headers: self._serialHeader()
                });
            })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                self._isLocal = data.authenticated === true;
                if (data.user) {
                    self._username = data.user.username || null;
                    self._userRole = data.user.role || null;
                }
                return self._isLocal;
            })
            .catch(function() {
                return false;
            });
        },

        /**
         * Detect TV serial number via webOS Luna API.
         * Falls back gracefully if not running on webOS.
         */
        _detectTVSerial: function() {
            var self = this;
            // Check localStorage cache first
            var cached = localStorage.getItem('isiprime_tv_serial');
            if (cached) {
                self._tvSerial = cached;
                self._tvModel = localStorage.getItem('isiprime_tv_model');
                return Promise.resolve();
            }
            // Load cached model even without serial
            self._tvModel = localStorage.getItem('isiprime_tv_model');

            // Not on webOS — skip
            if (typeof webOS === 'undefined' && typeof PalmSystem === 'undefined') {
                return Promise.resolve();
            }

            return new Promise(function(resolve) {
                var resolved = false;
                var done = function(serial) {
                    if (resolved) return;
                    resolved = true;
                    if (serial) {
                        self._tvSerial = serial;
                        localStorage.setItem('isiprime_tv_serial', serial);
                        console.log('[API] TV serial: ' + serial);
                    }
                    resolve();
                };

                // Strategy 1: PalmSystem.deviceInfo (sync, available on all webOS)
                if (typeof PalmSystem !== 'undefined' && PalmSystem.deviceInfo) {
                    try {
                        var info = JSON.parse(PalmSystem.deviceInfo);
                        if (info.modelName) {
                            self._tvModel = info.modelName;
                            localStorage.setItem('isiprime_tv_model', info.modelName);
                        }
                        if (info.serialNumber) {
                            done(info.serialNumber);
                            return;
                        }
                    } catch (e) { /* continue */ }
                }

                // Strategy 2: webOS.deviceInfo callback (webOSTV.js)
                if (typeof webOS !== 'undefined' && webOS.deviceInfo) {
                    try {
                        webOS.deviceInfo(function(info) {
                            if (info && info.serialNumber) {
                                done(info.serialNumber);
                            } else {
                                self._lunaGetSerial(done);
                            }
                        });
                    } catch (e) {
                        self._lunaGetSerial(done);
                    }
                } else {
                    self._lunaGetSerial(done);
                }

                // Timeout: don't block init
                setTimeout(function() { done(null); }, 2000);
            });
        },

        /**
         * Try Luna Service to get serial number.
         */
        _lunaGetSerial: function(cb) {
            if (typeof webOS === 'undefined' || !webOS.service || !webOS.service.request) return cb(null);
            try {
                webOS.service.request('luna://com.webos.service.tv.systemproperty', {
                    method: 'getSystemInfo',
                    parameters: { keys: ['serialNumber'] },
                    onSuccess: function(res) { cb(res.serialNumber || null); },
                    onFailure: function() { cb(null); }
                });
            } catch (e) { cb(null); }
        },

        /**
         * Returns header object with TV serial if available.
         */
        _serialHeader: function() {
            var h = {};
            if (this._tvSerial) h['X-TV-Serial'] = this._tvSerial;
            if (this._tvModel) h['X-TV-Model'] = this._tvModel;
            return h;
        },

        /**
         * Check if user has a stored refresh token (can attempt restore).
         */
        hasStoredSession: function() {
            return !!this._refreshToken;
        },

        /**
         * Login for remote users.
         */
        login: function(username, password) {
            var self = this;
            return fetch(App.Config.SERVER_URL + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            })
            .then(function(res) {
                return res.json().then(function(data) {
                    if (!res.ok) throw new Error(data.error || 'Error de login');
                    return data;
                });
            })
            .then(function(data) {
                self._accessToken = data.accessToken;
                self._refreshToken = data.refreshToken;
                localStorage.setItem('isiprime_refresh_token', data.refreshToken);
                return data;
            });
        },

        /**
         * Logout: clear tokens.
         */
        logout: function() {
            this._accessToken = null;
            this._refreshToken = null;
            localStorage.removeItem('isiprime_refresh_token');
        },

        /**
         * Refresh access token using stored refresh token.
         * Deduplicates concurrent refresh calls.
         */
        _refresh: function() {
            if (this._refreshing) return this._refreshing;

            var self = this;
            if (!this._refreshToken) {
                return Promise.reject(new Error('No refresh token'));
            }

            this._refreshing = fetch(App.Config.SERVER_URL + '/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: this._refreshToken })
            })
            .then(function(res) {
                if (!res.ok) {
                    self._accessToken = null;
                    self._refreshToken = null;
                    localStorage.removeItem('isiprime_refresh_token');
                    throw new Error('Session expired');
                }
                return res.json();
            })
            .then(function(data) {
                self._accessToken = data.accessToken;
                self._refreshToken = data.refreshToken;
                localStorage.setItem('isiprime_refresh_token', data.refreshToken);
                self._refreshing = null;
                return data;
            })
            .catch(function(err) {
                self._refreshing = null;
                throw err;
            });

            return this._refreshing;
        },

        /**
         * Restore session from stored refresh token.
         */
        restoreSession: function() {
            if (!this._refreshToken) {
                return Promise.reject(new Error('No stored session'));
            }
            return this._refresh();
        },

        /**
         * Authenticated fetch with auto-refresh on 401.
         */
        _fetch: function(url, opts) {
            var self = this;
            opts = opts || {};
            if (!opts.headers) opts.headers = {};

            // Always send TV identity for user identification
            if (this._tvSerial) opts.headers['X-TV-Serial'] = this._tvSerial;
            if (this._tvModel) opts.headers['X-TV-Model'] = this._tvModel;

            if (this._isLocal) {
                opts.credentials = 'include';
            } else if (this._accessToken) {
                opts.headers['Authorization'] = 'Bearer ' + this._accessToken;
            }

            return fetch(App.Config.SERVER_URL + url, opts).then(function(res) {
                if (res.status === 401 && !self._isLocal && self._refreshToken) {
                    return self._refresh().then(function() {
                        opts.headers['Authorization'] = 'Bearer ' + self._accessToken;
                        return fetch(App.Config.SERVER_URL + url, opts);
                    });
                }
                return res;
            });
        },

        /**
         * Simple XHR GET (webOS 4.0 compatible, no fetch needed).
         * Calls cb(err, data) with parsed JSON.
         */
        _xhrGet: function(url, cb) {
            var x = new XMLHttpRequest();
            x.open('GET', url);
            x.timeout = 3000;
            x.onload = function() {
                try { cb(null, JSON.parse(x.responseText)); }
                catch (e) { cb(e, null); }
            };
            x.onerror = function() { cb(new Error('xhr error'), null); };
            x.ontimeout = function() { cb(new Error('xhr timeout'), null); };
            x.send();
        },

        // --- Movies ---

        getVideos: function() {
            return this._fetch('/api/videos').then(function(r) { return r.json(); });
        },

        getGenres: function() {
            return this._fetch('/api/genres').then(function(r) { return r.json(); });
        },

        // --- User Data ---

        getContinueWatching: function() {
            return this._fetch('/api/continue-watching').then(function(r) { return r.json(); });
        },

        getFavorites: function() {
            return this._fetch('/api/favorites').then(function(r) { return r.json(); });
        },

        toggleFavorite: function(videoPath, add) {
            return this._fetch('/api/favorites', {
                method: add ? 'POST' : 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoPath: videoPath })
            });
        },

        saveProgress: function(videoPath, position, duration) {
            return this._fetch('/api/progress', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoPath: videoPath,
                    position: position,
                    duration: duration
                })
            });
        },

        // --- Series ---

        getSeries: function() {
            return this._fetch('/api/series').then(function(r) { return r.json(); });
        },

        getSeriesDetail: function(tmdbId) {
            return this._fetch('/api/series/' + tmdbId).then(function(r) { return r.json(); });
        },

        getSeasonEpisodes: function(tmdbId, season) {
            return this._fetch('/api/series/' + tmdbId + '/season/' + season).then(function(r) { return r.json(); });
        },

        getSeriesProgress: function(tmdbId) {
            return this._fetch('/api/series/' + tmdbId + '/progress').then(function(r) { return r.json(); });
        },

        markEpisodeWatched: function(tmdbId, season, episode) {
            return this._fetch('/api/series/' + tmdbId + '/episode/' + season + '/' + episode + '/watched', {
                method: 'PUT'
            });
        },

        // --- Stream URLs ---

        streamUrl: function(filename) {
            var base = App.Config.SERVER_URL + '/stream/' + encodeURIComponent(filename);
            if (!this._isLocal && this._accessToken) {
                base += '?token=' + this._accessToken;
            }
            return base;
        },

        // --- Actor Filmography ---

        getActorFilmography: function(actorName) {
            return this._fetch('/api/tmdb/actor?query=' + encodeURIComponent(actorName))
                .then(function(r) { return r.json(); });
        },

        // --- Collections/Sagas ---

        getCollections: function() {
            return this._fetch('/api/collections').then(function(r) { return r.json(); });
        },

        getCollectionFull: function(id) {
            return this._fetch('/api/collections/' + id + '/full').then(function(r) { return r.json(); });
        },

        // --- Requests ---

        searchTMDB: function(query) {
            return this._fetch('/api/tmdb/search?query=' + encodeURIComponent(query))
                .then(function(r) { return r.json(); });
        },

        getRequests: function() {
            return this._fetch('/api/requests').then(function(r) { return r.json(); });
        },

        submitRequests: function(movies, requestedBy) {
            return this._fetch('/api/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ movies: movies, requestedBy: requestedBy || 'TV' })
            }).then(function(r) { return r.json(); });
        },

        updateRequestStatus: function(id, status) {
            return this._fetch('/api/requests/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: status })
            }).then(function(r) { return r.json(); });
        },

        deleteRequest: function(id) {
            return this._fetch('/api/requests/' + id, {
                method: 'DELETE'
            }).then(function(r) { return r.json(); });
        },

        streamSeriesUrl: function(folder, file) {
            var base = App.Config.SERVER_URL + '/stream-series/' + encodeURIComponent(folder) + '/' + encodeURIComponent(file);
            if (!this._isLocal && this._accessToken) {
                base += '?token=' + this._accessToken;
            }
            return base;
        }
    };
})();
