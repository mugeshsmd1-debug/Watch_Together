/**
 * Video Synchronization and Player Engine
 * Keeps movie playback in sync between peers with clock drift compensation and latency correction.
 */
class VideoSyncManager {
  constructor(videoElement, socket, uiElements) {
    this.video = videoElement;
    this.socket = socket;
    this.ui = uiElements;

    this.isRemoteUpdate = false;
    this.isUserScrubbing = false;
    this.driftThresholdHard = 1.2; // seconds (hard seek)
    this.driftThresholdSoft = 0.25; // seconds (playbackRate micro-nudge)
    this.speedAdjustmentTimer = null;

    this.initPlayerListeners();
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  initPlayerListeners() {
    // 1. Video timeupdate (updates scrubber and timestamps)
    this.video.addEventListener('timeupdate', () => {
      if (this.isUserScrubbing) return;

      const current = this.video.currentTime || 0;
      const duration = this.video.duration || 1;
      const pct = (current / duration) * 100;

      if (this.ui.labelCurrentTime) {
        this.ui.labelCurrentTime.textContent = this.formatTime(current);
      }
      if (this.ui.progressFill) {
        this.ui.progressFill.style.width = `${pct}%`;
      }
      if (this.ui.progressHandle) {
        this.ui.progressHandle.style.left = `${pct}%`;
      }
    });

    // 2. Video durationchange
    this.video.addEventListener('durationchange', () => {
      if (this.ui.labelDurationTime) {
        this.ui.labelDurationTime.textContent = this.formatTime(this.video.duration);
      }
    });

    // 3. Progress buffer indicator
    this.video.addEventListener('progress', () => {
      if (this.video.buffered.length > 0 && this.video.duration) {
        const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
        const pct = (bufferedEnd / this.video.duration) * 100;
        if (this.ui.progressBuffer) {
          this.ui.progressBuffer.style.width = `${pct}%`;
        }
      }
    });

    // 4. Local User Play Event
    this.video.addEventListener('play', () => {
      this.updatePlayPauseUI(true);
      if (this.isRemoteUpdate) return;

      console.log('Local play event emitted');
      this.socket.emit('video-action', {
        type: 'play',
        currentTime: this.video.currentTime,
        timestamp: Date.now()
      });
      this.flashCenterIndicator('play');
    });

    // 5. Local User Pause Event
    this.video.addEventListener('pause', () => {
      this.updatePlayPauseUI(false);
      if (this.isRemoteUpdate) return;

      console.log('Local pause event emitted');
      this.socket.emit('video-action', {
        type: 'pause',
        currentTime: this.video.currentTime,
        timestamp: Date.now()
      });
      this.flashCenterIndicator('pause');
    });

    // 6. Local User Seeked Event
    this.video.addEventListener('seeked', () => {
      if (this.isRemoteUpdate) return;

      console.log('Local seek event emitted:', this.video.currentTime);
      this.socket.emit('video-action', {
        type: 'seek',
        currentTime: this.video.currentTime,
        timestamp: Date.now()
      });
    });

    // 7. Scrubber Touch / Mouse Dragging
    this.setupScrubberEvents();

    // 8. Control buttons
    if (this.ui.btnPlayPause) {
      this.ui.btnPlayPause.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePlay();
      });
    }

