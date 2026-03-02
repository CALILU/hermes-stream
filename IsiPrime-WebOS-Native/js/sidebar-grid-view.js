/**
 * IsiPrime webOS App - Shared Sidebar + Grid View Utilities
 * Extracted from genre.js, years.js, sagas.js which all share
 * a sidebar-list + movie-grid layout pattern.
 *
 * Usage from a module:
 *   var SGV = App.SidebarGridView;
 *   var layout = SGV.buildLayout(container, 'Géneros', 'Todas');
 *   SGV.setupKeyHandler(ctx, { nav: fn, genres: fn, grid: fn });
 *   SGV.handleGridNav(ctx, key, { sidebarPanel: 'genres', ... });
 *   SGV.updateFocus(elements, index, scrollContainer);
 *   SGV.hide(ctx);
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.SidebarGridView = {

        /**
         * Build the standard sidebar + grid DOM layout.
         * @param {HTMLElement} container - Parent element (already cleared)
         * @param {string} sidebarTitle - Title for sidebar (e.g. 'Géneros')
         * @param {string} [contentTitle] - Default content title (e.g. 'Todas las películas')
         * @returns {{ sidebarEl, listEl, contentEl, contentTitleEl, gridEl }}
         */
        buildLayout: function(container, sidebarTitle, contentTitle) {
            var sidebarEl = document.createElement('div');
            sidebarEl.className = 'genre-sidebar';

            var titleEl = document.createElement('div');
            titleEl.className = 'genre-sidebar-title';
            titleEl.textContent = sidebarTitle;
            sidebarEl.appendChild(titleEl);

            var listEl = document.createElement('div');
            listEl.className = 'genre-list';
            sidebarEl.appendChild(listEl);

            var contentEl = document.createElement('div');
            contentEl.className = 'genre-content';

            var contentTitleEl = document.createElement('div');
            contentTitleEl.className = 'genre-content-title';
            if (contentTitle) contentTitleEl.textContent = contentTitle;
            contentEl.appendChild(contentTitleEl);

            var gridEl = document.createElement('div');
            gridEl.className = 'genre-grid';
            contentEl.appendChild(gridEl);

            container.appendChild(sidebarEl);
            container.appendChild(contentEl);

            return {
                sidebarEl: sidebarEl,
                listEl: listEl,
                contentEl: contentEl,
                contentTitleEl: contentTitleEl,
                gridEl: gridEl
            };
        },

        /**
         * Calculate number of columns from grid elements using offsetTop.
         * @param {Array} elements - Array of grid item DOM elements
         * @returns {number}
         */
        getGridCols: function(elements) {
            if (elements.length < 2) return 1;
            var firstTop = elements[0].offsetTop;
            for (var c = 1; c < elements.length; c++) {
                if (elements[c].offsetTop > firstTop + 5) {
                    return c;
                }
            }
            return elements.length;
        },

        /**
         * Scroll element into view within a scrollable container.
         * @param {HTMLElement} el - Element to make visible
         * @param {HTMLElement} container - Scrollable container
         */
        ensureVisible: function(el, container) {
            if (!el || !container) return;
            var elRect = el.getBoundingClientRect();
            var containerRect = container.getBoundingClientRect();
            var margin = 40;

            if (elRect.top < containerRect.top + margin) {
                container.scrollTop = Math.max(0,
                    container.scrollTop - (containerRect.top + margin - elRect.top));
            }
            if (elRect.bottom > containerRect.bottom - margin) {
                container.scrollTop += elRect.bottom - containerRect.bottom + margin;
            }
        },

        /**
         * Update focus on element at index within array.
         * @param {Array} elements - Array of focusable DOM elements
         * @param {number} index - Target index (clamped to valid range)
         * @param {HTMLElement} [scrollContainer] - If provided, ensureVisible
         * @returns {number} Clamped index
         */
        updateFocus: function(elements, index, scrollContainer) {
            if (elements.length === 0) return index;
            if (index < 0) index = 0;
            if (index >= elements.length) index = elements.length - 1;

            for (var i = 0; i < elements.length; i++) {
                elements[i].classList.remove('focused');
            }
            if (elements[index]) {
                elements[index].classList.add('focused');
                if (scrollContainer) {
                    App.SidebarGridView.ensureVisible(elements[index], scrollContainer);
                }
            }
            return index;
        },

        /**
         * Clear focus from all elements in array.
         * @param {Array} elements
         */
        clearFocus: function(elements) {
            for (var i = 0; i < elements.length; i++) {
                elements[i].classList.remove('focused');
            }
        },

        /**
         * Setup key handler with App.Focus disable/enable.
         * Uses ctx._activePanel to route to the correct handler.
         * @param {Object} ctx - Module context (this)
         * @param {Object} panelHandlers - Map of panel name → handler function(key)
         */
        setupKeyHandler: function(ctx, panelHandlers) {
            if (ctx._keyHandler) {
                document.removeEventListener('keydown', ctx._keyHandler, true);
            }
            if (App.Focus && App.Focus.disable) {
                App.Focus.disable();
            }

            ctx._keyHandler = function(e) {
                if (!ctx._container || ctx._container.style.display === 'none') return;
                var key = e.keyCode;
                if (key === App.Config.KEYS.BACK) return;
                e.preventDefault();
                e.stopImmediatePropagation();

                var handler = panelHandlers[ctx._activePanel];
                if (handler) handler(key);
            };

            document.addEventListener('keydown', ctx._keyHandler, true);
        },

        /**
         * Handle grid D-pad navigation (identical across genre/years/sagas).
         * @param {Object} ctx - Module context with _gridFocusIndex, _movieElements, _contentEl
         * @param {number} key - keyCode
         * @param {Object} config
         * @param {string} config.sidebarPanel - Panel name for sidebar ('genres'/'years'/'sagas')
         * @param {Function} config.onSidebarRestore - Called when LEFT at col 0 or empty grid
         * @param {Function} config.onNav - Called when UP at first row (switch to nav)
         * @param {Function} config.onOK - Called with (index) when OK pressed
         */
        handleGridNav: function(ctx, key, config) {
            var idx = ctx._gridFocusIndex;
            var total = ctx._movieElements.length;
            var SGV = App.SidebarGridView;

            if (total === 0) {
                if (key === App.Config.KEYS.LEFT || key === App.Config.KEYS.UP) {
                    ctx._activePanel = config.sidebarPanel;
                    config.onSidebarRestore();
                }
                return;
            }

            var cols = SGV.getGridCols(ctx._movieElements);
            var col = idx % cols;

            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (col > 0) {
                        ctx._gridFocusIndex = SGV.updateFocus(
                            ctx._movieElements, idx - 1, ctx._contentEl);
                    } else {
                        SGV.clearFocus(ctx._movieElements);
                        ctx._activePanel = config.sidebarPanel;
                        config.onSidebarRestore();
                    }
                    break;

                case App.Config.KEYS.RIGHT:
                    if (col < cols - 1 && idx + 1 < total) {
                        ctx._gridFocusIndex = SGV.updateFocus(
                            ctx._movieElements, idx + 1, ctx._contentEl);
                    }
                    break;

                case App.Config.KEYS.UP:
                    if (idx - cols >= 0) {
                        ctx._gridFocusIndex = SGV.updateFocus(
                            ctx._movieElements, idx - cols, ctx._contentEl);
                    } else {
                        SGV.clearFocus(ctx._movieElements);
                        config.onNav();
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    if (idx + cols < total) {
                        ctx._gridFocusIndex = SGV.updateFocus(
                            ctx._movieElements, idx + cols, ctx._contentEl);
                    } else if (idx < total - 1) {
                        ctx._gridFocusIndex = SGV.updateFocus(
                            ctx._movieElements, total - 1, ctx._contentEl);
                    }
                    break;

                case App.Config.KEYS.OK:
                    config.onOK(idx);
                    break;
            }
        },

        /**
         * Standard hide/cleanup for sidebar-grid views.
         * Removes key handler, re-enables App.Focus, clears timers and image queue.
         * @param {Object} ctx - Module context
         */
        hide: function(ctx) {
            if (ctx._container) {
                ctx._container.style.display = 'none';
                ctx._container.innerHTML = '';
            }
            if (ctx._keyHandler) {
                document.removeEventListener('keydown', ctx._keyHandler, true);
                ctx._keyHandler = null;
            }
            if (App.Focus && App.Focus.enable) {
                App.Focus.enable();
            }
            if (ctx._autoSelectTimer) {
                clearTimeout(ctx._autoSelectTimer);
                ctx._autoSelectTimer = null;
            }
            if (App.Images && App.Images.clearQueue) {
                App.Images.clearQueue();
            }
        }
    };
})();
