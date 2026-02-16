import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2, ArrowLeftFromLine, X } from 'lucide-react';
import CastButton from './CastButton';
import { normalizeText } from '../utils/text';
import { getSessionToken } from '../utils/api';

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VideoPlayer({
  selectedVideo, videoRef, videos,
  volumeBoost, setVolumeBoost, showVolumeBoost, setShowVolumeBoost,
  allRequests, existingRequests,
  onTimeUpdate, onVideoLoaded, onClose,
  onSaveVideoProgress, onChangeAudio, onPlayClick,
  onAddRecommendationToRequests, onActorClick,
  casting, onCastClick
}) {
  // Player state
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);

  // Thumbnail preview state
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverX, setHoverX] = useState(0);
  const [thumbnailUrl, setThumbnailUrl] = useState(null);

  // Refs
  const containerRef = useRef(null);
  const seekBarRef = useRef(null);
  const hideTimerRef = useRef(null);
  const previewVideoRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const lastPreviewTimeRef = useRef(-1);
  const prevVolumeRef = useRef(1);

  // Video source URL
  const videoSrc = (() => {
    if (!selectedVideo) return '';
    const token = getSessionToken();
    const params = new URLSearchParams();
    if (selectedVideo.audioTrack !== undefined) params.set('audio', selectedVideo.audioTrack);
    if (token) params.set('session', token);
    const queryString = params.toString();
    return `${selectedVideo.url}${queryString ? '?' + queryString : ''}`;
  })();

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlaying && !isSeeking && hoverTime === null) setShowControls(false);
    }, 3000);
  }, [isPlaying, isSeeking, hoverTime]);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [isPlaying, resetHideTimer]);

  // Sync play state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => { video.removeEventListener('play', onPlay); video.removeEventListener('pause', onPause); };
  }, [videoRef, selectedVideo]);

  // Time update handler
  const handleTimeUpdateInternal = useCallback(() => {
    const video = videoRef.current;
    if (!video || isSeeking) return;
    setCurrentTime(video.currentTime);
    setDuration(video.duration || 0);
    if (video.buffered.length > 0) {
      setBuffered(video.buffered.end(video.buffered.length - 1));
    }
    onTimeUpdate();
  }, [videoRef, isSeeking, onTimeUpdate]);

  // Loaded metadata handler
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    setCurrentTime(video.currentTime);
    onVideoLoaded();
  }, [videoRef, onVideoLoaded]);

  // Play/Pause toggle
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }, [videoRef]);

  // Volume
  const handleVolumeChange = useCallback((val) => {
    const video = videoRef.current;
    if (!video) return;
    const v = parseFloat(val);
    setVolume(v);
    video.volume = v;
    if (v > 0) { setIsMuted(false); video.muted = false; }
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isMuted || volume === 0) {
      const restoreVol = prevVolumeRef.current > 0 ? prevVolumeRef.current : 0.5;
      video.muted = false;
      video.volume = restoreVol;
      setVolume(restoreVol);
      setIsMuted(false);
    } else {
      prevVolumeRef.current = volume;
      video.muted = true;
      setIsMuted(true);
    }
  }, [videoRef, isMuted, volume]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Picture-in-Picture
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled;

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !pipSupported) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error('PiP error:', err.message);
    }
  }, [videoRef, pipSupported]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnterPiP = () => setIsPiP(true);
    const onLeavePiP = () => setIsPiP(false);
    video.addEventListener('enterpictureinpicture', onEnterPiP);
    video.addEventListener('leavepictureinpicture', onLeavePiP);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPiP);
      video.removeEventListener('leavepictureinpicture', onLeavePiP);
    };
  }, [videoRef]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!selectedVideo) return;
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          resetHideTimer();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime -= 10;
          resetHideTimer();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime += 10;
          resetHideTimer();
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange(Math.min(1, volume + 0.1));
          resetHideTimer();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 0.1));
          resetHideTimer();
          break;
        case 'p':
          e.preventDefault();
          togglePiP();
          break;
        case 'Escape':
          if (isFullscreen) document.exitFullscreen().catch(() => {});
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedVideo, togglePlay, toggleFullscreen, togglePiP, toggleMute, handleVolumeChange, volume, isFullscreen, resetHideTimer, videoRef]);

  // Seek bar interaction
  const getTimeFromSeekBar = useCallback((e) => {
    const bar = seekBarRef.current;
    if (!bar || !duration) return 0;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return (x / rect.width) * duration;
  }, [duration]);

  const handleSeekStart = useCallback((e) => {
    e.preventDefault();
    setIsSeeking(true);
    const time = getTimeFromSeekBar(e);
    setCurrentTime(time);
  }, [getTimeFromSeekBar]);

  const handleSeekMove = useCallback((e) => {
    if (!isSeeking) return;
    const time = getTimeFromSeekBar(e);
    setCurrentTime(time);
  }, [isSeeking, getTimeFromSeekBar]);

  const handleSeekEnd = useCallback(() => {
    if (!isSeeking) return;
    setIsSeeking(false);
    const video = videoRef.current;
    if (video) video.currentTime = currentTime;
  }, [isSeeking, currentTime, videoRef]);

  useEffect(() => {
    if (!isSeeking) return;
    const move = (e) => handleSeekMove(e);
    const up = () => handleSeekEnd();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [isSeeking, handleSeekMove, handleSeekEnd]);

  // Seek bar click
  const handleSeekBarClick = useCallback((e) => {
    const time = getTimeFromSeekBar(e);
    setCurrentTime(time);
    const video = videoRef.current;
    if (video) video.currentTime = time;
  }, [getTimeFromSeekBar, videoRef]);

  // Thumbnail preview - setup hidden video
  useEffect(() => {
    if (!selectedVideo || !videoSrc) return;
    const pv = document.createElement('video');
    pv.preload = 'metadata';
    pv.muted = true;
    pv.src = videoSrc;
    pv.crossOrigin = 'anonymous';
    pv.style.display = 'none';
    document.body.appendChild(pv);
    previewVideoRef.current = pv;

    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 108;
    previewCanvasRef.current = canvas;

    return () => {
      pv.pause();
      pv.removeAttribute('src');
      pv.load();
      if (pv.parentNode) pv.parentNode.removeChild(pv);
      previewVideoRef.current = null;
      previewCanvasRef.current = null;
      lastPreviewTimeRef.current = -1;
    };
  }, [selectedVideo, videoSrc]);

  // Generate thumbnail on hover time change
  useEffect(() => {
    if (hoverTime === null) { setThumbnailUrl(null); return; }
    const pv = previewVideoRef.current;
    const canvas = previewCanvasRef.current;
    if (!pv || !canvas) return;

    if (Math.abs(hoverTime - lastPreviewTimeRef.current) < 2) return;
    lastPreviewTimeRef.current = hoverTime;

    const handleSeeked = () => {
      try {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(pv, 0, 0, canvas.width, canvas.height);
        setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.6));
      } catch {}
    };

    pv.addEventListener('seeked', handleSeeked, { once: true });
    pv.currentTime = hoverTime;

    return () => pv.removeEventListener('seeked', handleSeeked);
  }, [hoverTime]);

  // Seek bar hover
  const handleSeekHover = useCallback((e) => {
    const bar = seekBarRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const time = (x / rect.width) * duration;
    setHoverTime(time);
    setHoverX(x);
  }, [duration]);

  const handleSeekHoverEnd = useCallback(() => {
    setHoverTime(null);
    setThumbnailUrl(null);
  }, []);

  // Double click to toggle fullscreen
  const handleDoubleClick = useCallback((e) => {
    if (e.target.closest('.custom-controls') || e.target.closest('.video-header')) return;
    toggleFullscreen();
  }, [toggleFullscreen]);

  // Click video area to play/pause
  const handleVideoAreaClick = useCallback((e) => {
    if (e.target.closest('.custom-controls') || e.target.closest('.video-header') || e.detail === 2) return;
    togglePlay();
    resetHideTimer();
  }, [togglePlay, resetHideTimer]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <AnimatePresence>
      {selectedVideo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={isPiP
            ? "fixed inset-0 z-50 pointer-events-none"
            : "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-6 gap-4"
          }
        >
          {/* PiP compact bar */}
          {isPiP && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-full max-w-lg px-4 pointer-events-auto">
              <div className="bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4">
                <PictureInPicture2 size={18} className="text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{selectedVideo.title}</p>
                  <div className="w-full h-1 bg-slate-600 rounded-full mt-1">
                    <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <button
                  onClick={togglePiP}
                  title="Volver al reproductor"
                  className="text-slate-300 hover:text-white transition-colors p-1.5 hover:bg-white/10 rounded-lg"
                >
                  <ArrowLeftFromLine size={18} />
                </button>
                <button
                  onClick={() => { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); onClose(); }}
                  title="Cerrar"
                  className="text-slate-400 hover:text-red-400 transition-colors p-1.5 hover:bg-white/10 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Panel izquierdo vacío para centrar */}
          <div className={`hidden md:block w-44 flex-shrink-0 ${isPiP ? 'invisible' : ''}`} />

          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            className={`bg-slate-900 w-full max-w-5xl overflow-hidden shadow-2xl border border-slate-700 ${
              isFullscreen ? 'rounded-none max-w-none' : 'rounded-[3rem]'
            } ${isPiP ? 'invisible absolute' : ''}`}
            ref={containerRef}
          >
            {/* Header bar */}
            <div className={`p-6 flex justify-between items-center bg-slate-800 border-b border-slate-700 video-header ${
              isFullscreen ? 'hidden' : ''
            }`}>
              <span className="font-bold text-slate-200">{selectedVideo.title}</span>
              <div className="flex items-center gap-3">
                {selectedVideo.availableTracks && selectedVideo.availableTracks.length > 1 && (
                  <button
                    onClick={() => {
                      const video = videoRef.current;
                      if (video && selectedVideo) {
                        onSaveVideoProgress(selectedVideo.filename, video.currentTime, video.duration);
                      }
                      onChangeAudio(selectedVideo);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-600 rounded-xl hover:bg-indigo-200 transition-colors"
                    title={`Cambiar idioma (${selectedVideo.availableTracks.length} pistas)`}
                  >
                    <Volume2 size={18} />
                    <span className="text-sm font-medium">Audio ({selectedVideo.availableTracks.length})</span>
                  </button>
                )}
                <div className="relative">
                  <button
                    onClick={() => setShowVolumeBoost(!showVolumeBoost)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${
                      volumeBoost > 100
                        ? 'bg-green-100 text-green-600 hover:bg-green-200'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                    title="Amplificar volumen"
                  >
                    {'🔊'}
                    {volumeBoost > 100 && (
                      <span className="text-xs font-bold">{volumeBoost}%</span>
                    )}
                  </button>
                  {showVolumeBoost && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowVolumeBoost(false)} />
                      <div className="absolute top-full right-0 mt-2 bg-slate-900 rounded-xl shadow-xl border border-slate-600 p-4 z-50 w-64">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-slate-200">Amplificar Volumen</span>
                          <span className={`text-sm font-bold ${volumeBoost > 100 ? 'text-green-600' : 'text-slate-500'}`}>
                            {volumeBoost}%
                          </span>
                        </div>
                        <input
                          type="range" min="100" max="600" step="10" value={volumeBoost}
                          onChange={(e) => setVolumeBoost(parseInt(e.target.value))}
                          className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-green-500"
                        />
                        <div className="flex justify-between text-xs text-slate-400 mt-1">
                          <span>100%</span><span>300%</span><span>600%</span>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {[
                            { label: 'Normal', value: 100, cls: 'bg-slate-700 text-slate-200 hover:bg-slate-600' },
                            { label: '2x', value: 200, cls: 'bg-green-900 text-green-400 hover:bg-green-800' },
                            { label: '3x', value: 300, cls: 'bg-green-900 text-green-400 hover:bg-green-800' },
                            { label: '4x', value: 400, cls: 'bg-green-900 text-green-400 hover:bg-green-800' },
                            { label: '5x', value: 500, cls: 'bg-orange-900 text-orange-400 hover:bg-orange-800' },
                            { label: '6x', value: 600, cls: 'bg-red-900 text-red-400 hover:bg-red-800' },
                          ].map(btn => (
                            <button key={btn.value} onClick={() => setVolumeBoost(btn.value)}
                              className={`flex-1 px-2 py-1.5 text-xs rounded-lg ${btn.cls}`}
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {selectedVideo.runtime && (
                  <span className="text-sm text-slate-500 px-2">
                    {Math.floor(selectedVideo.runtime / 60)}h {selectedVideo.runtime % 60}m
                  </span>
                )}
                <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition-colors text-xl p-2">
                  {'✕'}
                </button>
              </div>
            </div>

            {/* Video container with custom controls */}
            <div
              className="relative bg-black select-none"
              onMouseMove={resetHideTimer}
              onClick={handleVideoAreaClick}
              onDoubleClick={handleDoubleClick}
            >
              <video
                key={selectedVideo.filename}
                ref={videoRef}
                src={videoSrc}
                autoPlay
                className={`w-full bg-black ${isFullscreen ? 'h-screen object-contain' : 'aspect-video'}`}
                onTimeUpdate={handleTimeUpdateInternal}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
              />

              {/* Synopsis overlay - top */}
              {selectedVideo.overview && !isFullscreen && (
                <div
                  className="absolute top-0 left-0 right-0 h-32 group z-10"
                  onMouseEnter={(e) => {
                    const overlay = e.currentTarget.querySelector('.synopsis-overlay');
                    if (overlay) overlay.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    const overlay = e.currentTarget.querySelector('.synopsis-overlay');
                    if (overlay) overlay.style.opacity = '0';
                  }}
                >
                  <div
                    className="synopsis-overlay absolute top-0 left-0 right-0 bg-gradient-to-b from-black/95 via-black/80 to-transparent p-6 pb-16 transition-opacity duration-300 pointer-events-none"
                    style={{ opacity: 0 }}
                  >
                    <h4 className="text-white font-bold text-lg mb-2 drop-shadow-lg">Sinopsis</h4>
                    <p className="text-white/90 text-sm leading-relaxed drop-shadow-md"
                      style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                    >
                      {selectedVideo.overview}
                    </p>
                  </div>
                </div>
              )}

              {/* Big play/pause button in center on click */}
              <AnimatePresence>
                {!isPlaying && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
                  >
                    <div className="bg-black/50 rounded-full p-6">
                      <Play size={48} className="text-white ml-1" fill="white" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Custom Controls Overlay */}
              <div
                className={`custom-controls absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300 ${
                  showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  setShowControls(true);
                  if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
                }}
                onMouseLeave={resetHideTimer}
              >
                {/* Seek bar */}
                <div className="px-4 pt-8 pb-1">
                  <div
                    ref={seekBarRef}
                    className="relative h-5 flex items-center cursor-pointer group/seek"
                    onMouseDown={handleSeekStart}
                    onClick={handleSeekBarClick}
                    onMouseMove={handleSeekHover}
                    onMouseLeave={handleSeekHoverEnd}
                  >
                    {/* Thumbnail preview tooltip */}
                    {hoverTime !== null && (
                      <div
                        className="absolute bottom-8 -translate-x-1/2 pointer-events-none z-30"
                        style={{ left: `${hoverX}px` }}
                      >
                        <div className="bg-black rounded-lg overflow-hidden shadow-xl border border-slate-600">
                          {thumbnailUrl ? (
                            <img src={thumbnailUrl} alt="" className="w-48 h-[108px] object-cover" />
                          ) : (
                            <div className="w-48 h-[108px] bg-slate-800 flex items-center justify-center">
                              <span className="text-slate-500 text-xs">Cargando...</span>
                            </div>
                          )}
                          <div className="text-center text-white text-xs py-1 bg-black/80 font-mono">
                            {formatTime(hoverTime)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Track background */}
                    <div className="absolute left-0 right-0 h-1 group-hover/seek:h-2 bg-white/20 rounded-full transition-all">
                      {/* Buffered */}
                      <div
                        className="absolute top-0 left-0 h-full bg-white/30 rounded-full"
                        style={{ width: `${bufferedProgress}%` }}
                      />
                      {/* Progress */}
                      <div
                        className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    {/* Thumb */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-indigo-500 rounded-full shadow-lg opacity-0 group-hover/seek:opacity-100 transition-opacity"
                      style={{ left: `calc(${progress}% - 8px)` }}
                    />

                    {/* Hover indicator line */}
                    {hoverTime !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-white/50 pointer-events-none"
                        style={{ left: `${hoverX}px` }}
                      />
                    )}
                  </div>
                </div>

                {/* Controls row */}
                <div className="flex items-center gap-3 px-4 pb-4 pt-1">
                  {/* Play/Pause */}
                  <button onClick={togglePlay} className="text-white hover:text-indigo-400 transition-colors p-1">
                    {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
                  </button>

                  {/* Volume */}
                  <div className="flex items-center gap-1 group/vol">
                    <button onClick={toggleMute} className="text-white hover:text-indigo-400 transition-colors p-1">
                      {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                    <div className="w-0 group-hover/vol:w-20 overflow-hidden transition-all duration-200">
                      <input
                        type="range" min="0" max="1" step="0.05"
                        value={isMuted ? 0 : volume}
                        onChange={(e) => handleVolumeChange(e.target.value)}
                        className="w-20 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Time display */}
                  <span className="text-white/80 text-sm font-mono select-none">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Title in fullscreen */}
                  {isFullscreen && (
                    <span className="text-white text-sm font-medium truncate max-w-xs">{selectedVideo.title}</span>
                  )}

                  {/* Cast a TV */}
                  {onCastClick && (
                    <CastButton casting={casting} onClick={onCastClick} />
                  )}

                  {/* Picture-in-Picture */}
                  {pipSupported && (
                    <button
                      onClick={togglePiP}
                      title="Picture in Picture (P)"
                      className={`p-1 transition-colors ${isPiP ? 'text-amber-400 hover:text-amber-300' : 'text-white hover:text-indigo-400'}`}
                    >
                      <PictureInPicture2 size={20} />
                    </button>
                  )}

                  {/* Fullscreen */}
                  <button onClick={toggleFullscreen} className="text-white hover:text-indigo-400 transition-colors p-1">
                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Recommended movies */}
            {!isFullscreen && selectedVideo.recommendations && selectedVideo.recommendations.length > 0 && (
              <div className="p-4 bg-slate-800 border-t border-slate-700">
                <h4 className="text-sm font-bold text-slate-600 mb-3">Pel{'í'}culas similares</h4>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {selectedVideo.recommendations.map((rec) => {
                    const isInLibrary = videos.some(v => v.tmdbId === rec.tmdbId);
                    const isRequested = allRequests.some(r => r.tmdbId === rec.tmdbId) ||
                                        existingRequests.some(r => r.tmdbId === rec.tmdbId);
                    return (
                      <div
                        key={rec.tmdbId}
                        className={`relative flex-shrink-0 w-20 cursor-pointer hover:opacity-80 transition-all ${
                          isInLibrary ? 'ring-2 ring-green-500 ring-offset-2 rounded-lg' :
                          isRequested ? 'ring-2 ring-amber-500 ring-offset-2 rounded-lg' : ''
                        }`}
                        onClick={() => {
                          let found = videos.find(v => v.tmdbId === rec.tmdbId);
                          if (!found) {
                            const recTitleLower = normalizeText(rec.title);
                            found = videos.find(v => v.title === rec.title);
                            if (!found) {
                              found = videos.find(v => {
                                const vTitleLower = normalizeText(v.title);
                                return vTitleLower === recTitleLower || vTitleLower.includes(recTitleLower) || recTitleLower.includes(vTitleLower);
                              });
                            }
                          }
                          if (found) { onClose(); setTimeout(() => onPlayClick(found), 400); }
                          else { alert(`"${rec.title}" no est\u00E1 en tu biblioteca`); }
                        }}
                        onContextMenu={(e) => { e.preventDefault(); onAddRecommendationToRequests(rec); }}
                        title={`${rec.title} (${rec.releaseDate?.split('-')[0] || '?'}) - \u2B50 ${rec.rating?.toFixed(1) || '?'}${rec.overview ? '\n\n' + rec.overview : ''}\n\n\uD83D\uDCA1 Clic izq: reproducir | Clic der: a\u00F1adir a peticiones`}
                      >
                        {rec.poster ? (
                          <img src={rec.poster} alt={rec.title} className="w-20 h-28 object-cover rounded-lg shadow" />
                        ) : (
                          <div className="w-20 h-28 bg-slate-200 rounded-lg flex items-center justify-center">
                            <span className="text-xs text-slate-400">Sin imagen</span>
                          </div>
                        )}
                        <p className="text-xs text-slate-600 mt-1 truncate">{rec.title}</p>
                        {isInLibrary && (
                          <div className="absolute -top-1 -right-1 bg-green-500 text-white text-[8px] px-1 rounded-full">{'\u2713'}</div>
                        )}
                        {!isInLibrary && isRequested && (
                          <div className="absolute -top-1 -right-1 bg-amber-500 text-white text-[8px] px-1 rounded-full">{'\u23F3'}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>

          {/* Cast Panel - Right */}
          {!isFullscreen && !isPiP && selectedVideo.cast && selectedVideo.cast.length > 0 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="hidden md:flex flex-col w-44 flex-shrink-0 bg-slate-900/95 backdrop-blur rounded-2xl shadow-xl max-h-[80vh] overflow-hidden"
            >
              <div className="p-3 bg-slate-800 border-b border-slate-700">
                <h3 className="font-bold text-slate-200 text-sm">{'\uD83C\uDFAD'} Reparto</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {selectedVideo.cast.map((actor) => (
                  <div
                    key={actor.id}
                    onClick={() => onActorClick(actor)}
                    className="flex items-center gap-2 p-2 rounded-xl hover:bg-indigo-50 cursor-pointer transition-colors group"
                    title={`Ver pel\u00EDculas de ${actor.name}`}
                  >
                    {actor.photo ? (
                      <img src={actor.photo} alt={actor.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-slate-400 text-xs">{'\uD83D\uDC64'}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate group-hover:text-indigo-600">{actor.name}</p>
                      {actor.character && (
                        <p className="text-[10px] text-slate-400 truncate">{actor.character}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