    if (this.ui.btnRewind) {
      this.ui.btnRewind.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seekRelative(-10);
      });
    }

    if (this.ui.btnForward) {
      this.ui.btnForward.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seekRelative(10);
      });
    }

    if (this.ui.btnFullscreen) {
      this.ui.btnFullscreen.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFullscreen();
      });
    }

    // Tap video to toggle controls or play/pause
    this.video.addEventListener('click', () => {
      this.togglePlay();
    });
  }

  togglePlay() {
    if (this.video.paused) {
      this.video.play().catch((err) => {
        console.warn('Play was blocked (user interaction required):', err);
      });
    } else {
      this.video.pause();
    }
  }

  seekRelative(deltaSeconds) {
    const newTime = Math.max(0, Math.min(this.video.duration || 0, this.video.currentTime + deltaSeconds));
    this.video.currentTime = newTime;
  }

  updatePlayPauseUI(isPlaying) {
    if (this.ui.iconPlay && this.ui.iconPause) {
      this.ui.iconPlay.style.display = isPlaying ? 'none' : 'block';
      this.ui.iconPause.style.display = isPlaying ? 'block' : 'none';
    }
  }

  flashCenterIndicator(type) {
    if (!this.ui.centerPlayIndicator) return;
    const icon = this.ui.centerPlayIndicator.querySelector('svg');
    if (type === 'play') {
      icon.innerHTML = '<polygon points="6 3 20 12 6 21 6 3"></polygon>';
    } else {
      icon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
    }
    this.ui.centerPlayIndicator.classList.add('show');
    clearTimeout(this._flashTimeout);
    this._flashTimeout = setTimeout(() => {
      this.ui.centerPlayIndicator.classList.remove('show');
    }, 450);
  }

  setupScrubberEvents() {
    const track = this.ui.progressTrack;
    if (!track) return;

    const handleScrub = (clientX) => {
      const rect = track.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetTime = pos * (this.video.duration || 0);

      if (this.ui.progressFill) this.ui.progressFill.style.width = `${pos * 100}%`;
      if (this.ui.progressHandle) this.ui.progressHandle.style.left = `${pos * 100}%`;
      if (this.ui.labelCurrentTime) this.ui.labelCurrentTime.textContent = this.formatTime(targetTime);

      return targetTime;
    };

    // Touch events for mobile Safari
    track.addEventListener('touchstart', (e) => {
      this.isUserScrubbing = true;
      const clientX = e.touches[0].clientX;
      handleScrub(clientX);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!this.isUserScrubbing) return;
      const clientX = e.touches[0].clientX;
      handleScrub(clientX);
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      if (!this.isUserScrubbing) return;
      this.isUserScrubbing = false;
      const clientX = e.changedTouches[0].clientX;
      const finalTime = handleScrub(clientX);
      this.video.currentTime = finalTime;
    });

    // Pointer events for desktop
    track.addEventListener('pointerdown', (e) => {
      this.isUserScrubbing = true;
      handleScrub(e.clientX);
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isUserScrubbing) return;
      handleScrub(e.clientX);
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.isUserScrubbing) return;
      this.isUserScrubbing = false;
      const finalTime = handleScrub(e.clientX);
      this.video.currentTime = finalTime;
    });
  }

  /**
   * Handle incoming synchronization action from friend or server
   */
  handleSyncAction(action) {
    this.isRemoteUpdate = true;
    const now = Date.now();
    const networkDelay = (now - (action.serverTimestamp || now)) / 1000;

    console.log(`[Sync Action: ${action.type}] From: ${action.senderName || 'Peer'}, delay: ${networkDelay.toFixed(3)}s`);

    if (action.type === 'change-source') {
      this.loadVideoSource(action.src, action.title, action.currentTime || 0, action.isPlaying);
      this.isRemoteUpdate = false;
      return;
    }

    const expectedCurrentTime = action.currentTime + (action.isPlaying ? networkDelay : 0);
    const drift = Math.abs(this.video.currentTime - expectedCurrentTime);

    if (action.type === 'play') {
      if (drift > this.driftThresholdHard) {
        this.video.currentTime = expectedCurrentTime;
      }
      this.video.play().catch(() => {});
      this.updatePlayPauseUI(true);
      this.flashCenterIndicator('play');
    } else if (action.type === 'pause') {
      this.video.pause();
      if (drift > 0.3) {
        this.video.currentTime = action.currentTime;
      }
      this.updatePlayPauseUI(false);
      this.flashCenterIndicator('pause');
    } else if (action.type === 'seek') {
      this.video.currentTime = expectedCurrentTime;
    }

    setTimeout(() => {
      this.isRemoteUpdate = false;
    }, 150);
  }

  /**
   * Continuous sync drift compensation
   */
  handleSyncPulse(pulse) {
    if (this.isUserScrubbing || this.isRemoteUpdate) return;

    const now = Date.now();
    const delay = (now - pulse.serverTimestamp) / 1000;
    const targetTime = pulse.currentTime + (pulse.isPlaying ? delay : 0);
    const drift = Math.abs(this.video.currentTime - targetTime);

    const syncPill = document.getElementById('sync-pill');
    const syncText = document.getElementById('sync-pill-text');

    if (drift < 0.2) {
      if (syncPill) syncPill.style.borderColor = 'rgba(48, 209, 88, 0.4)';
      if (syncText) syncText.textContent = 'Synced';
    } else if (drift < this.driftThresholdHard) {
      if (syncPill) syncPill.style.borderColor = 'rgba(255, 159, 10, 0.5)';
      if (syncText) syncText.textContent = 'Aligning...';

      // Soft rate nudge: speed up or slow down slightly without skipping frames
      if (pulse.isPlaying && !this.video.paused) {
        clearTimeout(this.speedAdjustmentTimer);
        this.video.playbackRate = (this.video.currentTime < targetTime) ? 1.05 : 0.95;
        this.speedAdjustmentTimer = setTimeout(() => {
          this.video.playbackRate = 1.0;
        }, 1500);
      }
    } else {
      // Hard seek if drift is severe
      console.log(`[Drift Warning] Drift is ${drift.toFixed(2)}s. Performing hard seek to ${targetTime.toFixed(2)}s`);
      this.isRemoteUpdate = true;
      this.video.currentTime = targetTime;
      if (pulse.isPlaying && this.video.paused) {
        this.video.play().catch(() => {});
      }
      setTimeout(() => {
        this.isRemoteUpdate = false;
      }, 150);
    }
  }

  /**
   * Change movie source (Sample movie, local file object URL, or custom URL)
   */
  loadVideoSource(src, title, startTime = 0, autoPlay = false) {
    this.video.src = src;
    if (this.ui.videoTitle) {
      this.ui.videoTitle.textContent = title || 'Movie';
    }
    this.video.load();

    const onLoaded = () => {
      this.video.currentTime = startTime;
      if (autoPlay) {
        this.video.play().catch(() => {});
      }
      this.video.removeEventListener('loadedmetadata', onLoaded);
    };

    this.video.addEventListener('loadedmetadata', onLoaded);
  }

  toggleFullscreen() {
    const stage = document.getElementById('movie-stage');
    if (!stage) return;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (stage.requestFullscreen) {
        stage.requestFullscreen().catch(() => {});
      } else if (stage.webkitRequestFullscreen) {
        stage.webkitRequestFullscreen();
      } else if (this.video.webkitEnterFullscreen) {
        // iOS Safari native video fullscreen fallback
        this.video.webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }
}

window.VideoSyncManager = VideoSyncManager;
