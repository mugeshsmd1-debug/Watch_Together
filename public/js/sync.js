/**
 * VideoPlayerController (formerly VideoSyncManager)
 * Manages player UI, time formatting, scrubber dragging, and play/pause controls.
 * Operates purely locally without network sync pulses, as movie streaming is handled
 * directly via real-time WebRTC live media stream (Google Meet style).
 */
class VideoSyncManager {
  constructor(videoElement, socket, uiElements) {
    this.video = videoElement;
    this.socket = socket;
    this.ui = uiElements;

    this.isUserScrubbing = false;
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
      const pct = duration > 0 ? (current / duration) * 100 : 0;

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
      if (this.ui.labelDurationTime && this.video.duration && !isNaN(this.video.duration)) {
        this.ui.labelDurationTime.textContent = this.formatTime(this.video.duration);
      }
    });

    // 3. Local User Play Event
    this.video.addEventListener('play', () => {
      this.updatePlayPauseUI(true);
      this.flashCenterIndicator('play');
    });

    // 4. Local User Pause Event
    this.video.addEventListener('pause', () => {
      this.updatePlayPauseUI(false);
      this.flashCenterIndicator('pause');
    });

    // 5. Scrubber Touch / Mouse Dragging
    this.setupScrubberEvents();

    // 6. Control buttons
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

    // Tap video: if controls hidden, reveal without pausing; if visible, toggle play
    this.video.addEventListener('click', (e) => {
      const screenRoom = document.getElementById('screen-room');
      if (screenRoom && screenRoom.classList.contains('controls-hidden')) {
        screenRoom.classList.remove('controls-hidden');
        return;
      }
      // If user is watching a live stream, don't pause the stream on click
      if (window.movieStream && window.movieStream.isWatching) {
        return;
      }
      this.togglePlay();
    });
  }

  togglePlay() {
    if (window.movieStream && window.movieStream.isWatching) {
      // Watching a live stream; video is driven by WebRTC
      return;
    }
    if (this.video.paused) {
      this.video.play().catch((err) => {
        console.warn('Play note:', err);
      });
    } else {
      this.video.pause();
    }
  }

  seekRelative(deltaSeconds) {
    if (window.movieStream && window.movieStream.isWatching) {
      return;
    }
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
      if (window.movieStream && window.movieStream.isWatching) return 0;
      const rect = track.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetTime = pos * (this.video.duration || 0);

      if (this.ui.progressFill) this.ui.progressFill.style.width = `${pos * 100}%`;
      if (this.ui.progressHandle) this.ui.progressHandle.style.left = `${pos * 100}%`;
      if (this.ui.labelCurrentTime) this.ui.labelCurrentTime.textContent = this.formatTime(targetTime);

      return targetTime;
    };

    track.addEventListener('touchstart', (e) => {
      if (window.movieStream && window.movieStream.isWatching) return;
      this.isUserScrubbing = true;
      handleScrub(e.touches[0].clientX);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!this.isUserScrubbing) return;
      handleScrub(e.touches[0].clientX);
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      if (!this.isUserScrubbing) return;
      this.isUserScrubbing = false;
      const finalTime = handleScrub(e.changedTouches[0].clientX);
      this.video.currentTime = finalTime;
    });

    track.addEventListener('pointerdown', (e) => {
      if (window.movieStream && window.movieStream.isWatching) return;
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

  toggleFullscreen() {
    const stage = document.getElementById('movie-stage') || this.video;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (stage.requestFullscreen) {
        stage.requestFullscreen().catch(() => {});
      } else if (stage.webkitRequestFullscreen) {
        stage.webkitRequestFullscreen();
      } else if (this.video.webkitEnterFullscreen) {
        this.video.webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  loadVideoSource(src, title) {
    if (this.ui.videoTitle) {
      this.ui.videoTitle.textContent = title || 'Movie';
    }
    this.video.srcObject = null;
    this.video.src = src;
    this.video.load();
    this.video.play().catch(() => {});
  }
}

window.VideoSyncManager = VideoSyncManager;
