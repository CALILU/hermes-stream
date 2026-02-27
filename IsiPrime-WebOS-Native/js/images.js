/**
 * IsiPrime webOS App - Lazy Image Loader
 * Uses IntersectionObserver with concurrent load limiting.
 * Images use data-src attribute; src is set when visible.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Images = {
        _observer: null,
        _loading: 0,
        _queue: [],
        MAX_CONCURRENT: 10,

        /**
         * Initialize the IntersectionObserver.
         */
        init: function() {
            var self = this;

            if (!('IntersectionObserver' in window)) {
                // Fallback: load all images immediately (shouldn't happen on webOS 6)
                console.warn('IntersectionObserver not available, loading all images');
                return;
            }

            this._observer = new IntersectionObserver(
                function(entries) {
                    self._onIntersect(entries);
                },
                {
                    rootMargin: '800px',
                    threshold: 0
                }
            );
        },

        /**
         * Start observing an image element.
         * The element must have a data-src attribute.
         */
        observe: function(img) {
            if (!img || !img.dataset.src) return;

            if (this._observer) {
                this._observer.observe(img);
            } else {
                // Fallback: load immediately
                this._loadImage(img);
            }
        },

        /**
         * Stop observing an image element.
         */
        unobserve: function(img) {
            if (this._observer && img) {
                this._observer.unobserve(img);
            }
        },

        /**
         * Handle intersection entries.
         */
        _onIntersect: function(entries) {
            var self = this;
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    self._enqueueImage(entry.target);
                    self._observer.unobserve(entry.target);
                }
            });
        },

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
         */
        _loadImage: function(img) {
            var self = this;
            var src = img.dataset.src;

            if (!src) return;

            this._loading++;

            img.onload = function() {
                img.classList.add('loaded');
                img.onload = null;
                img.onerror = null;
                self._loading--;
                self._processQueue();
            };

            img.onerror = function() {
                // Keep placeholder visible on error
                img.onload = null;
                img.onerror = null;
                self._loading--;
                self._processQueue();
            };

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
         * Clear all queued images (e.g., on view change).
         */
        clearQueue: function() {
            this._queue = [];
        },

        /**
         * Destroy observer.
         */
        destroy: function() {
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            this._queue = [];
            this._loading = 0;
        }
    };
})();
