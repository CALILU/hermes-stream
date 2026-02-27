/**
 * IsiPrime webOS App - D-pad Navigation Engine
 * Manages focus groups and keyboard navigation for TV remote control.
 *
 * Groups are collections of focusable elements arranged horizontally or vertically.
 * Groups are stacked vertically (UP/DOWN moves between groups).
 * LEFT/RIGHT moves within a group (horizontal) or between items (vertical).
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Focus = {
        _groups: {},          // { groupId: { elements: [], orientation, onFocus, onSelect, loop, memoryIndex } }
        _groupOrder: [],      // ordered array of group IDs (top to bottom)
        _currentGroup: null,  // current group ID
        _currentIndex: 0,     // index within current group
        _enabled: true,       // can be disabled during player, etc.
        _keyHandler: null,

        /**
         * Initialize focus engine. Listen for keydown events globally.
         */
        init: function() {
            var self = this;
            this._keyHandler = function(e) {
                if (self._enabled) {
                    self._onKeyDown(e);
                }
            };
            document.addEventListener('keydown', this._keyHandler);
        },

        /**
         * Register a focus group.
         * @param {string} id - Unique group identifier.
         * @param {Array|NodeList} elements - Focusable elements in this group.
         * @param {Object} opts - Options:
         *   orientation: 'horizontal' (default) or 'vertical'
         *   onFocus: function(element, index) - called when an item gains focus
         *   onSelect: function(element, index) - called on OK press
         *   loop: boolean - wrap around at edges (default: false)
         *   insertAfter: string - group ID to insert this group after in order
         *   insertBefore: string - group ID to insert this group before in order
         */
        registerGroup: function(id, elements, opts) {
            opts = opts || {};

            // Convert NodeList to array
            var els = [];
            if (elements && elements.length !== undefined) {
                for (var i = 0; i < elements.length; i++) {
                    els.push(elements[i]);
                }
            }

            this._groups[id] = {
                elements: els,
                orientation: opts.orientation || 'horizontal',
                onFocus: opts.onFocus || null,
                onSelect: opts.onSelect || null,
                loop: !!opts.loop,
                memoryIndex: 0
            };

            // Add to group order
            if (opts.insertAfter && this._groupOrder.indexOf(opts.insertAfter) !== -1) {
                var afterIdx = this._groupOrder.indexOf(opts.insertAfter);
                this._groupOrder.splice(afterIdx + 1, 0, id);
            } else if (opts.insertBefore && this._groupOrder.indexOf(opts.insertBefore) !== -1) {
                var beforeIdx = this._groupOrder.indexOf(opts.insertBefore);
                this._groupOrder.splice(beforeIdx, 0, id);
            } else {
                this._groupOrder.push(id);
            }
        },

        /**
         * Unregister a focus group.
         */
        unregisterGroup: function(id) {
            delete this._groups[id];
            var idx = this._groupOrder.indexOf(id);
            if (idx !== -1) {
                this._groupOrder.splice(idx, 1);
            }

            // If the removed group was active, try to focus something else
            if (this._currentGroup === id) {
                this._currentGroup = null;
                if (this._groupOrder.length > 0) {
                    this.setActiveGroup(this._groupOrder[0], 0);
                }
            }
        },

        /**
         * Update elements in an existing group.
         */
        updateGroupElements: function(id, elements) {
            if (!this._groups[id]) return;

            var els = [];
            if (elements && elements.length !== undefined) {
                for (var i = 0; i < elements.length; i++) {
                    els.push(elements[i]);
                }
            }
            this._groups[id].elements = els;
        },

        /**
         * Set focus to a specific group and index.
         */
        setActiveGroup: function(id, index) {
            if (!this._groups[id]) return;

            var group = this._groups[id];
            if (group.elements.length === 0) return;

            // Clamp index
            if (index === undefined || index === null) {
                index = group.memoryIndex || 0;
            }
            if (index < 0) index = 0;
            if (index >= group.elements.length) index = group.elements.length - 1;

            // Save memory for previous group
            if (this._currentGroup && this._groups[this._currentGroup]) {
                this._groups[this._currentGroup].memoryIndex = this._currentIndex;
            }

            this._currentGroup = id;
            this._currentIndex = index;
            group.memoryIndex = index;

            var el = group.elements[index];
            this._updateFocusVisual(el);

            if (group.onFocus) {
                group.onFocus(el, index);
            }
        },

        /**
         * Get the currently focused element.
         */
        getCurrentElement: function() {
            if (!this._currentGroup || !this._groups[this._currentGroup]) return null;
            var group = this._groups[this._currentGroup];
            if (this._currentIndex >= 0 && this._currentIndex < group.elements.length) {
                return group.elements[this._currentIndex];
            }
            return null;
        },

        /**
         * Get current group ID.
         */
        getCurrentGroup: function() {
            return this._currentGroup;
        },

        /**
         * Get current index within group.
         */
        getCurrentIndex: function() {
            return this._currentIndex;
        },

        /**
         * Temporarily disable focus handling (e.g., during video playback).
         */
        disable: function() {
            this._enabled = false;
        },

        /**
         * Re-enable focus handling.
         */
        enable: function() {
            this._enabled = true;
        },

        /**
         * Check if focus is enabled.
         */
        isEnabled: function() {
            return this._enabled;
        },

        /**
         * Clear all groups (e.g., on view change).
         */
        clearAllGroups: function() {
            // Remove focus visual
            var prev = document.querySelector('.focused');
            if (prev) prev.classList.remove('focused');

            this._groups = {};
            this._groupOrder = [];
            this._currentGroup = null;
            this._currentIndex = 0;
        },

        /**
         * Handle keydown events.
         */
        _onKeyDown: function(e) {
            var key = e.keyCode;

            if (!this._currentGroup || !this._groups[this._currentGroup]) return;

            var group = this._groups[this._currentGroup];

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (group.orientation === 'horizontal') {
                        e.preventDefault();
                        this._moveWithin(-1);
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (group.orientation === 'horizontal') {
                        e.preventDefault();
                        this._moveWithin(1);
                    }
                    break;

                case App.Config.KEYS.UP:
                    e.preventDefault();
                    if (group.orientation === 'vertical') {
                        this._moveWithin(-1);
                    } else {
                        this._moveVertical(-1);
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    e.preventDefault();
                    if (group.orientation === 'vertical') {
                        this._moveWithin(1);
                    } else {
                        this._moveVertical(1);
                    }
                    break;

                case App.Config.KEYS.OK:
                    e.preventDefault();
                    this._select();
                    break;
            }
        },

        /**
         * Move within current group (LEFT/RIGHT for horizontal, UP/DOWN for vertical).
         */
        _moveWithin: function(dir) {
            var group = this._groups[this._currentGroup];
            if (!group || group.elements.length === 0) return;

            // Virtual carousel: use total items count, not rendered elements count
            if (group._carousel) {
                var carousel = group._carousel;
                var newCarouselIndex = carousel._focusIndex + dir;
                if (newCarouselIndex < 0 || newCarouselIndex >= carousel._items.length) return;
                carousel.focusAt(newCarouselIndex);
                carousel._updateFocusElements();
                // Sync _currentIndex to the rendered element matching the new carousel index
                for (var ci = 0; ci < group.elements.length; ci++) {
                    var dataIdx = parseInt(group.elements[ci].getAttribute('data-index'), 10);
                    if (dataIdx === newCarouselIndex) {
                        this._currentIndex = ci;
                        group.memoryIndex = ci;
                        break;
                    }
                }
                return;
            }

            var newIndex = this._currentIndex + dir;

            if (group.loop) {
                if (newIndex < 0) newIndex = group.elements.length - 1;
                if (newIndex >= group.elements.length) newIndex = 0;
            } else {
                if (newIndex < 0 || newIndex >= group.elements.length) return;
            }

            this._currentIndex = newIndex;
            group.memoryIndex = newIndex;

            var el = group.elements[newIndex];
            this._updateFocusVisual(el);

            if (group.onFocus) {
                group.onFocus(el, newIndex);
            }
        },

        /**
         * Move to adjacent group (UP/DOWN when in horizontal group).
         * Tries to maintain horizontal position using closest x-coordinate.
         */
        _moveVertical: function(dir) {
            var currentOrderIdx = this._groupOrder.indexOf(this._currentGroup);
            if (currentOrderIdx === -1) return;

            var targetOrderIdx = currentOrderIdx + dir;

            // Find next group with elements
            while (targetOrderIdx >= 0 && targetOrderIdx < this._groupOrder.length) {
                var targetGroupId = this._groupOrder[targetOrderIdx];
                var targetGroup = this._groups[targetGroupId];
                if (targetGroup && targetGroup.elements.length > 0) {
                    // Found a valid group
                    var targetIndex = this._findClosestIndex(targetGroup);
                    this.setActiveGroup(targetGroupId, targetIndex);
                    return;
                }
                targetOrderIdx += dir;
            }
        },

        /**
         * Find the element in target group closest to the current focused element's x-position.
         */
        _findClosestIndex: function(targetGroup) {
            var currentEl = this.getCurrentElement();
            if (!currentEl) return targetGroup.memoryIndex || 0;

            // For horizontal groups, try to match x-position
            if (targetGroup.orientation === 'horizontal') {
                var currentRect = currentEl.getBoundingClientRect();
                var currentCenterX = currentRect.left + currentRect.width / 2;

                var closestIdx = 0;
                var closestDist = Infinity;

                for (var i = 0; i < targetGroup.elements.length; i++) {
                    var el = targetGroup.elements[i];
                    var rect = el.getBoundingClientRect();
                    // Only consider elements that are rendered (have dimensions)
                    if (rect.width === 0 && rect.height === 0) continue;
                    var centerX = rect.left + rect.width / 2;
                    var dist = Math.abs(centerX - currentCenterX);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestIdx = i;
                    }
                }

                return closestIdx;
            }

            // For vertical groups, use memory index
            return targetGroup.memoryIndex || 0;
        },

        /**
         * Handle OK key - call onSelect of current group.
         */
        _select: function() {
            var group = this._groups[this._currentGroup];
            if (!group) return;

            var el = group.elements[this._currentIndex];
            if (group.onSelect) {
                group.onSelect(el, this._currentIndex);
            }
        },

        /**
         * Update focus visual: remove .focused from previous, add to new element.
         */
        _updateFocusVisual: function(el) {
            // Remove previous focus from ALL focused elements
            var prevFocused = document.querySelectorAll('.focused');
            for (var i = 0; i < prevFocused.length; i++) {
                // Don't remove .focused from nav items with .active
                // (they keep active class but lose focused class)
                prevFocused[i].classList.remove('focused');
            }

            if (el) {
                el.classList.add('focused');
                this._scrollIntoView(el);
            }
        },

        /**
         * Scroll element into view if outside the viewport.
         * Uses smooth scrolling for the nearest scrollable parent.
         */
        _scrollIntoView: function(el) {
            if (!el) return;

            var rect = el.getBoundingClientRect();

            // Check if element is vertically outside viewport
            if (rect.top < 80 || rect.bottom > window.innerHeight - 20) {
                // Find scrollable parent
                var scrollParent = this._findScrollParent(el);
                if (scrollParent) {
                    var parentRect = scrollParent.getBoundingClientRect();
                    var targetScrollTop = scrollParent.scrollTop + (rect.top - parentRect.top) - 200;
                    if (targetScrollTop < 0) targetScrollTop = 0;

                    // Use smooth scroll if supported, otherwise jump
                    try {
                        scrollParent.scrollTo({
                            top: targetScrollTop,
                            behavior: 'smooth'
                        });
                    } catch (e) {
                        scrollParent.scrollTop = targetScrollTop;
                    }
                }
            }
        },

        /**
         * Find the nearest scrollable parent element.
         */
        _findScrollParent: function(el) {
            var parent = el.parentElement;
            while (parent) {
                var style = window.getComputedStyle(parent);
                var overflow = style.overflow + style.overflowY;
                if (overflow.indexOf('auto') !== -1 || overflow.indexOf('scroll') !== -1) {
                    return parent;
                }
                parent = parent.parentElement;
            }
            return document.documentElement;
        }
    };
})();
