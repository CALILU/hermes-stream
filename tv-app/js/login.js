/**
 * IsiPrime webOS App - Login Screen
 * Username + password form for remote (non-LAN) users.
 * D-pad navigation between fields and submit button.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    /**
     * Wrap an input with a clear (✕) button.
     * Works for inputs already in DOM (login) or dynamically created (sagas).
     * @param {HTMLInputElement} input
     * @returns {HTMLElement} wrapper div (use this for DOM insertion if input has no parent)
     */
    App.wrapClearable = function(input) {
        var wrapper = document.createElement('div');
        wrapper.className = 'input-clearable-wrap';

        var clearBtn = document.createElement('span');
        clearBtn.className = 'input-clear-btn';
        clearBtn.textContent = '\u2715'; // ✕
        clearBtn.style.display = 'none';

        // If input already in DOM, replace in-place
        var parent = input.parentNode;
        if (parent) {
            parent.insertBefore(wrapper, input);
        }
        wrapper.appendChild(input);
        wrapper.appendChild(clearBtn);

        // Add right padding so text doesn't go under button
        input.style.paddingRight = '40px';

        function updateVisibility() {
            clearBtn.style.display = input.value ? '' : 'none';
        }

        input.addEventListener('input', updateVisibility);

        clearBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            input.value = '';
            clearBtn.style.display = 'none';
            // Dispatch input event so listeners react (e.g. _applyFilter)
            var evt;
            try { evt = new Event('input', { bubbles: true }); }
            catch (_) { evt = document.createEvent('Event'); evt.initEvent('input', true, true); }
            input.dispatchEvent(evt);
            input.focus();
        });

        // Check initial value
        updateVisibility();

        return wrapper;
    };

    var _usernameInput = null;
    var _passwordInput = null;
    var _submitBtn = null;
    var _errorEl = null;
    var _focusables = [];
    var _focusIndex = 0;
    var _keyHandler = null;
    var _isVisible = false;

    App.Login = {
        /**
         * Show login form, set up focus and key handling.
         */
        show: function() {
            var loginView = document.getElementById('login-view');
            loginView.style.display = 'flex';
            _isVisible = true;

            _usernameInput = document.getElementById('login-username');
            _passwordInput = document.getElementById('login-password');
            _submitBtn = document.getElementById('login-btn');
            _errorEl = document.getElementById('login-error');

            // Wrap inputs with clear button (only once)
            if (!_usernameInput.parentNode.classList.contains('input-clearable-wrap')) {
                App.wrapClearable(_usernameInput);
            }
            if (!_passwordInput.parentNode.classList.contains('input-clearable-wrap')) {
                App.wrapClearable(_passwordInput);
            }

            _focusables = [_usernameInput, _passwordInput, _submitBtn];
            _focusIndex = 0;

            _errorEl.style.display = 'none';
            _errorEl.textContent = '';
            _usernameInput.value = '';
            _passwordInput.value = '';

            this._setFocus(0);

            var self = this;
            _keyHandler = function(e) { self._onKeyDown(e); };
            document.addEventListener('keydown', _keyHandler);

            // Mouse/click support for browser (PC) usage
            _submitBtn.addEventListener('click', function(e) {
                e.preventDefault();
                self._submit();
            });
            _usernameInput.addEventListener('click', function() { self._setFocus(0); });
            _passwordInput.addEventListener('click', function() { self._setFocus(1); });

            // Enter key in password field submits directly
            _passwordInput.addEventListener('keydown', function(e) {
                if (e.keyCode === 13) {
                    e.preventDefault();
                    self._submit();
                }
            });
        },

        /**
         * Hide login form, remove key handler.
         */
        hide: function() {
            var loginView = document.getElementById('login-view');
            loginView.style.display = 'none';
            _isVisible = false;

            if (_keyHandler) {
                document.removeEventListener('keydown', _keyHandler);
                _keyHandler = null;
            }

            // Remove focus from all
            _focusables.forEach(function(el) {
                el.classList.remove('focused');
                el.blur();
            });
        },

        /**
         * Set focus to element at given index.
         */
        _setFocus: function(index) {
            // Remove previous focus
            _focusables.forEach(function(el) {
                el.classList.remove('focused');
                el.blur();
            });

            _focusIndex = index;
            var el = _focusables[_focusIndex];
            el.classList.add('focused');

            // Focus input elements for keyboard input on TV
            if (el.tagName === 'INPUT') {
                el.focus();
            }
        },

        /**
         * Handle keydown events for D-pad navigation.
         */
        _onKeyDown: function(e) {
            if (!_isVisible) return;

            var key = e.keyCode;

            switch (key) {
                case App.Config.KEYS.UP:
                    e.preventDefault();
                    if (_focusIndex > 0) {
                        this._setFocus(_focusIndex - 1);
                    }
                    break;

                case App.Config.KEYS.DOWN:
                    e.preventDefault();
                    if (_focusIndex < _focusables.length - 1) {
                        this._setFocus(_focusIndex + 1);
                    }
                    break;

                case App.Config.KEYS.OK:
                    e.preventDefault();
                    if (_focusIndex === 2) {
                        // Submit button focused
                        this._submit();
                    } else if (_focusIndex === 0 || _focusIndex === 1) {
                        // Input focused - OK opens virtual keyboard on webOS
                        // The input is already focused, so the VKB should appear
                    }
                    break;

                case App.Config.KEYS.BACK:
                    e.preventDefault();
                    // On login screen, BACK does nothing (can't go further back)
                    break;
            }
        },

        /**
         * Submit login form.
         */
        _submit: function() {
            var username = _usernameInput.value.trim();
            var password = _passwordInput.value;

            if (!username || !password) {
                this._showError('Introduce usuario y contraseña');
                return;
            }

            // Visual feedback: disable button
            _submitBtn.textContent = 'Iniciando...';
            _submitBtn.disabled = true;

            var self = this;
            App.API.login(username, password)
                .then(function() {
                    _submitBtn.textContent = 'Iniciar sesión';
                    _submitBtn.disabled = false;
                    // Notify app of successful login
                    if (typeof App.onLoginSuccess === 'function') {
                        App.onLoginSuccess();
                    }
                })
                .catch(function(err) {
                    _submitBtn.textContent = 'Iniciar sesión';
                    _submitBtn.disabled = false;
                    self._showError(err.message || 'Error de conexión');
                    self._setFocus(0);
                });
        },

        /**
         * Display error message.
         */
        _showError: function(message) {
            _errorEl.textContent = message;
            _errorEl.style.display = 'block';
        }
    };
})();
