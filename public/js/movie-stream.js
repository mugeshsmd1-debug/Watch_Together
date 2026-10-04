/**
 * MovieStreamManager — Google Meet Style Live Movie & Screen Streaming
 * One device streams their movie file, screen share, or sample video.
 * Other devices in the room simply watch the live stream in real-time.
 * No synchronization pulses or dual-file seeking needed — exactly like Google Meet / Discord screenshare.
 */
class MovieStreamManager {
  constructor(socket, mainVideoElement, callbacks = {}) {
    this.socket = socket;
    this.mainVideo = mainVideoElement;
    this.callbacks = callbacks; // onStreamStateChange, onToast, onAutoplayPrompt

    this.isStreamer = false;
    this.isWatching = false;
    this.streamerId = null;
    this.streamerName = '';
    this.streamTitle = '';
    this.streamType = 'file'; // 'file' | 'screen' | 'sample'

    this.localMovieStream = null;
    this.remoteMovieStream = null;
    this.moviePC = null;
    this.targetPeerId = null;
    this.iceCandidateQueue = [];

    this.audioContext = null;
    this.audioSourceNode = null;
    this.audioDestNode = null;

    // WebRTC STUN/TURN configuration
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:openrelay.metered.ca:80' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelay',
          credential: 'openrelay'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelay',
          credential: 'openrelay'
        },
        {
          urls: 'turns:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelay',
          credential: 'openrelay'
        }
      ],
      iceCandidatePoolSize: 10
    };

    this.initSocketListeners();
  }

  initSocketListeners() {
    this.socket.on('movie-signal-offer', async ({ senderId, sdp }) => {
      console.log('[Movie WebRTC] Received offer from streamer:', senderId);
      await this.handleMovieOffer(senderId, sdp);
    });

    this.socket.on('movie-signal-answer', async ({ sdp }) => {
      console.log('[Movie WebRTC] Received answer from watcher');
      await this.handleMovieAnswer(sdp);
    });

    this.socket.on('movie-signal-ice', async ({ candidate }) => {
      await this.handleMovieIce(candidate);
    });

    // When someone starts streaming, watcher updates UI and requests the live stream
    this.socket.on('movie-stream-started', (data) => {
      console.log('[Movie Stream] Friend started streaming:', data);
      this.isWatching = true;
      this.isStreamer = false;
      this.streamerId = data.streamerId;
      this.streamerName = data.streamerName || 'Friend';
      this.streamTitle = data.title || 'Live Stream';
      this.streamType = data.streamType || 'file';

      if (this.callbacks.onStreamStateChange) {
        this.callbacks.onStreamStateChange({
          isStreamer: false,
          isWatching: true,
          streamerName: this.streamerName,
          title: this.streamTitle,
          streamType: this.streamType
        });
      }

      if (this.callbacks.onToast) {
        this.callbacks.onToast(`🔴 ${this.streamerName} is now streaming "${this.streamTitle}"!`, '🍿');
      }

      // Request stream from streamer
      this.socket.emit('movie-stream-request', {
        targetId: data.streamerId
      });
    });

    // Streamer receives request from watcher and initiates WebRTC offer
    this.socket.on('movie-stream-request', ({ watcherId }) => {
      console.log('[Movie Stream] Received movie stream request from watcher:', watcherId);
      if (this.isStreamer && this.localMovieStream) {
        this.initiateMoviePeerConnection(watcherId);
      }
    });

    this.socket.on('movie-stream-stopped', () => {
      console.log('[Movie Stream] Streamer stopped streaming');
      if (this.isWatching) {
        this.stopWatching();
        if (this.callbacks.onToast) {
          this.callbacks.onToast('Live movie stream ended', '🎬');
        }
      }
    });
  }

  /**
   * 1. Start streaming a local movie file (MP4, MKV, WebM, MOV)
   */
  async startFileStream(file, activePeerId = null) {
    if (!file) return false;
    try {
      this.stopStream(false);

      const fileUrl = URL.createObjectURL(file);
      this.streamTitle = file.name;
      this.streamType = 'file';
      this.isStreamer = true;
      this.isWatching = false;

      this.mainVideo.srcObject = null;
      this.mainVideo.src = fileUrl;
      this.mainVideo.muted = false;

      await this.mainVideo.play().catch((err) => {
        console.warn('Initial play note:', err);
      });

      // Wait until metadata/frames are ready before capturing
      if (this.mainVideo.readyState < 2) {
        await new Promise((resolve) => {
          const onReady = () => {
            this.mainVideo.removeEventListener('loadeddata', onReady);
            this.mainVideo.removeEventListener('canplay', onReady);
            resolve();
          };
          this.mainVideo.addEventListener('loadeddata', onReady);
          this.mainVideo.addEventListener('canplay', onReady);
          setTimeout(resolve, 800);
        });
      }

      // Capture audio + video from video element
      let stream = null;
      if (typeof this.mainVideo.captureStream === 'function') {
        stream = this.mainVideo.captureStream();
      } else if (typeof this.mainVideo.mozCaptureStream === 'function') {
        stream = this.mainVideo.mozCaptureStream();
      }

      if (!stream) {
        throw new Error('captureStream is not supported by your browser for direct video capture.');
      }

      this.setupAudioCapture(this.mainVideo, stream);
      this.localMovieStream = stream;

      // Announce stream to room
      this.socket.emit('movie-stream-started', {
        title: this.streamTitle,
        streamType: 'file'
      });

      if (this.callbacks.onStreamStateChange) {
        this.callbacks.onStreamStateChange({
          isStreamer: true,
          isWatching: false,
          streamerName: 'You',
          title: this.streamTitle,
          streamType: 'file'
        });
      }

      if (activePeerId) {
        this.initiateMoviePeerConnection(activePeerId);
      }

      return true;
    } catch (err) {
      console.error('Error starting local file stream:', err);
      if (this.callbacks.onToast) {
        this.callbacks.onToast(`Could not stream file directly: ${err.message}`, '⚠️');
      }
      return false;
    }
  }

  /**
   * 2. Start streaming Screen / Tab / Window (Google Meet style)
   */
  async startScreenStream(activePeerId = null) {
    try {
      this.stopStream(false);

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          cursor: 'always'
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      this.streamTitle = 'Screen / Tab Stream';
      this.streamType = 'screen';
      this.isStreamer = true;
      this.isWatching = false;

      this.mainVideo.src = '';
      this.mainVideo.srcObject = screenStream;
      this.mainVideo.muted = true; // Mute locally to prevent microphone loopback
      await this.mainVideo.play().catch(() => {});

      this.localMovieStream = screenStream;

      // Listen for browser "Stop sharing" bar
      const videoTrack = screenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log('Screen sharing ended by user');
          this.stopStream(true);
        };
      }

      this.socket.emit('movie-stream-started', {
        title: this.streamTitle,
        streamType: 'screen'
      });

      if (this.callbacks.onStreamStateChange) {
        this.callbacks.onStreamStateChange({
          isStreamer: true,
          isWatching: false,
          streamerName: 'You',
          title: this.streamTitle,
          streamType: 'screen'
        });
      }

      if (activePeerId) {
        this.initiateMoviePeerConnection(activePeerId);
      }

      return true;
    } catch (err) {
      console.warn('Screen share cancelled or not allowed:', err);
      return false;
    }
  }

  /**
   * 3. Start streaming sample movie (Big Buck Bunny)
   */
  async startSampleStream(activePeerId = null) {
    try {
      this.stopStream(false);

      const sampleUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
      this.streamTitle = 'Big Buck Bunny (Sample HD)';
      this.streamType = 'sample';
      this.isStreamer = true;
      this.isWatching = false;

      this.mainVideo.crossOrigin = 'anonymous';
      this.mainVideo.srcObject = null;
      this.mainVideo.src = sampleUrl;
      this.mainVideo.muted = false;

      await this.mainVideo.play().catch((err) => {
        console.warn('Sample video play note:', err);
      });

      if (this.mainVideo.readyState < 2) {
        await new Promise((resolve) => {
          const onReady = () => {
            this.mainVideo.removeEventListener('loadeddata', onReady);
            resolve();
          };
          this.mainVideo.addEventListener('loadeddata', onReady);
          setTimeout(resolve, 800);
        });
      }

      let stream = null;
      if (typeof this.mainVideo.captureStream === 'function') {
        stream = this.mainVideo.captureStream();
      } else if (typeof this.mainVideo.mozCaptureStream === 'function') {
        stream = this.mainVideo.mozCaptureStream();
      }

      if (stream) {
        this.setupAudioCapture(this.mainVideo, stream);
        this.localMovieStream = stream;
      }

      this.socket.emit('movie-stream-started', {
        title: this.streamTitle,
        streamType: 'sample'
      });

      if (this.callbacks.onStreamStateChange) {
        this.callbacks.onStreamStateChange({
          isStreamer: true,
          isWatching: false,
          streamerName: 'You',
          title: this.streamTitle,
          streamType: 'sample'
        });
      }

      if (activePeerId) {
        this.initiateMoviePeerConnection(activePeerId);
      }

      return true;
    } catch (err) {
      console.error('Error starting sample stream:', err);
      return false;
    }
  }

  /**
   * Setup Web Audio routing to capture audio track reliably into the stream
   */
  setupAudioCapture(videoElement, stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext) {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const existingAudio = stream.getAudioTracks();
      if (existingAudio && existingAudio.length > 0) {
        console.log('[Movie Stream] Video already has native audio track');
        return;
      }

      if (!this.audioSourceNode) {
        try {
          this.audioSourceNode = this.audioContext.createMediaElementSource(videoElement);
          this.audioDestNode = this.audioContext.createMediaStreamDestination();
          this.audioSourceNode.connect(this.audioDestNode);
          this.audioSourceNode.connect(this.audioContext.destination);
        } catch (e) {
          console.warn('AudioElementSource note:', e);
        }
      }

      if (this.audioDestNode) {
        const audioTrack = this.audioDestNode.stream.getAudioTracks()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
          console.log('[Movie Stream] Attached Web Audio stereo track to stream');
        }
      }
    } catch (err) {
      console.warn('Audio capture note:', err);
    }
  }

  /**
   * WebRTC: Streamer initiates connection to Watcher peer
   */
  async initiateMoviePeerConnection(remotePeerId) {
    if (!remotePeerId || !this.localMovieStream) return;
    this.targetPeerId = remotePeerId;
    console.log('[Movie WebRTC] Initiating movie stream connection to:', remotePeerId);

    if (this.moviePC) {
      try { this.moviePC.close(); } catch (_) {}
    }

    this.moviePC = new RTCPeerConnection(this.rtcConfig);
    this.iceCandidateQueue = [];

    // Add movie video and audio tracks
    this.localMovieStream.getTracks().forEach((track) => {
      console.log(`[Movie WebRTC] Adding ${track.kind} track to movie peer`);
      this.moviePC.addTrack(track, this.localMovieStream);
    });

    this.moviePC.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('movie-signal-ice', {
          targetId: remotePeerId,
          candidate: event.candidate
        });
      }
    };

    this.moviePC.onconnectionstatechange = () => {
      console.log('[Movie WebRTC] Streamer PC state:', this.moviePC.connectionState);
      if (this.moviePC.connectionState === 'connected') {
        if (this.callbacks.onToast) {
          this.callbacks.onToast('Friend is now watching your stream! 🍿', '📡');
        }
      }
    };

    try {
      const offer = await this.moviePC.createOffer();
      await this.moviePC.setLocalDescription(offer);

      this.socket.emit('movie-signal-offer', {
        targetId: remotePeerId,
        sdp: offer
      });
    } catch (err) {
      console.error('[Movie WebRTC] Error creating movie offer:', err);
    }
  }

  /**
   * WebRTC: Watcher handles offer from Streamer
   */
  async handleMovieOffer(senderId, sdp) {
    this.targetPeerId = senderId;
    this.isWatching = true;
    this.isStreamer = false;

    console.log('[Movie WebRTC] Handling offer from streamer:', senderId);

    if (this.moviePC) {
      try { this.moviePC.close(); } catch (_) {}
    }

    this.moviePC = new RTCPeerConnection(this.rtcConfig);
    this.iceCandidateQueue = [];

    this.moviePC.ontrack = (event) => {
      console.log('[Movie WebRTC] Watcher received remote movie track:', event.track.kind);
      if (event.streams && event.streams[0]) {
        this.remoteMovieStream = event.streams[0];
      } else {
        if (!this.remoteMovieStream) {
          this.remoteMovieStream = new MediaStream();
        }
        this.remoteMovieStream.addTrack(event.track);
      }

      if (this.mainVideo.srcObject !== this.remoteMovieStream) {
        this.mainVideo.src = '';
        this.mainVideo.srcObject = this.remoteMovieStream;
        this.mainVideo.muted = false;

        const playPromise = this.mainVideo.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('Autoplay prevented unmuted movie playback, falling back to muted:', err);
            this.mainVideo.muted = true;
            this.mainVideo.play().catch(() => {});
            if (this.callbacks.onAutoplayPrompt) {
              this.callbacks.onAutoplayPrompt();
            }
          });
        }
      }

      // Hide standby overlay immediately when remote track arrives
      if (this.callbacks.onStreamStateChange) {
        this.callbacks.onStreamStateChange({
          isStreamer: false,
          isWatching: true,
          streamerName: this.streamerName || 'Friend',
          title: this.streamTitle || 'Movie Stream',
          streamType: this.streamType
        });
      }
    };

    this.moviePC.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('movie-signal-ice', {
          targetId: senderId,
          candidate: event.candidate
        });
      }
    };

    this.moviePC.onconnectionstatechange = () => {
      console.log('[Movie WebRTC] Watcher PC state:', this.moviePC.connectionState);
      if (this.moviePC.connectionState === 'connected') {
        if (this.callbacks.onToast) {
          this.callbacks.onToast('Connected to live movie stream! Enjoy the show 🍿', '✨');
        }
      }
    };

    try {
      await this.moviePC.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushIceCandidateQueue();

      const answer = await this.moviePC.createAnswer();
      await this.moviePC.setLocalDescription(answer);

      this.socket.emit('movie-signal-answer', {
        targetId: senderId,
        sdp: answer
      });
    } catch (err) {
      console.error('[Movie WebRTC] Error handling movie offer:', err);
    }
  }

  async handleMovieAnswer(sdp) {
    try {
      if (this.moviePC && this.moviePC.signalingState === 'have-local-offer') {
        await this.moviePC.setRemoteDescription(new RTCSessionDescription(sdp));
        await this.flushIceCandidateQueue();
      }
    } catch (err) {
      console.error('[Movie WebRTC] Error setting remote description for answer:', err);
    }
  }

  async handleMovieIce(candidate) {
    if (!candidate) return;
    try {
      if (!this.moviePC || !this.moviePC.remoteDescription || !this.moviePC.remoteDescription.type) {
        this.iceCandidateQueue.push(candidate);
        return;
      }
      await this.moviePC.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[Movie WebRTC] Error adding ICE candidate:', err);
    }
  }

  async flushIceCandidateQueue() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      try {
        await this.moviePC.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[Movie WebRTC] Failed to flush ICE candidate:', err);
      }
    }
  }

  /**
   * Stop Watching remote stream
   */
  stopWatching() {
    this.isWatching = false;
    this.streamerId = null;
    this.streamerName = '';
    this.streamTitle = '';

    if (this.moviePC) {
      try { this.moviePC.close(); } catch (_) {}
      this.moviePC = null;
    }

    if (this.mainVideo) {
      this.mainVideo.srcObject = null;
      this.mainVideo.src = '';
    }

    if (this.callbacks.onStreamStateChange) {
      this.callbacks.onStreamStateChange({
        isStreamer: false,
        isWatching: false
      });
    }
  }

  /**
   * Stop Streaming local movie or screen share
   */
  stopStream(notifyPeers = true) {
    if (!this.isStreamer && !this.isWatching) return;

    this.isStreamer = false;
    this.isWatching = false;

    if (this.localMovieStream) {
      this.localMovieStream.getTracks().forEach((track) => track.stop());
      this.localMovieStream = null;
    }

    if (this.moviePC) {
      try { this.moviePC.close(); } catch (_) {}
      this.moviePC = null;
    }

    if (this.mainVideo) {
      this.mainVideo.pause();
      this.mainVideo.srcObject = null;
      this.mainVideo.src = '';
    }

    if (notifyPeers) {
      this.socket.emit('movie-stream-stopped', {});
    }

    if (this.callbacks.onStreamStateChange) {
      this.callbacks.onStreamStateChange({
        isStreamer: false,
        isWatching: false
      });
    }

    if (this.callbacks.onToast) {
      this.callbacks.onToast('Stream stopped', '⏹️');
    }
  }
}

window.MovieStreamManager = MovieStreamManager;
