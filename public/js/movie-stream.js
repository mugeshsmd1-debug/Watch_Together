/**
 * MovieStreamManager — High Performance WebRTC Movie & Screen Streaming
 * Enables ONE device (Host or Room Member) to stream local movie files,
 * screen shares, or preloaded media directly to the other device(s) in real-time.
 * The other device watches the live synchronized stream without needing any movie file!
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
    this.streamType = 'file'; // 'file' | 'screen' | 'sample' | 'url'

    this.localMovieStream = null;
    this.remoteMovieStream = null;
    this.moviePC = null;
    this.targetPeerId = null;
    this.iceCandidateQueue = [];

    this.audioContext = null;
    this.audioSourceNode = null;
    this.audioDestNode = null;
    this.progressInterval = null;

    // WebRTC STUN/TURN configuration
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
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

    this.socket.on('movie-stream-started', (data) => {
      console.log('[Movie Stream] Friend started streaming:', data);
      this.isWatching = true;
      this.isStreamer = false;
      this.streamerId = data.streamerId;
      this.streamerName = data.streamerName || 'Friend';
      this.streamTitle = data.title || 'Movie';
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
        this.callbacks.onToast(`🔴 ${this.streamerName} is now streaming "${this.streamTitle}" to the room!`, '🍿');
      }
    });

    this.socket.on('movie-stream-stopped', ({ streamerId }) => {
      console.log('[Movie Stream] Streamer stopped streaming:', streamerId);
      if (this.isWatching) {
        this.stopWatching();
        if (this.callbacks.onToast) {
          this.callbacks.onToast('Movie stream ended', '🎬');
        }
      }
    });

    this.socket.on('movie-control-action', (action) => {
      if (this.isStreamer) {
        this.applyRemoteControlAction(action);
      }
    });

    this.socket.on('movie-progress-update', (data) => {
      if (this.isWatching && this.callbacks.onProgressUpdate) {
        this.callbacks.onProgressUpdate(data);
      }
    });
  }

  /**
   * 1. Start streaming a local movie file (MP4, MKV, WebM, MOV)
   */
  async startFileStream(file, activePeerId = null) {
    if (!file) return;
    try {
      this.stopStream(false);

      const fileUrl = URL.createObjectURL(file);
      this.streamTitle = file.name;
      this.streamType = 'file';
      this.isStreamer = true;
      this.isWatching = false;

      this.mainVideo.srcObject = null;
      this.mainVideo.src = fileUrl;
      this.mainVideo.muted = false; // Local streamer can hear their own audio

      await this.mainVideo.play().catch((err) => {
        console.warn('Initial play require user gesture:', err);
      });

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

      // Ensure Web Audio capture so stereo sound is flawlessly routed to WebRTC
      this.setupAudioCapture(this.mainVideo, stream);

      this.localMovieStream = stream;

      // Announce stream to room
      this.socket.emit('movie-stream-started', {
        title: this.streamTitle,
        streamType: 'file'
      });

      this.startProgressBroadcasting();

      if (this.callbacks.onStreamStateChange) {
        this.callbacks.onStreamStateChange({
          isStreamer: true,
          isWatching: false,
          streamerName: 'You',
          title: this.streamTitle,
          streamType: 'file'
        });
      }

      // If a peer is already in the room, start WebRTC offer to them!
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
   * 2. Start streaming Screen / Tab / Window (YouTube, VLC, browser tabs)
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

      // Show screen stream in main video stage (muted locally to avoid local echo)
      this.mainVideo.src = '';
      this.mainVideo.srcObject = screenStream;
      this.mainVideo.muted = true;
      await this.mainVideo.play().catch(() => {});

      this.localMovieStream = screenStream;

      // When user clicks the browser's native "Stop sharing" button
      const videoTrack = screenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log('Screen sharing ended by user');
          this.stopStream(true);
        };
      }

      // Announce to room
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
      console.warn('Screen sharing cancelled or unavailable:', err);
      return false;
    }
  }

  /**
   * 3. Start streaming a sample or preloaded movie
   */
  async startSampleStream(src, title, activePeerId = null) {
    if (!src) return;
    try {
      this.stopStream(false);

      this.streamTitle = title || 'Movie';
      this.streamType = 'sample';
      this.isStreamer = true;
      this.isWatching = false;

      this.mainVideo.srcObject = null;
      this.mainVideo.crossOrigin = 'anonymous';
      this.mainVideo.src = src;
      this.mainVideo.muted = false;

      await this.mainVideo.play().catch((err) => {
        console.warn('Play blocked:', err);
      });

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

      this.startProgressBroadcasting();

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

      // If stream already has audio track, check if it works
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
          this.audioSourceNode.connect(this.audioContext.destination); // Hear locally!
        } catch (e) {
          console.warn('AudioElementSource already connected or cross-origin:', e);
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
   * Periodic progress broadcast to watcher
   */
  startProgressBroadcasting() {
    this.stopProgressBroadcasting();
    this.progressInterval = setInterval(() => {
      if (this.isStreamer && this.mainVideo && this.streamType !== 'screen') {
        this.socket.emit('movie-progress-update', {
          currentTime: this.mainVideo.currentTime || 0,
          duration: this.mainVideo.duration || 0,
          isPlaying: !this.mainVideo.paused
        });
      }
    }, 600);
  }

  stopProgressBroadcasting() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
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
          this.callbacks.onToast('Friend is now watching your movie stream! 🍿', '📡');
        }
      }
    };

    try {
      const offer = await this.moviePC.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
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

    // Receiver transceivers
    try {
      this.moviePC.addTransceiver('audio', { direction: 'recvonly' });
      this.moviePC.addTransceiver('video', { direction: 'recvonly' });
    } catch (e) {
      console.warn('Transceiver note:', e);
    }

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

      this.mainVideo.src = '';
      this.mainVideo.srcObject = this.remoteMovieStream;
      this.mainVideo.muted = false;

      const playPromise = this.mainVideo.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Autoplay prevented remote movie playback:', err);
          if (this.callbacks.onAutoplayPrompt) {
            this.callbacks.onAutoplayPrompt();
          }
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
      console.error('[Movie WebRTC] Error answering movie offer:', err);
    }
  }

  /**
   * WebRTC: Streamer handles answer from Watcher
   */
  async handleMovieAnswer(sdp) {
    try {
      if (this.moviePC) {
        await this.moviePC.setRemoteDescription(new RTCSessionDescription(sdp));
        await this.flushIceCandidateQueue();
      }
    } catch (err) {
      console.error('[Movie WebRTC] Error setting remote answer:', err);
    }
  }

  /**
   * WebRTC: Handle ICE candidates
   */
  async handleMovieIce(candidate) {
    if (!candidate) return;
    try {
      if (!this.moviePC || !this.moviePC.remoteDescription || !this.moviePC.remoteDescription.type) {
        this.iceCandidateQueue.push(candidate);
        return;
      }
      await this.moviePC.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[Movie WebRTC] ICE candidate note:', err);
    }
  }

  async flushIceCandidateQueue() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      try {
        await this.moviePC.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Flush ICE candidate note:', err);
      }
    }
  }

  /**
   * Controls: Watcher requests play/pause or seek
   */
  sendControlAction(type, currentTime = 0) {
    if (this.isWatching) {
      this.socket.emit('movie-control-action', {
        type,
        currentTime
      });
    }
  }

  /**
   * Controls: Streamer applies control action requested by Watcher
   */
  applyRemoteControlAction(action) {
    if (!this.isStreamer || !this.mainVideo) return;
    console.log('[Movie Stream] Applying remote control action from watcher:', action);

    if (action.type === 'play') {
      this.mainVideo.play().catch(() => {});
    } else if (action.type === 'pause') {
      this.mainVideo.pause();
    } else if (action.type === 'seek') {
      this.mainVideo.currentTime = action.currentTime;
    }
  }

  /**
   * Stop watching remote stream
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

    if (this.mainVideo.srcObject) {
      this.mainVideo.srcObject = null;
    }

    if (this.callbacks.onStreamStateChange) {
      this.callbacks.onStreamStateChange({
        isStreamer: false,
        isWatching: false
      });
    }
  }

  /**
   * Stop streaming (Streamer side)
   */
  stopStream(broadcast = true) {
    const wasStreamer = this.isStreamer;
    this.isStreamer = false;
    this.stopProgressBroadcasting();

    if (this.localMovieStream) {
      this.localMovieStream.getTracks().forEach((track) => track.stop());
      this.localMovieStream = null;
    }

    if (this.moviePC) {
      try { this.moviePC.close(); } catch (_) {}
      this.moviePC = null;
    }

    if (broadcast && wasStreamer) {
      this.socket.emit('movie-stream-stopped');
    }

    if (this.mainVideo.srcObject) {
      this.mainVideo.srcObject = null;
    }

    if (this.callbacks.onStreamStateChange) {
      this.callbacks.onStreamStateChange({
        isStreamer: false,
        isWatching: false
      });
    }
  }
}

window.MovieStreamManager = MovieStreamManager;
