/**
 * IsiPrime webOS App - Configuration
 * Global constants and helpers.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Config = {
        SERVER_URL: localStorage.getItem('isiprime_server_url') || 'http://192.168.1.18:8080',

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

        POSTER_WIDTH: 160,
        POSTER_GAP: 12,
        VISIBLE_BUFFER: 2,
        PROGRESS_SAVE_INTERVAL: 10000,

        TMDB_IMG: 'https://image.tmdb.org/t/p/',

        posterUrl: function(path, size) {
            return path ? this.TMDB_IMG + (size || 'w342') + path : 'assets/placeholder.svg';
        },

        backdropUrl: function(path) {
            return path ? this.TMDB_IMG + 'w1280' + path : '';
        }
    };
})();
