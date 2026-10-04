/**
 * MovieStreamManager — Google Meet Style Live Movie & Screen Streaming
 * Fully compatible with iOS Safari, Chrome, Edge, and Android WebKit.
 * Uses hardware-accelerated H.264 codec prioritization so movies encoded on Windows
 * play smoothly on iPhones and iPads without decoding stalls.
 */

// Prioritize hardware-accelerated H.264 in WebRTC SDP for iOS Safari & macOS WebKit
function preferH264(sdp) {
  if (!sdp || typeof sdp !== 'string') return sdp;
  const lines = sdp.split('\r\n');
  const mVideoIndex = lines.findIndex((l) => l.startsWith('m=video'));
  if (mVideoIndex === -1) return sdp;

  const mVideoLine = lines[mVideoIndex];
  const parts = mVideoLine.split(' ');
  const header = parts.slice(0, 3);
  const pts = parts.slice(3);

  const h264Pts = [];
  const otherPts = [];

  pts.forEach((pt) => {
    const isH264 = lines.some((l) =>
      l.toLowerCase().includes(`a=rtpmap:${pt} h264/90000`)
    );
    if (isH264) {
      h264Pts.push(pt);
    } else {
      otherPts.push(pt);
    }
  });

  if (h264Pts.length > 0) {
    lines[mVideoIndex] = `${header.join(' ')} ${[...h264Pts, ...otherPts].join(' ')}`;
    return lines.join('\r\n');
  }
  return sdp;
}

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

      this.mainVideo.removeAttribute('srcObject');
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
      } else {
        // Fallback for Safari & iOS WebKit using high performance Canvas capture
        console.log('[Movie Stream] Using Canvas frame capture fallback for Safari/WebKit');
        const canvas = document.createElement('canvas');
        const vWidth = Math.min(1280, this.mainVideo.videoWidth || 1280);
        const vHeight = Math.min(720, this.mainVideo.videoHeight || 720);
        canvas.width = vWidth;
        canvas.height = vHeight;
        const ctx = canvas.getContext('2d');

        let isCapturing = true;
        this.captureCanvasCleanup = () => { isCapturing = false; };

        const renderFrame = () => {
          if (!isCapturing) return;
          if (this.mainVideo && !this.mainVideo.paused && !this.mainVideo.ended) {
            try {
              ctx.drawImage(this.mainVideo, 0, 0, canvas.width, canvas.height);
            } catch (e) {}
          }
          if ('requestVideoFrameCallback' in this.mainVideo) {
            this.mainVideo.requestVideoFrameCallback(renderFrame);
          } else {
            requestAnimationFrame(renderFrame);
          }
        };
        renderFrame();

        if (typeof canvas.captureStream === 'function') {
          stream = canvas.captureStream(24);
        }
      }

      if (!stream) {
        throw new Error('Your browser does not support live video capture. For best results, stream movies from Chrome or Edge on Windows/Mac, and watch on iPhone!');
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

      this.mainVideo.removeAttribute('src');
      this.mainVideo.srcObject = screenStream;
      this.mainVideo.muted = true; // Mute locally to prevent feedback loop
      await this.mainVideo.play().catch(() => {});

      this.localMovieStream = screenStream;

      // Listen for browser "Stop sharing" button
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
  async startSampleStream(arg1 = null, arg2 = null, arg3 = null) {
    try {
      this.stopStream(false);

      let sampleUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
      let sampleTitle = 'Big Buck Bunny (Sample HD)';
      let activePeerId = null;

      if (typeof arg1 === 'string') {
        sampleUrl = arg1;
        sampleTitle = arg2 || 'Sample Movie';
        activePeerId = arg3 || null;
      } else {
        activePeerId = arg1 || null;
      }

      this.streamTitle = sampleTitle;
      this.streamType = 'sample';
      this.isStreamer = true;
      this.isWatching = false;

      this.mainVideo.crossOrigin = 'anonymous';
      this.mainVideo.removeAttribute('srcObject');
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
      const offer = await this.moviePC.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      // Prioritize H.264 for hardware decoding on iOS Safari
      const sdpString = preferH264(offer.sdp);
      const modOffer = new RTCSessionDescription({ type: offer.type, sdp: sdpString });
      await this.moviePC.setLocalDescription(modOffer);

      this.socket.emit('movie-signal-offer', {
        targetId: remotePeerId,
        sdp: modOffer
      });
    } catch (err) {
      console.error('[Movie WebRTC] Error creating movie offer:', err);
    }
  }

  /**
   * WebRTC: Watcher handles offer from Streamer (iOS Safari & Desktop)
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
        // iOS Safari: removeAttribute src before setting srcObject
        this.mainVideo.removeAttribute('src');
        this.mainVideo.srcObject = this.remoteMovieStream;
        this.mainVideo.setAttribute('playsinline', '');
        this.mainVideo.setAttribute('webkit-playsinline', '');
        this.mainVideo.muted = true; // Crucial for iOS Safari auto-playback!

        const playPromise = this.mainVideo.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            console.log('[Movie WebRTC] Live stream started playing on iOS Safari');
            if (this.callbacks.onAutoplayPrompt) {
              this.callbacks.onAutoplayPrompt();
            }
          }).catch((err) => {
            console.warn('[Movie WebRTC] Safari initial play note:', err);
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
      const sdpString = preferH264(answer.sdp);
      const modAnswer = new RTCSessionDescription({ type: answer.type, sdp: sdpString });
      await this.moviePC.setLocalDescription(modAnswer);

      this.socket.emit('movie-signal-answer', {
        targetId: senderId,
        sdp: modAnswer
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
      this.mainVideo.removeAttribute('src');
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
      this.mainVideo.removeAttribute('src');
      this.mainVideo.srcObject = null;
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
