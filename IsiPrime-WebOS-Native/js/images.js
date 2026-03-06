/**
 * IsiPrime webOS App - Lazy Image Loader
 * Direct loading with concurrent load limiting and timeout protection.
 * Images use data-src attribute; src is set when enqueued.
 *
 * Timeout guards against stuck loads: if an image is removed from DOM
 * mid-load (e.g., carousel scroll), the browser may cancel without firing
 * onload/onerror — the timeout ensures _loading always decrements.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Images = {
        _observer: null,
        _loading: 0,
        _queue: [],
        _prefetched: {},
        MAX_CONCURRENT: 20,
        LOAD_TIMEOUT: 15000,

        /**
         * Initialize the image loader (no-op, kept for API compatibility).
         */
        init: function() {},

        /**
         * Start observing an image element.
         * The element must have a data-src attribute.
         */
        observe: function(img) {
            if (!img || !img.dataset.src) return;
            // Load directly with concurrency limit (IntersectionObserver unreliable on some webOS)
            this._enqueueImage(img);
        },

        /**
         * Stop observing an image element (no-op, kept for API compatibility).
         */
        unobserve: function() {},

        /**
         * Add image to load queue or load immediately if under limit.
         */
        _enqueueImage: function(img) {
            if (this._loading >= this.MAX_CONCURRENT) {
                this._queue.push(img);
            } else {
                this._loadImage(img);
            }
        },

        /**
         * Load a single image from its data-src.
         * Includes timeout to prevent stuck counter when DOM elements are removed mid-load.
         */
        _loadImage: function(img) {
            var self = this;
            var src = img.dataset.src;

            if (!src) return;

            this._loading++;

            var done = false;
            function finish(success) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                if (success) img.classList.add('loaded');
                img.onload = null;
                img.onerror = null;
                self._loading--;
                self._processQueue();
            }

            img.onload = function() { finish(true); };
            img.onerror = function() { finish(false); };

            // Timeout: if neither onload nor onerror fires (e.g., element removed from DOM),
            // force-finish to unblock the queue
            var timer = setTimeout(function() { finish(false); }, this.LOAD_TIMEOUT);

            img.src = src;
        },

        /**
         * Process queued images if under concurrent limit.
         */
        _processQueue: function() {
            while (this._queue.length > 0 && this._loading < this.MAX_CONCURRENT) {
                this._loadImage(this._queue.shift());
            }
        },

        /**
         * Prefetch images into browser cache (no DOM needed).
         * Limits _prefetched to MAX_PREFETCHED entries to prevent unbounded growth.
         * @param {Array} urls - Array of image URLs to prefetch.
         */
        MAX_PREFETCHED: 200,
        prefetch: function(urls) {
            if (!urls || !urls.length) return;
            // Evict oldest entries if over limit
            var keys = Object.keys(this._prefetched);
            if (keys.length > this.MAX_PREFETCHED) {
                var toRemove = keys.length - this.MAX_PREFETCHED + urls.length;
                for (var r = 0; r < toRemove && r < keys.length; r++) {
                    delete this._prefetched[keys[r]];
                }
            }
            for (var i = 0; i < urls.length; i++) {
                if (!urls[i] || this._prefetched[urls[i]]) continue;
                this._prefetched[urls[i]] = true;
                var img = new Image();
                img.src = urls[i];
            }
        },

        /**
         * Flush all image state to free memory.
         * Clears queue, prefetch cache, and resets loading counter.
         */
        flush: function() {
            this._queue = [];
            this._prefetched = {};
            this._loading = 0;
        },

        /**
         * Clear all queued images (e.g., on view change).
         */
        clearQueue: function() {
            this._queue = [];
        },

        /**
         * Destroy observer.
         */
        destroy: function() {
            this._queue = [];
            this._loading = 0;
            this._prefetched = {};
        }
    };
})();
