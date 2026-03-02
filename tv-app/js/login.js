/**
 * IsiPrime webOS App - Login Screen
 * Username + password form for remote (non-LAN) users.
 * D-pad navigation between fields and submit button.
 */
(function() {
    'use strict';

    window.App = window.App || {};

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
