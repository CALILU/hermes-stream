/**
 * IsiPrime webOS App - Configuration
 * Global constants and helpers.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Config = {
        SERVER_URL: localStorage.getItem('isiprime_server_url') || 'http://192.168.1.45:8080',
        APP_VERSION: '2.12.0',

        KEYS: {
            LEFT: 37,
            UP: 38,
            RIGHT: 39,
            DOWN: 40,
            OK: 13,
            BACK: 461,
            EXIT: 10182,
            RED: 403,
            GREEN: 404,
            YELLOW: 405,
            BLUE: 406,
            PLAY: 415,
            PAUSE: 19,
            STOP: 413,
            FF: 417,
            RW: 412
        },

        POSTER_WIDTH: 230,
        POSTER_GAP: 16,
        VISIBLE_BUFFER: 5,
        PROGRESS_SAVE_INTERVAL: 10000,

        PLACEHOLDER_IMG: 'assets/placeholder.svg',
        TMDB_IMG: 'https://image.tmdb.org/t/p/',

        posterUrl: function(path, size) {
            if (!path) return this.PLACEHOLDER_IMG;
            // Proxy URL from server (/api/img/w342/xxx.jpg)
            if (path.indexOf('/api/img/') === 0) return this.SERVER_URL + path;
            if (path.indexOf('http') === 0) return path;
            return this.TMDB_IMG + (size || 'w342') + path;
        },

        backdropUrl: function(path) {
            if (!path) return '';
            // Proxy URL from server (/api/img/w780/xxx.jpg)
            if (path.indexOf('/api/img/') === 0) return this.SERVER_URL + path;
            if (path.indexOf('http') === 0) return path;
            return this.TMDB_IMG + 'w1280' + path;
        }
    };
})();
