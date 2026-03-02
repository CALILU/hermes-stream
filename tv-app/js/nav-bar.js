/**
 * IsiPrime webOS App - Shared Nav Bar Management
 * Extracted from genre.js, years.js, sagas.js, search.js, requests.js
 * All modules used identical nav bar code — now centralized here.
 *
 * Usage from a module:
 *   App.NavBar.initItems(this);                      // in show()
 *   App.NavBar.switchTo(this, 'genres');              // in _switchToNav()
 *   App.NavBar.handleKey(this, key, onDownCallback);  // in _handleNavNav()
 *   // _updateNavFocus and _clearNavFocus no longer needed in modules
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.NavBar = {
        /**
         * Initialize nav items from DOM. Call in each module's show().
         */
        initItems: function(ctx) {
            var navEls = document.querySelectorAll('#nav-bar .nav-item');
            ctx._navItems = [];
            for (var i = 0; i < navEls.length; i++) {
                ctx._navItems.push(navEls[i]);
            }
            ctx._navFocusIndex = 0;
        },

        /**
         * Switch focus to nav bar, pre-selecting the given view.
         * Sets _activePanel = 'nav'. Caller should clear own focus first.
         */
        switchTo: function(ctx, viewName) {
            ctx._activePanel = 'nav';
            ctx._navFocusIndex = 0;
            for (var i = 0; i < ctx._navItems.length; i++) {
                if (ctx._navItems[i].getAttribute('data-view') === viewName) {
                    ctx._navFocusIndex = i;
                    break;
                }
            }
            this.updateFocus(ctx, ctx._navFocusIndex);
        },

        /**
         * Handle LEFT/RIGHT/DOWN/OK keys while nav bar has focus.
         * @param {Function} onDown - Called when DOWN is pressed (module restores its own panel)
         */
        handleKey: function(ctx, key, onDown) {
            switch (key) {
                case App.Config.KEYS.LEFT:
                    if (ctx._navFocusIndex > 0) this.updateFocus(ctx, ctx._navFocusIndex - 1);
                    break;
                case App.Config.KEYS.RIGHT:
                    if (ctx._navFocusIndex < ctx._navItems.length - 1) this.updateFocus(ctx, ctx._navFocusIndex + 1);
                    break;
                case App.Config.KEYS.DOWN:
                    this.clearFocus(ctx);
                    onDown();
                    break;
                case App.Config.KEYS.OK:
                    var item = ctx._navItems[ctx._navFocusIndex];
                    if (item) {
                        var view = item.getAttribute('data-view');
                        if (view && typeof App._onNavSelect === 'function') {
                            App._onNavSelect(view, ctx._navItems);
                        }
                    }
                    break;
            }
        },

        /**
         * Update focus visual on nav item at index.
         */
        updateFocus: function(ctx, index) {
            if (index < 0) index = 0;
            if (index >= ctx._navItems.length) index = ctx._navItems.length - 1;
            ctx._navFocusIndex = index;
            for (var i = 0; i < ctx._navItems.length; i++) {
                ctx._navItems[i].classList.remove('focused');
            }
            ctx._navItems[index].classList.add('focused');
        },

        /**
         * Clear focus from all nav items.
         */
        clearFocus: function(ctx) {
            for (var i = 0; i < ctx._navItems.length; i++) {
                ctx._navItems[i].classList.remove('focused');
            }
        }
    };
})();
