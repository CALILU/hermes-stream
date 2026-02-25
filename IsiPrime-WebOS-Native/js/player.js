/**
 * IsiPrime webOS App - Video Player
 * Fullscreen video player with TV remote controls (D-pad).
 * Handles play/pause, seeking, progress saving, and resume dialog.
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Player = {
        _video: null,
        _container: null,
        _controls: null,
        _titleBar: null,
        _progressFill: null,
        _progressDot: null,
        _timeCurrent: null,
        _timeTotal: null,
        _stateIcon: null,
        _title: '',
        _videoPath: '',
        _videoUrl: '',
        _controlsTimer: null,
        _progressTimer: null,
        _isPlaying: false,
        _startPosition: 0,
        _keyHandler: null,
        _resumeDialog: null,
        _resumeFocusIndex: 0,
        _resumeButtons: [],
        _isInResumeDialog: false,
        _eventsBound: false,

        /**
         * Start the player with video data.
         * data: { url, title, videoPath, startPosition, duration }
         */
        play: function(data) {
            this._container = document.getElementById('player-view');
            this._title = data.title || '';
            this._videoPath = data.videoPath || '';
            this._videoUrl = data.url || '';
            this._startPosition = data.startPosition || 0;
            this._isPlaying = false;
            this._eventsBound = false;

            // Build player DOM
            this._container.innerHTML = '';
            this._container.style.display = '';
            this._buildDOM();

            // Disable focus system (player handles own keys)
            if (App.Focus && App.Focus.disable) {
                App.Focus.disable();
            }

            // Setup key handler
            this._setupKeyHandler();

            // If there's a saved position > 30s, show resume dialog first
            if (this._startPosition > 30) {
                this._showResumeDialog();
            } else {
                this._startPlayback(0);
            }
        },

        /**
         * Build the player DOM elements.
         */
        _buildDOM: function() {
            var container = this._container;

            // Video element
            var video = document.createElement('video');
            video.className = 'player-video';
            video.setAttribute('preload', 'auto');
            container.appendChild(video);
            this._video = video;

            // Title bar (top)
            var titleBar = document.createElement('div');
            titleBar.className = 'player-title-bar';
            titleBar.textContent = this._title;
            container.appendChild(titleBar);
            this._titleBar = titleBar;

            // State icon (play/pause indicator in center)
            var stateIcon = document.createElement('div');
            stateIcon.className = 'player-state-icon';
            stateIcon.id = 'player-state-icon';
            container.appendChild(stateIcon);
            this._stateIcon = stateIcon;

            // Controls overlay (bottom)
            var controls = document.createElement('div');
            controls.className = 'player-controls';

            // Progress bar
            var progressBar = document.createElement('div');
            progressBar.className = 'player-progress-bar';

            var progressFill = document.createElement('div');
            progressFill.className = 'player-progress-fill';
            progressBar.appendChild(progressFill);
            this._progressFill = progressFill;

            var progressDot = document.createElement('div');
            progressDot.className = 'player-progress-dot';
            progressBar.appendChild(progressDot);
            this._progressDot = progressDot;

            controls.appendChild(progressBar);

            // Time display
            var timeRow = document.createElement('div');
            timeRow.className = 'player-time';

            var timeCurrent = document.createElement('span');
            timeCurrent.id = 'time-current';
            timeCurrent.textContent = '0:00';
            timeRow.appendChild(timeCurrent);
            this._timeCurrent = timeCurrent;

            var timeTotal = document.createElement('span');
            timeTotal.id = 'time-total';
            timeTotal.textContent = '0:00';
            timeRow.appendChild(timeTotal);
            this._timeTotal = timeTotal;

            controls.appendChild(timeRow);
            container.appendChild(controls);
            this._controls = controls;

            // Resume dialog container (hidden initially)
            var resumeDialog = document.createElement('div');
            resumeDialog.className = 'resume-dialog';
            resumeDialog.style.display = 'none';
            container.appendChild(resumeDialog);
            this._resumeDialog = resumeDialog;
        },

        /**
         * Show the resume position dialog.
         * The user chooses to continue from saved position or restart.
         */
        _showResumeDialog: function() {
            var dialog = this._resumeDialog;
            dialog.style.display = 'flex';
            dialog.innerHTML = '';

            var posText = this._formatTime(this._startPosition);

            var message = document.createElement('div');
            message.className = 'resume-dialog-text';
            message.textContent = '\u00BFContinuar desde ' + posText + '?';
            dialog.appendChild(message);

            var btnContainer = document.createElement('div');
            btnContainer.className = 'resume-dialog-buttons';

            var continueBtn = document.createElement('button');
            continueBtn.className = 'resume-dialog-btn focused';
            continueBtn.textContent = 'Continuar';
            continueBtn.setAttribute('data-action', 'resume');
            btnContainer.appendChild(continueBtn);

            var restartBtn = document.createElement('button');
            restartBtn.className = 'resume-dialog-btn';
            restartBtn.textContent = 'Desde el inicio';
            restartBtn.setAttribute('data-action', 'restart');
            btnContainer.appendChild(restartBtn);

            dialog.appendChild(btnContainer);

            this._resumeButtons = [continueBtn, restartBtn];
            this._resumeFocusIndex = 0;
            this._isInResumeDialog = true;
        },

        /**
         * Handle resume dialog button focus.
         */
        _setResumeFocus: function(index) {
            if (index < 0 || index >= this._resumeButtons.length) return;
            this._resumeButtons.forEach(function(btn) {
                btn.classList.remove('focused');
            });
            this._resumeFocusIndex = index;
            this._resumeButtons[index].classList.add('focused');
        },

        /**
         * Handle resume dialog selection.
         */
        _onResumeSelect: function() {
            var btn = this._resumeButtons[this._resumeFocusIndex];
            if (!btn) return;

            var action = btn.getAttribute('data-action');
            this._resumeDialog.style.display = 'none';
            this._isInResumeDialog = false;

            if (action === 'resume') {
                this._startPlayback(this._startPosition);
            } else {
                this._startPlayback(0);
            }
        },

        /**
         * Start video playback at the given position.
         * Sets the video source, binds events, and begins playing.
         */
        _startPlayback: function(seekTo) {
            var self = this;
            var video = this._video;
            if (!video) return;

            // Bind video events only once
            if (!this._eventsBound) {
                this._eventsBound = true;

                // timeupdate: update progress bar and time display
                video.addEventListener('timeupdate', function() {
                    self._onTimeUpdate();
                });

                // ended: video finished
                video.addEventListener('ended', function() {
                    self._onEnded();
                });

                // error
                video.addEventListener('error', function(e) {
                    console.error('Video error:', e);
                });
            }

            // loadedmetadata: set duration and seek
            var onMetadata = function() {
                video.removeEventListener('loadedmetadata', onMetadata);

                if (self._timeTotal) {
                    self._timeTotal.textContent = self._formatTime(video.duration || 0);
                }

                if (seekTo > 0) {
                    video.currentTime = seekTo;
                }

                video.play().then(function() {
                    self._isPlaying = true;
                    self._showControls();
                }).catch(function(err) {
                    console.error('Playback error:', err);
                    // Retry play without promise handling (older webOS)
                    try { video.play(); } catch (e) {}
                    self._isPlaying = true;
                    self._showControls();
                });
            };

            video.addEventListener('loadedmetadata', onMetadata);

            // Set source and load
            video.src = this._videoUrl;
            video.load();

            // Start progress save interval
            if (this._progressTimer) clearInterval(this._progressTimer);
            this._progressTimer = setInterval(function() {
                if (self._video && !self._video.paused && self._videoPath) {
                    App.API.saveProgress(
                        self._videoPath,
                        Math.floor(self._video.currentTime),
                        Math.floor(self._video.duration || 0)
                    );
                }
            }, App.Config.PROGRESS_SAVE_INTERVAL);
        },

        /**
         * Handle time update: refresh progress bar and time display.
         */
        _onTimeUpdate: function() {
            var video = this._video;
            if (!video || !video.duration) return;

            var pct = (video.currentTime / video.duration) * 100;

            if (this._progressFill) {
                this._progressFill.style.width = pct + '%';
            }
            if (this._progressDot) {
                this._progressDot.style.left = pct + '%';
            }
            if (this._timeCurrent) {
                this._timeCurrent.textContent = this._formatTime(video.currentTime);
            }
            if (this._timeTotal) {
                this._timeTotal.textContent = this._formatTime(video.duration);
            }
        },

        /**
         * Handle video ended event.
         */
        _onEnded: function() {
            this._isPlaying = false;

            // Save final progress
            if (this._video && this._videoPath) {
                App.API.saveProgress(
                    this._videoPath,
                    Math.floor(this._video.currentTime),
                    Math.floor(this._video.duration || 0)
                );
            }

            // Go back after a short delay
            var self = this;
            setTimeout(function() {
                self._goBack();
            }, 500);
        },

        /**
         * Setup keyboard handler for remote control.
         */
        _setupKeyHandler: function() {
            var self = this;

            this._keyHandler = function(e) {
                if (!self._container || self._container.style.display === 'none') return;

                var key = e.keyCode;
                e.preventDefault();
                // stopImmediatePropagation prevents Router's global BACK handler from also firing
                e.stopImmediatePropagation();

                // If in resume dialog, handle dialog keys
                if (self._isInResumeDialog) {
                    switch (key) {
                        case App.Config.KEYS.LEFT:
                            self._setResumeFocus(0);
                            break;
                        case App.Config.KEYS.RIGHT:
                            self._setResumeFocus(1);
                            break;
                        case App.Config.KEYS.OK:
                            self._onResumeSelect();
                            break;
                        case App.Config.KEYS.BACK:
                            self._resumeDialog.style.display = 'none';
                            self._isInResumeDialog = false;
                            self._goBack();
                            break;
                    }
                    return;
                }

                // Normal player controls
                switch (key) {
                    case App.Config.KEYS.OK:
                        self._togglePlayPause();
                        self._showControls();
                        break;

                    case App.Config.KEYS.PLAY:
                        if (self._video && self._video.paused) {
                            self._video.play();
                            self._isPlaying = true;
                            self._showStateIcon('\u25B6');
                        }
                        self._showControls();
                        break;

                    case App.Config.KEYS.PAUSE:
                        if (self._video && !self._video.paused) {
                            self._video.pause();
                            self._isPlaying = false;
                            self._showStateIcon('\u23F8');
                        }
                        self._showControls();
                        break;

                    case App.Config.KEYS.STOP:
                        self._goBack();
                        break;

                    case App.Config.KEYS.LEFT:
                    case App.Config.KEYS.RW:
                        self._seek(-10);
                        break;

                    case App.Config.KEYS.RIGHT:
                    case App.Config.KEYS.FF:
                        self._seek(10);
                        break;

                    case App.Config.KEYS.BACK:
                        self._goBack();
                        break;

                    default:
                        // Any other key shows controls
                        self._showControls();
                        break;
                }
            };

            document.addEventListener('keydown', this._keyHandler);
        },

        /**
         * Toggle play/pause.
         */
        _togglePlayPause: function() {
            if (!this._video) return;

            if (this._video.paused) {
                this._video.play();
                this._isPlaying = true;
                this._showStateIcon('\u25B6');
            } else {
                this._video.pause();
                this._isPlaying = false;
                this._showStateIcon('\u23F8');
            }
        },

        /**
         * Seek forward or backward by the given number of seconds.
         */
        _seek: function(seconds) {
            if (!this._video) return;
            var duration = this._video.duration || 0;
            var newTime = this._video.currentTime + seconds;
            this._video.currentTime = Math.max(0, Math.min(newTime, duration));
            this._showControls();

            // Show seek indicator
            if (seconds > 0) {
                this._showStateIcon('\u25B6\u25B6');
            } else {
                this._showStateIcon('\u25C0\u25C0');
            }
        },

        /**
         * Show controls overlay. Auto-hide after 3s if playing.
         */
        _showControls: function() {
            var self = this;

            if (this._controls) {
                this._controls.classList.remove('controls-hidden');
            }
            if (this._titleBar) {
                this._titleBar.classList.remove('controls-hidden');
            }

            // Clear existing timer
            if (this._controlsTimer) {
                clearTimeout(this._controlsTimer);
                this._controlsTimer = null;
            }

            // Auto-hide after 3s if playing
            if (this._isPlaying) {
                this._controlsTimer = setTimeout(function() {
                    self._hideControls();
                }, 3000);
            }
        },

        /**
         * Hide controls overlay.
         */
        _hideControls: function() {
            if (this._controls) {
                this._controls.classList.add('controls-hidden');
            }
            if (this._titleBar) {
                this._titleBar.classList.add('controls-hidden');
            }
        },

        /**
         * Show a state icon briefly in the center of the screen.
         */
        _showStateIcon: function(icon) {
            var el = this._stateIcon;
            if (!el) return;
            el.textContent = icon;
            el.classList.add('visible');
            setTimeout(function() {
                el.classList.remove('visible');
            }, 800);
        },

        /**
         * Format seconds into h:mm:ss or m:ss.
         */
        _formatTime: function(seconds) {
            if (!seconds || isNaN(seconds)) return '0:00';
            seconds = Math.floor(seconds);
            var h = Math.floor(seconds / 3600);
            var m = Math.floor((seconds % 3600) / 60);
            var s = seconds % 60;
            if (h > 0) {
                return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
            }
            return m + ':' + (s < 10 ? '0' : '') + s;
        },

        /**
         * Go back: save progress and return to previous view.
         * Router.back() calls _hideView(PLAYER) -> this.hide() -> this.stop(),
         * so we only save progress here and let Router handle cleanup.
         */
        _goBack: function() {
            // Save final progress before stopping
            if (this._video && this._videoPath) {
                App.API.saveProgress(
                    this._videoPath,
                    Math.floor(this._video.currentTime),
                    Math.floor(this._video.duration || 0)
                );
            }

            // Navigate back (Router will call hide -> stop)
            if (App.Router && App.Router.back) {
                App.Router.back();
            }
        },

        /**
         * Stop playback and clean up everything.
         */
        stop: function() {
            // Clear timers
            if (this._progressTimer) {
                clearInterval(this._progressTimer);
                this._progressTimer = null;
            }
            if (this._controlsTimer) {
                clearTimeout(this._controlsTimer);
                this._controlsTimer = null;
            }

            // Remove key handler
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
                this._keyHandler = null;
            }

            // Stop video
            if (this._video) {
                this._video.pause();
                this._video.removeAttribute('src');
                this._video.load(); // Release resources
                this._video = null;
            }

            // Clear DOM
            if (this._container) {
                this._container.style.display = 'none';
                this._container.innerHTML = '';
            }

            // Re-enable focus system
            if (App.Focus && App.Focus.enable) {
                App.Focus.enable();
            }

            // Reset state
            this._isPlaying = false;
            this._isInResumeDialog = false;
            this._eventsBound = false;
            this._resumeButtons = [];
            this._controls = null;
            this._titleBar = null;
            this._progressFill = null;
            this._progressDot = null;
            this._timeCurrent = null;
            this._timeTotal = null;
            this._stateIcon = null;
            this._resumeDialog = null;
            this._videoUrl = '';

            // Refresh data (continue watching may have changed)
            App.refreshData();
        },

        // Aliases for Router compatibility
        show: function(data) { this.play(data); },
        hide: function() { this.stop(); }
    };
})();
