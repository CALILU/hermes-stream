/**
 * IsiPrime webOS App - Virtual Carousel
 * Horizontal carousel that only renders visible items + buffer.
 * Uses absolute positioning and GPU-accelerated transform for scrolling.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Carousel = {
        /**
         * Create a new carousel instance.
         *
         * @param {HTMLElement} container - DOM element to render the carousel into.
         * @param {Array} items - Array of data objects (movies, series, etc.).
         * @param {Object} opts - Configuration:
         *   groupId: string - Focus group ID for this carousel.
         *   itemWidth: number - Width of each item in px (default: Config.POSTER_WIDTH).
         *   gap: number - Gap between items in px (default: Config.POSTER_GAP).
         *   onSelect: function(item, index) - Called when OK is pressed on an item.
         *   onFocus: function(item, index) - Called when an item gains focus.
         *   renderItem: function(item, index) - Creates and returns a DOM element for the item.
         *   orientation: string - Focus group orientation (default: 'horizontal').
         *
         * @returns {Object} Carousel instance with methods.
         */
        create: function(container, items, opts) {
            opts = opts || {};

            var itemWidth = opts.itemWidth || App.Config.POSTER_WIDTH;
            var gap = opts.gap || App.Config.POSTER_GAP;
            var totalItemWidth = itemWidth + gap;
            var bufferCount = opts.buffer || App.Config.VISIBLE_BUFFER;
            var containerWidth = container.offsetWidth || 1800; // fallback to ~full screen

            // Create track element
            var track = document.createElement('div');
            track.className = 'carousel-track';
            track.style.width = (items.length * totalItemWidth) + 'px';
            container.appendChild(track);

            var instance = {
                _container: container,
                _track: track,
                _items: items,
                _opts: opts,
                _rendered: {},         // { index: { element, item } }
                _focusIndex: 0,
                _itemWidth: itemWidth,
                _gap: gap,
                _totalItemWidth: totalItemWidth,
                _containerWidth: containerWidth,
                _bufferCount: bufferCount,
                _focusElements: [],    // sparse array of focusable elements
                _destroyed: false,
                _scrollTimer: null,       // Auto-scroll timer for Magic Remote edge zones
                _lastMouseX: 0,           // Last mouse X position in container

                /**
                 * Initial render of visible items.
                 */
                init: function() {
                    this._containerWidth = this._container.offsetWidth || 1800;
                    this._updateVisibleItems();
                    this._registerFocusGroup();
                    this._setupEdgeScroll();
                },

                /**
                 * Focus on item at given index.
                 * Centers the item in the viewport and updates rendered items.
                 */
                focusAt: function(index) {
                    if (this._destroyed) return;
                    if (index < 0) index = 0;
                    if (index >= this._items.length) index = this._items.length - 1;

                    this._focusIndex = index;

                    // Calculate scroll offset to center the focused item
                    // Leave some padding on the left (60px for genre-row padding)
                    var leftPadding = 0;
                    var itemCenter = index * this._totalItemWidth + this._itemWidth / 2;
                    var offset = itemCenter - this._containerWidth / 2;

                    // Clamp offset
                    var maxOffset = Math.max(0, this._items.length * this._totalItemWidth - this._containerWidth);
                    if (offset < 0) offset = 0;
                    if (offset > maxOffset) offset = maxOffset;

                    // Apply GPU-accelerated transform
                    this._track.style.transform = 'translate3d(' + (-offset) + 'px, 0, 0)';

                    // Update visible items based on new offset
                    this._currentOffset = offset;
                    this._updateVisibleItems();

                    // Update focus visual on items
                    this._updateItemFocus(index);

                    // Prefetch poster images ahead of scroll direction
                    this._prefetchAhead(index);
                },

                /**
                 * Calculate which items should be visible and render/remove them.
                 */
                _updateVisibleItems: function() {
                    var offset = this._currentOffset || 0;
                    var visibleStart = Math.floor(offset / this._totalItemWidth) - this._bufferCount;
                    var visibleEnd = Math.ceil((offset + this._containerWidth) / this._totalItemWidth) + this._bufferCount;

                    if (visibleStart < 0) visibleStart = 0;
                    if (visibleEnd >= this._items.length) visibleEnd = this._items.length - 1;

                    // Remove items outside visible range
                    var toRemove = [];
                    for (var key in this._rendered) {
                        if (this._rendered.hasOwnProperty(key)) {
                            var idx = parseInt(key, 10);
                            if (idx < visibleStart || idx > visibleEnd) {
                                toRemove.push(idx);
                            }
                        }
                    }
                    for (var r = 0; r < toRemove.length; r++) {
                        this._removeItem(toRemove[r]);
                    }

                    // Add items inside visible range
                    for (var i = visibleStart; i <= visibleEnd; i++) {
                        if (!this._rendered[i]) {
                            this._addItem(i);
                        }
                    }
                },

                /**
                 * Add (render) an item at given index.
                 */
                _addItem: function(index) {
                    if (index < 0 || index >= this._items.length) return;
                    var self = this;

                    var item = this._items[index];
                    var el;

                    if (this._opts.renderItem) {
                        el = this._opts.renderItem(item, index);
                    } else {
                        el = this._defaultRenderItem(item, index);
                    }

                    // Position absolutely
                    el.style.position = 'absolute';
                    el.style.left = (index * this._totalItemWidth) + 'px';
                    el.style.top = '0';
                    el.style.width = this._itemWidth + 'px';
                    el.setAttribute('data-index', index);

                    this._track.appendChild(el);
                    this._rendered[index] = { element: el, item: item };
                    this._focusElements[index] = el;

                    // Click/pointer support (webOS Magic Remote)
                    (function(idx, itm) {
                        el.addEventListener('click', function(e) {
                            e.stopPropagation();
                            if (self._opts.onSelect) {
                                self._opts.onSelect(itm, idx);
                            }
                        });
                        el.addEventListener('mouseenter', function() {
                            // Update focus visual without centering/scrolling
                            self._focusIndex = idx;
                            self._updateItemFocus(idx);
                            // Set this carousel's focus group as active
                            if (self._opts.groupId && App.Focus.setActiveGroup) {
                                App.Focus.setActiveGroup(self._opts.groupId, null);
                            }
                            if (self._opts.onFocus) {
                                self._opts.onFocus(itm, idx);
                            }
                            // Show hover tooltip
                            var title = itm.title || itm.name || itm.seriesName || '';
                            if (title) App._showHoverTooltip(title, el);
                        });
                        el.addEventListener('mouseleave', function() {
                            App._hideHoverTooltip();
                        });
                    })(index, item);

                    // Observe images for lazy loading
                    var img = el.querySelector('.poster-img');
                    if (img && img.dataset.src && App.Images) {
                        App.Images.observe(img);
                    }
                },

                /**
                 * Remove an item from the DOM.
                 */
                _removeItem: function(index) {
                    var entry = this._rendered[index];
                    if (!entry) return;

                    // Unobserve image
                    var img = entry.element.querySelector('.poster-img');
                    if (img && App.Images) {
                        App.Images.unobserve(img);
                    }

                    entry.element.parentNode.removeChild(entry.element);
                    delete this._rendered[index];
                    delete this._focusElements[index];
                },

                /**
                 * Default item renderer (creates a poster card).
                 */
                _defaultRenderItem: function(item, index) {
                    var div = document.createElement('div');
                    div.className = 'carousel-item focusable';

                    var posterUrl = App.Config.posterUrl(
                        item.poster || item.poster_path || item.posterPath || '',
                        'w342'
                    );

                    var title = item.title || item.name || item.seriesName || 'Sin título';

                    var html = '<div class="poster-wrapper">' +
                        '<img class="poster-img" data-src="' + posterUrl + '" alt="' + this._escapeAttr(title) + '">' +
                        '</div>' +
                        '<div class="poster-title">' + this._escapeHtml(title) + '</div>';

                    // Progress bar
                    var progress = item.progress || item.watchProgress || 0;
                    if (progress > 0) {
                        html += '<div class="poster-progress" style="width:' + Math.round(progress * 100) + '%"></div>';
                    }

                    div.innerHTML = html;
                    return div;
                },

                /**
                 * Update focus visual on carousel items.
                 */
                _updateItemFocus: function(focusedIndex) {
                    // Remove focused from all rendered items
                    for (var key in this._rendered) {
                        if (this._rendered.hasOwnProperty(key)) {
                            this._rendered[key].element.classList.remove('focused');
                        }
                    }

                    // Add focused to current
                    if (this._rendered[focusedIndex]) {
                        this._rendered[focusedIndex].element.classList.add('focused');
                    }
                },

                /**
                 * Register this carousel as a focus group.
                 */
                _registerFocusGroup: function() {
                    if (!this._opts.groupId) return;

                    var self = this;

                    // Build elements array for focus group - use a proxy approach
                    // Since elements are virtual, we manage focus ourselves
                    App.Focus.registerGroup(this._opts.groupId, this._getRenderedElements(), {
                        orientation: this._opts.orientation || 'horizontal',
                        onFocus: function(el, index) {
                            // Map from rendered element to actual carousel index
                            var carouselIndex = parseInt(el.getAttribute('data-index'), 10);
                            if (isNaN(carouselIndex)) carouselIndex = index;
                            self.focusAt(carouselIndex);
                            if (self._opts.onFocus) {
                                self._opts.onFocus(self._items[carouselIndex], carouselIndex);
                            }
                        },
                        onSelect: function(el, index) {
                            var carouselIndex = parseInt(el.getAttribute('data-index'), 10);
                            if (isNaN(carouselIndex)) carouselIndex = index;
                            if (self._opts.onSelect) {
                                self._opts.onSelect(self._items[carouselIndex], carouselIndex);
                            }
                        }
                    });

                    // Override the focus group's move to handle virtual scrolling
                    this._hookFocusGroup();
                },

                /**
                 * Hook into the focus system for virtual scrolling.
                 * Override how LEFT/RIGHT moves within this carousel.
                 */
                _hookFocusGroup: function() {
                    var self = this;
                    var groupId = this._opts.groupId;
                    var group = App.Focus._groups[groupId];
                    if (!group) return;

                    // Store reference to ourselves for the focus system
                    group._carousel = self;

                    // Replace elements with a virtual proxy
                    // The focus system will call our onFocus with the virtual index
                    this._updateFocusElements();
                },

                /**
                 * Update the focus group's element list with currently rendered items.
                 * Called after rendering changes.
                 */
                _updateFocusElements: function() {
                    if (!this._opts.groupId) return;

                    var elements = this._getRenderedElements();
                    App.Focus.updateGroupElements(this._opts.groupId, elements);

                    // Set the correct current index within the focus group
                    // Find which rendered element corresponds to our _focusIndex
                    var group = App.Focus._groups[this._opts.groupId];
                    if (group && App.Focus._currentGroup === this._opts.groupId) {
                        for (var i = 0; i < elements.length; i++) {
                            var idx = parseInt(elements[i].getAttribute('data-index'), 10);
                            if (idx === this._focusIndex) {
                                App.Focus._currentIndex = i;
                                break;
                            }
                        }
                    }
                },

                /**
                 * Get sorted array of currently rendered elements.
                 */
                _getRenderedElements: function() {
                    var elements = [];
                    for (var key in this._rendered) {
                        if (this._rendered.hasOwnProperty(key)) {
                            elements.push({
                                idx: parseInt(key, 10),
                                el: this._rendered[key].element
                            });
                        }
                    }
                    elements.sort(function(a, b) { return a.idx - b.idx; });
                    return elements.map(function(e) { return e.el; });
                },

                /**
                 * Get the items array.
                 */
                getItems: function() {
                    return this._items;
                },

                /**
                 * Get current focus index.
                 */
                getFocusIndex: function() {
                    return this._focusIndex;
                },

                /**
                 * Replace items array and re-render.
                 */
                updateItems: function(newItems) {
                    // Clear all rendered
                    for (var key in this._rendered) {
                        if (this._rendered.hasOwnProperty(key)) {
                            this._removeItem(parseInt(key, 10));
                        }
                    }

                    this._items = newItems;
                    this._track.style.width = (newItems.length * this._totalItemWidth) + 'px';
                    this._focusIndex = 0;
                    this._currentOffset = 0;
                    this._track.style.transform = 'translate3d(0, 0, 0)';

                    this._updateVisibleItems();
                    this._updateFocusElements();
                },

                /**
                 * Destroy this carousel: remove from DOM, unregister focus group.
                 */
                destroy: function() {
                    this._destroyed = true;

                    // Stop edge-scroll timer
                    if (this._scrollTimer) {
                        clearInterval(this._scrollTimer);
                        this._scrollTimer = null;
                    }

                    // Unregister focus group
                    if (this._opts.groupId) {
                        App.Focus.unregisterGroup(this._opts.groupId);
                    }

                    // Remove all rendered items
                    for (var key in this._rendered) {
                        if (this._rendered.hasOwnProperty(key)) {
                            this._removeItem(parseInt(key, 10));
                        }
                    }

                    // Remove track from container
                    if (this._track.parentNode) {
                        this._track.parentNode.removeChild(this._track);
                    }

                    this._rendered = {};
                    this._focusElements = [];
                    this._items = [];
                },

                /**
                 * Setup Magic Remote edge-scroll zones.
                 * When cursor is near left/right edge of the carousel container,
                 * auto-scroll the carousel in that direction.
                 */
                _setupEdgeScroll: function() {
                    var self = this;
                    var EDGE_ZONE = 200; // px from edge to trigger scroll
                    var SCROLL_INTERVAL = 250; // ms between scroll steps

                    this._container.addEventListener('mousemove', function(e) {
                        var rect = self._container.getBoundingClientRect();
                        var x = e.clientX - rect.left;
                        self._lastMouseX = x;

                        var inRightZone = x > (rect.width - EDGE_ZONE);
                        var inLeftZone = x < EDGE_ZONE;

                        if (inRightZone || inLeftZone) {
                            if (!self._scrollTimer) {
                                var dir = inRightZone ? 1 : -1;
                                self._scrollTimer = setInterval(function() {
                                    var newIdx = self._focusIndex + dir;
                                    if (newIdx < 0 || newIdx >= self._items.length) {
                                        clearInterval(self._scrollTimer);
                                        self._scrollTimer = null;
                                        return;
                                    }
                                    self.focusAt(newIdx);
                                }, SCROLL_INTERVAL);
                            }
                        } else {
                            if (self._scrollTimer) {
                                clearInterval(self._scrollTimer);
                                self._scrollTimer = null;
                            }
                        }
                    });

                    this._container.addEventListener('mouseleave', function() {
                        if (self._scrollTimer) {
                            clearInterval(self._scrollTimer);
                            self._scrollTimer = null;
                        }
                    });
                },

                /**
                 * Prefetch poster images beyond the visible+buffer range.
                 * Pre-downloads the next 10 posters so they're in browser cache
                 * when the user scrolls to them.
                 */
                _prefetchAhead: function(focusIndex) {
                    if (!App.Images || !App.Images.prefetch) return;
                    var ahead = 10;
                    var urls = [];
                    // Prefetch forward
                    var startFwd = Math.ceil((this._currentOffset + this._containerWidth) / this._totalItemWidth) + this._bufferCount + 1;
                    for (var i = startFwd; i < startFwd + ahead && i < this._items.length; i++) {
                        var item = this._items[i];
                        var url = App.Config.posterUrl(
                            item.poster || item.poster_path || item.posterPath || '', 'w342'
                        );
                        if (url && url !== 'assets/placeholder.svg') urls.push(url);
                    }
                    // Prefetch backward
                    var startBwd = Math.floor(this._currentOffset / this._totalItemWidth) - this._bufferCount - 1;
                    for (var j = startBwd; j > startBwd - ahead && j >= 0; j--) {
                        var itm = this._items[j];
                        var u = App.Config.posterUrl(
                            itm.poster || itm.poster_path || itm.posterPath || '', 'w342'
                        );
                        if (u && u !== 'assets/placeholder.svg') urls.push(u);
                    }
                    if (urls.length > 0) App.Images.prefetch(urls);
                },

                /**
                 * Escape HTML entities.
                 */
                _escapeHtml: function(text) {
                    var div = document.createElement('div');
                    div.appendChild(document.createTextNode(text));
                    return div.innerHTML;
                },

                /**
                 * Escape attribute value.
                 */
                _escapeAttr: function(text) {
                    return String(text)
                        .split('&').join('&amp;')
                        .split('"').join('&quot;')
                        .split("'").join('&#39;')
                        .split('<').join('&lt;')
                        .split('>').join('&gt;');
                }
            };

            // Initialize
            instance.init();

            return instance;
        }
    };
})();
