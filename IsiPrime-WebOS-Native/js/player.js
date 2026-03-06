/**
 * IsiPrime webOS App - Video Player (iframe approach)
 *
 * Architecture:
 * - An iframe loads /tv-player from the server (same-origin for video playback)
 * - The iframe has its own controls: progress bar, transport buttons, title, state icon
 * - This parent module handles: resume dialog, progress saving, key forwarding
 * - Keys pressed in parent are forwarded to iframe via postMessage
 * - The iframe sends timeupdate/progress/back/ended messages to parent
 */
(function() {
    'use strict';

    window.App = window.App || {};

    App.Player = {
        _iframe: null,
        _container: null,
        _title: '',
        _videoPath: '',
        _videoUrl: '',
        _startPosition: 0,
        _keyHandler: null,
        _destroyed: false,
        _lastProgress: null,
        _messageHandler: null,
        _progressSaveTimer: null,

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
            this._destroyed = false;
            this._lastProgress = null;

            // Build player DOM
            this._container.innerHTML = '';
            this._container.style.display = '';

            // Disable focus system (player handles own keys)
            if (App.Focus && App.Focus.disable) {
                App.Focus.disable();
            }

            // Auto-resume from saved position (no confirmation dialog)
            this._startPlayback(this._startPosition > 30 ? this._startPosition : 0);
        },

        /**
         * Start video playback by creating an iframe to the server's tv-player page.
         */
        _startPlayback: function(seekTo) {
            var self = this;
            if (this._destroyed) return;

            // Extract just the filename from the full URL
            var serverUrl = App.Config.SERVER_URL;
            var url = this._videoUrl;

            // Remove server prefix to get path
            if (url.indexOf(serverUrl) === 0) {
                url = url.substring(serverUrl.length);
            }

            // Extract filename from /stream/FILENAME or /stream-series/FOLDER/FILE
            var streamPrefix = '/stream/';
            var seriesPrefix = '/stream-series/';
            var seriesFolder = '';
            var filename = '';

            if (url.indexOf(streamPrefix) === 0) {
                filename = decodeURIComponent(url.substring(streamPrefix.length).split('?')[0]);
            } else if (url.indexOf(seriesPrefix) === 0) {
                var subPath = url.substring(seriesPrefix.length).split('?')[0];
                var slashIdx = subPath.indexOf('/');
                if (slashIdx > 0) {
                    seriesFolder = decodeURIComponent(subPath.substring(0, slashIdx));
                    filename = decodeURIComponent(subPath.substring(slashIdx + 1));
                } else {
                    filename = decodeURIComponent(subPath);
                }
            } else {
                var parts = url.split('/');
                filename = decodeURIComponent(parts[parts.length - 1].split('?')[0]);
            }

            // Extract file extension for direct MP4 streaming
            var ext = '';
            var dotIdx = filename.lastIndexOf('.');
            if (dotIdx > 0) ext = filename.substring(dotIdx + 1).toLowerCase();

            // Fetch codec info from server, then build iframe with codec params
            var infoUrl = serverUrl + '/video-info/' + encodeURIComponent(filename);
            var infoQs = [];
            if (seriesFolder) infoQs.push('series=' + encodeURIComponent(seriesFolder));
            var token = App.API._accessToken;
            if (token) infoQs.push('token=' + encodeURIComponent(token));
            if (infoQs.length > 0) infoUrl += '?' + infoQs.join('&');

            App.API._xhrGet(infoUrl, function(err, info) {
                if (self._destroyed) return;
                var vcodec = (info && info.video_codec) ? info.video_codec : '';
                var acodec = (info && info.audio_codec) ? info.audio_codec : '';

                self._launchIframe(seekTo, filename, seriesFolder, ext, vcodec, acodec, token);
            });
        },

        /**
         * Build and launch the iframe with streaming parameters.
         */
        _launchIframe: function(seekTo, filename, seriesFolder, ext, vcodec, acodec, token) {
            var self = this;
            var serverUrl = App.Config.SERVER_URL;

            // Build iframe URL
            var iframeUrl = serverUrl + '/tv-player'
                + '?file=' + encodeURIComponent(filename)
                + '&pos=' + seekTo
                + '&title=' + encodeURIComponent(this._title);

            if (seriesFolder) {
                iframeUrl += '&series=' + encodeURIComponent(seriesFolder);
            }

            // Pass extension so tv-player can use direct streaming for MP4/MOV
            if (ext) {
                iframeUrl += '&ext=' + ext;
            }

            // Pass codec info for intelligent streaming decision
            if (vcodec) {
                iframeUrl += '&vcodec=' + vcodec;
            }
            if (acodec) {
                iframeUrl += '&acodec=' + acodec;
            }

            if (token) {
                iframeUrl += '&token=' + encodeURIComponent(token);
            }

            console.log('[Player] iframe URL: ' + iframeUrl);

            // Clear container and create fullscreen iframe with loading overlay
            this._container.innerHTML = '';
            this._container.style.background = '#000';

            // Loading overlay
            var overlay = document.createElement('div');
            overlay.id = 'player-loading';
            overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:5;transition:opacity 0.4s;';
            var spinner = document.createElement('div');
            spinner.style.cssText = 'width:80px;height:80px;border:5px solid rgba(196,181,253,0.2);border-top-color:#c4b5fd;border-radius:50%;animation:playerSpin 0.8s linear infinite;';
            var spinStyle = document.createElement('style');
            spinStyle.textContent = '@keyframes playerSpin{to{transform:rotate(360deg)}}';
            overlay.appendChild(spinStyle);
            overlay.appendChild(spinner);
            var loadText = document.createElement('div');
            loadText.style.cssText = 'color:#aaa;font-size:24px;margin-top:24px;font-family:system-ui,sans-serif;';
            loadText.textContent = 'Cargando pel\u00EDcula...';
            overlay.appendChild(loadText);
            this._container.appendChild(overlay);
            this._loadingOverlay = overlay;

            var iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;background:#000;';
            iframe.setAttribute('allowfullscreen', '');
            iframe.setAttribute('allow', 'autoplay');
            iframe.src = iframeUrl;
            this._container.appendChild(iframe);
            this._iframe = iframe;

            // Focus iframe when loaded so it receives key events directly
            iframe.addEventListener('load', function() {
                try {
                    iframe.contentWindow.focus();
                } catch (e) {
                    console.log('[Player] Could not focus iframe: ' + e.message);
                }
            });

            // Listen for messages from iframe
            this._messageHandler = function(e) {
                if (self._destroyed) return;
                // Verify origin to prevent fraudulent messages from injected iframes
                if (e.origin && e.origin !== 'null' && e.origin !== App.Config.SERVER_URL.replace(/\/$/, '')) return;
                var data = e.data;
                if (!data || !data.type) return;

                switch (data.type) {
                    case 'timeupdate':
                        self._lastProgress = {
                            currentTime: data.currentTime || 0,
                            duration: data.duration || 0
                        };
                        break;

                    case 'progress':
                        self._lastProgress = {
                            currentTime: data.currentTime || 0,
                            duration: data.duration || 0
                        };
                        // Save progress to server
                        if (self._videoPath && data.currentTime > 0) {
                            App.API.saveProgress(self._videoPath, data.currentTime, data.duration);
                        }
                        break;

                    case 'back':
                        // Save final progress and go back
                        if (self._videoPath && data.currentTime > 0) {
                            App.API.saveProgress(self._videoPath, data.currentTime, data.duration);
                        }
                        self._goBack();
                        break;

                    case 'ended':
                        // Video finished
                        if (self._videoPath) {
                            App.API.saveProgress(self._videoPath, data.currentTime, data.duration);
                        }
                        setTimeout(function() { self._goBack(); }, 500);
                        break;

                    case 'playing':
                        console.log('[Player] Video is playing');
                        if (self._loadingOverlay) {
                            self._loadingOverlay.style.opacity = '0';
                            setTimeout(function() {
                                if (self._loadingOverlay && self._loadingOverlay.parentNode) {
                                    self._loadingOverlay.parentNode.removeChild(self._loadingOverlay);
                                    self._loadingOverlay = null;
                                }
                            }, 400);
                        }
                        break;

                    case 'quality-change':
                        // ABR: reload iframe at current position with new quality
                        console.log('[Player] ABR quality change: ' + (data.quality || 'original') + ' at ' + Math.floor(data.position || 0) + 's');
                        if (self._iframe && data.position > 0) {
                            self._startPosition = Math.floor(data.position);
                            self._currentQuality = data.quality || 'original';
                            self._reloadWithQuality(data.quality, data.position);
                        }
                        break;

                    case 'error':
                        console.log('[Player] Iframe error: ' + (data.message || ''));
                        break;
                }
            };
            window.addEventListener('message', this._messageHandler);

            // Setup key handler (forwards keys to iframe when parent has focus)
            if (!this._keyHandler) {
                this._setupKeyHandler();
            }

            // Progress save timer (every 10s, in addition to iframe's own progress messages)
            this._progressSaveTimer = setInterval(function() {
                if (self._videoPath && self._lastProgress && self._lastProgress.currentTime > 0) {
                    App.API.saveProgress(self._videoPath, self._lastProgress.currentTime, self._lastProgress.duration);
                }
            }, 10000);
        },

        /**
         * Reload iframe with a different quality profile (ABR switch).
         */
        _reloadWithQuality: function(quality, position) {
            if (!this._iframe) return;
            var currentSrc = this._iframe.src;
            // Remove existing quality param if present
            currentSrc = currentSrc.replace(/&quality=[^&]*/g, '');
            // Update position
            currentSrc = currentSrc.replace(/([?&])pos=[^&]*/, '$1pos=' + Math.floor(position));
            // Add quality param
            if (quality && quality !== 'original') {
                currentSrc += '&quality=' + quality;
            }
            console.log('[Player] ABR reload: ' + currentSrc);
            this._iframe.src = currentSrc;
        },

        /**
         * Send command to iframe via postMessage.
         */
        _sendCommand: function(action, params) {
            if (!this._iframe || !this._iframe.contentWindow) return;
            var msg = { action: action };
            if (params) {
                for (var k in params) {
                    if (params.hasOwnProperty(k)) {
                        msg[k] = params[k];
                    }
                }
            }
            try {
                this._iframe.contentWindow.postMessage(msg, '*');
            } catch (e) {
                console.log('[Player] postMessage error: ' + e.message);
            }
        },

        /**
         * Setup keyboard handler.
         * Forwards media keys to iframe (fallback if parent has focus).
         */
        _setupKeyHandler: function() {
            var self = this;

            this._keyHandler = function(e) {
                if (!self._container || self._container.style.display === 'none') return;

                var key = e.keyCode;
                e.preventDefault();
                e.stopImmediatePropagation();

                switch (key) {
                    case App.Config.KEYS.OK:
                        self._sendCommand('toggle');
                        break;
                    case App.Config.KEYS.PLAY:
                        self._sendCommand('play');
                        break;
                    case App.Config.KEYS.PAUSE:
                        self._sendCommand('pause');
                        break;
                    case App.Config.KEYS.LEFT:
                    case App.Config.KEYS.RW:
                        self._sendCommand('seek', { offset: -10 });
                        break;
                    case App.Config.KEYS.RIGHT:
                    case App.Config.KEYS.FF:
                        self._sendCommand('seek', { offset: 10 });
                        break;
                    case App.Config.KEYS.STOP:
                        self._sendCommand('stop');
                        break;
                    case App.Config.KEYS.BACK:
                        if (self._lastProgress && self._videoPath) {
                            App.API.saveProgress(self._videoPath, self._lastProgress.currentTime, self._lastProgress.duration);
                        }
                        self._goBack();
                        break;
                }
            };

            document.addEventListener('keydown', this._keyHandler);
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
         * Go back: return to previous view.
         */
        _goBack: function() {
            if (App.Router && App.Router.back) {
                App.Router.back();
            }
        },

        /**
         * Stop playback and clean up everything.
         */
        stop: function() {
            this._destroyed = true;

            // Clear progress timer
            if (this._progressSaveTimer) {
                clearInterval(this._progressSaveTimer);
                this._progressSaveTimer = null;
            }

            // Remove message handler
            if (this._messageHandler) {
                window.removeEventListener('message', this._messageHandler);
                this._messageHandler = null;
            }

            // Remove key handler
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
                this._keyHandler = null;
            }

            // Remove iframe
            if (this._iframe) {
                try {
                    this._iframe.src = 'about:blank';
                } catch (e) {}
                this._iframe = null;
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
            this._videoUrl = '';
            this._lastProgress = null;
            this._loadingOverlay = null;

            // Refresh data (continue watching may have changed)
            App.refreshData();
        },

        // Aliases for Router compatibility
        show: function(data) { this.play(data); },
        hide: function() { this.stop(); }
    };
})();
