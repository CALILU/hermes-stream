/**
 * IsiPrime webOS App - Virtual Carousel
 * Horizontal carousel that only renders visible items + buffer.
 * Uses absolute positioning and GPU-accelerated transform for scrolling.
 *
 * Edge-scroll: a single global mousemove handler (throttled) detects which
 * carousel the cursor is over and auto-scrolls when near the edges.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    // ── Global edge-scroll system (single listener, shared by all carousels) ──
    var _allCarousels = [];       // all living carousel instances
    var _edgeScrollTimer = null;  // active auto-scroll interval
    var _edgeScrollTarget = null; // carousel being edge-scrolled
    var _edgeScrollDir = 0;       // -1 left, +1 right
    var _throttleLast = 0;
    var EDGE_ZONE = 200;          // px from container edge
    var SCROLL_INTERVAL = 250;    // ms per scroll step
    var THROTTLE_MS = 60;         // min ms between mousemove processing

    function _stopEdgeScroll() {
        if (_edgeScrollTimer) {
            clearInterval(_edgeScrollTimer);
            _edgeScrollTimer = null;
        }
        _edgeScrollTarget = null;
        _edgeScrollDir = 0;
    }

    function _onGlobalMouseMove(e) {
        var now = Date.now();
        if (now - _throttleLast < THROTTLE_MS) return;
        _throttleLast = now;

        // Find which carousel container the cursor is over
        var target = null;
        var cx = e.clientX;
        var cy = e.clientY;

        for (var i = 0; i < _allCarousels.length; i++) {
            var c = _allCarousels[i];
            if (c._destroyed) continue;
            var rect = c._containerRect;
            // Refresh rect periodically (cheap: stored, updated on focus/scroll)
            if (!rect) {
                rect = c._container.getBoundingClientRect();
                c._containerRect = rect;
            }
            if (cy >= rect.top && cy <= rect.bottom && cx >= rect.left && cx <= rect.right) {
                target = c;
                break;
            }
        }

        if (!target) {
            _stopEdgeScroll();
            return;
        }

        var tRect = target._containerRect;
        var localX = cx - tRect.left;
        var inRight = localX > (tRect.width - EDGE_ZONE);
        var inLeft = localX < EDGE_ZONE;

        if (!inRight && !inLeft) {
            _stopEdgeScroll();
            return;
        }

        var dir = inRight ? 1 : -1;

        // Already scrolling this carousel in same direction
        if (_edgeScrollTimer && _edgeScrollTarget === target && _edgeScrollDir === dir) return;

        _stopEdgeScroll();
        _edgeScrollTarget = target;
        _edgeScrollDir = dir;
        _edgeScrollTimer = setInterval(function() {
            if (!_edgeScrollTarget || _edgeScrollTarget._destroyed) {
                _stopEdgeScroll();
                return;
            }
            var newIdx = _edgeScrollTarget._focusIndex + _edgeScrollDir;
            if (newIdx < 0 || newIdx >= _edgeScrollTarget._items.length) {
                _stopEdgeScroll();
                return;
            }
            _edgeScrollTarget.focusAt(newIdx);
        }, SCROLL_INTERVAL);
    }

    // Install single global listener (once)
    var _globalListenerInstalled = false;
    function _ensureGlobalListener() {
        if (_globalListenerInstalled) return;
        _globalListenerInstalled = true;
        document.addEventListener('mousemove', _onGlobalMouseMove);
    }
    function _removeGlobalListener() {
        if (!_globalListenerInstalled) return;
        document.removeEventListener('mousemove', _onGlobalMouseMove);
        _globalListenerInstalled = false;
    }

    // ── Carousel factory ──
    App.Carousel = {
        /**
         * Create a new carousel instance.
         */
        create: function(container, items, opts) {
            opts = opts || {};

            var itemWidth = opts.itemWidth || App.Config.POSTER_WIDTH;
            var gap = opts.gap || App.Config.POSTER_GAP;
            var totalItemWidth = itemWidth + gap;
            var bufferCount = opts.buffer || App.Config.VISIBLE_BUFFER;
            var containerWidth = container.offsetWidth || 1800;

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
                _rendered: {},
                _focusIndex: 0,
                _itemWidth: itemWidth,
                _gap: gap,
                _totalItemWidth: totalItemWidth,
                _containerWidth: containerWidth,
                _bufferCount: bufferCount,
                _focusElements: [],
                _destroyed: false,
                _containerRect: null,

                init: function() {
                    this._containerWidth = this._container.offsetWidth || 1800;
                    this._containerRect = this._container.getBoundingClientRect();
                    this._updateVisibleItems();
                    this._registerFocusGroup();
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

                    var itemCenter = index * this._totalItemWidth + this._itemWidth / 2;
                    var offset = itemCenter - this._containerWidth / 2;

                    var maxOffset = Math.max(0, this._items.length * this._totalItemWidth - this._containerWidth);
                    if (offset < 0) offset = 0;
                    if (offset > maxOffset) offset = maxOffset;

                    this._track.style.transform = 'translate3d(' + (-offset) + 'px, 0, 0)';

                    this._currentOffset = offset;
                    this._updateVisibleItems();
                    this._updateItemFocus(index);
                    this._prefetchAhead(index);

                    // Refresh cached rect after scroll
                    this._containerRect = this._container.getBoundingClientRect();
                },

                _updateVisibleItems: function() {
                    var offset = this._currentOffset || 0;
                    var visibleStart = Math.floor(offset / this._totalItemWidth) - this._bufferCount;
                    var visibleEnd = Math.ceil((offset + this._containerWidth) / this._totalItemWidth) + this._bufferCount;

                    if (visibleStart < 0) visibleStart = 0;
                    if (visibleEnd >= this._items.length) visibleEnd = this._items.length - 1;

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

                    for (var i = visibleStart; i <= visibleEnd; i++) {
                        if (!this._rendered[i]) {
                            this._addItem(i);
                        }
                    }
                },

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
                            if (self._opts.groupId && App.Focus.setActiveGroup) {
                                App.Focus.setActiveGroup(self._opts.groupId, null);
                            }
                            if (self._opts.onFocus) {
                                self._opts.onFocus(itm, idx);
                            }
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

                _removeItem: function(index) {
                    var entry = this._rendered[index];
                    if (!entry) return;

                    var img = entry.element.querySelector('.poster-img');
                    if (img && App.Images) {
                        App.Images.unobserve(img);
                    }

                    entry.element.parentNode.removeChild(entry.element);
                    delete this._rendered[index];
                    delete this._focusElements[index];
                },

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

                    var progress = item.progress || item.watchProgress || 0;
                    if (progress > 0) {
                        html += '<div class="poster-progress" style="width:' + Math.round(progress * 100) + '%"></div>';
                    }

                    div.innerHTML = html;
                    return div;
                },

                _updateItemFocus: function(focusedIndex) {
                    for (var key in this._rendered) {
                        if (this._rendered.hasOwnProperty(key)) {
                            this._rendered[key].element.classList.remove('focused');
                        }
                    }
                    if (this._rendered[focusedIndex]) {
                        this._rendered[focusedIndex].element.classList.add('focused');
                    }
                },

                _registerFocusGroup: function() {
                    if (!this._opts.groupId) return;

                    var self = this;

                    App.Focus.registerGroup(this._opts.groupId, this._getRenderedElements(), {
                        orientation: this._opts.orientation || 'horizontal',
                        onFocus: function(el, index) {
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

                    this._hookFocusGroup();
                },

                _hookFocusGroup: function() {
                    var groupId = this._opts.groupId;
                    var group = App.Focus._groups[groupId];
                    if (!group) return;
                    group._carousel = this;
                    this._updateFocusElements();
                },

                _updateFocusElements: function() {
                    if (!this._opts.groupId) return;

                    var elements = this._getRenderedElements();
                    App.Focus.updateGroupElements(this._opts.groupId, elements);

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

                destroy: function() {
                    this._destroyed = true;

                    // Stop global edge-scroll if targeting this carousel
                    if (_edgeScrollTarget === this) {
                        _stopEdgeScroll();
                    }

                    // Remove from global list
                    var idx = _allCarousels.indexOf(this);
                    if (idx !== -1) _allCarousels.splice(idx, 1);
                    if (_allCarousels.length === 0) _removeGlobalListener();

                    if (this._opts.groupId) {
                        App.Focus.unregisterGroup(this._opts.groupId);
                    }

                    for (var key in this._rendered) {
                        if (this._rendered.hasOwnProperty(key)) {
                            this._removeItem(parseInt(key, 10));
                        }
                    }

                    if (this._track.parentNode) {
                        this._track.parentNode.removeChild(this._track);
                    }

                    this._rendered = {};
                    this._focusElements = [];
                    this._items = [];
                },

                _prefetchAhead: function(focusIndex) {
                    if (!App.Images || !App.Images.prefetch) return;
                    var ahead = 10;
                    var urls = [];
                    var startFwd = Math.ceil((this._currentOffset + this._containerWidth) / this._totalItemWidth) + this._bufferCount + 1;
                    for (var i = startFwd; i < startFwd + ahead && i < this._items.length; i++) {
                        var item = this._items[i];
                        var url = App.Config.posterUrl(
                            item.poster || item.poster_path || item.posterPath || '', 'w342'
                        );
                        if (url && url !== 'assets/placeholder.svg') urls.push(url);
                    }
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

                _escapeHtml: function(text) {
                    var div = document.createElement('div');
                    div.appendChild(document.createTextNode(text));
                    return div.innerHTML;
                },

                _escapeAttr: function(text) {
                    return String(text)
                        .split('&').join('&amp;')
                        .split('"').join('&quot;')
                        .split("'").join('&#39;')
                        .split('<').join('&lt;')
                        .split('>').join('&gt;');
                }
            };

            // Register in global list and ensure listener
            _allCarousels.push(instance);
            _ensureGlobalListener();

            // Initialize
            instance.init();

            return instance;
        }
    };
})();
