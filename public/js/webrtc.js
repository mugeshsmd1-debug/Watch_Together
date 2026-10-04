/**
 * WebRTC Connection and AV Media Manager
 * WhatsApp / Instagram Style Two-Way Video Call
 * Allows anyone to toggle camera & microphone anytime with real-time visibility across peers.
 */
class WebRTCManager {
  constructor(socket, onRemoteStreamChange) {
    this.socket = socket;
    this.onRemoteStreamChange = onRemoteStreamChange;
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnection = null;
    this.audioContext = null;
    this.analyser = null;
    this.isMuted = false;
    this.isCamOff = false;
    this.currentFacing = 'user'; // 'user' or 'environment'
    this.targetPeerId = null;
    this.iceCandidateQueue = [];

    // Comprehensive STUN / TURN servers for high reliability across mobile networks & firewalls
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
  }

  /**
   * Acquire local camera and microphone stream
   */
  async startLocalMedia(videoElement, previewElement = null) {
    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: {
          facingMode: this.currentFacing,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 }
        }
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.isCamOff = false;

      if (videoElement) {
        videoElement.srcObject = this.localStream;
        videoElement.muted = true;
        videoElement.play().catch(() => {});
      }

      if (previewElement) {
        previewElement.srcObject = this.localStream;
        previewElement.muted = true;
        previewElement.play().catch(() => {});
      }

      const localBubble = document.getElementById('local-bubble');
      if (localBubble) localBubble.classList.remove('cam-off');

      this.attachLocalTracksToPeer();
      this.setupSpeakingDetector();
      return true;
    } catch (err) {
      console.warn('Camera/mic full access note:', err);
      // Fallback: Try audio only if video device is unavailable or blocked
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.isCamOff = true;
        const localBubble = document.getElementById('local-bubble');
        if (localBubble) localBubble.classList.add('cam-off');
        this.attachLocalTracksToPeer();
        this.setupSpeakingDetector();
        return true;
      } catch (audioErr) {
        console.warn('Audio fallback also unavailable or blocked:', audioErr);
        this.isCamOff = true;
        this.isMuted = true;
        return false;
      }
    }
  }

  /**
   * Attach or update local tracks on the RTCPeerConnection transceivers
   */
  attachLocalTracksToPeer() {
    if (!this.peerConnection) return;

    if (!this.localStream) {
      // Ensure transceivers exist with sendrecv so incoming media can be negotiated
      const transceivers = this.peerConnection.getTransceivers();
      if (!transceivers.some((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio')) {
        this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
      }
      if (!transceivers.some((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'video')) {
        this.peerConnection.addTransceiver('video', { direction: 'sendrecv' });
      }
      return;
    }

    const transceivers = this.peerConnection.getTransceivers();
    this.localStream.getTracks().forEach((track) => {
      // Find matching transceiver for this track kind
      const existing = transceivers.find((t) =>
        (t.sender && t.sender.track && t.sender.track.kind === track.kind) ||
        (t.receiver && t.receiver.track && t.receiver.track.kind === track.kind)
      );

      if (existing && existing.sender) {
        existing.direction = 'sendrecv';
        existing.sender.replaceTrack(track).catch((e) => console.warn('replaceTrack note:', e));
      } else {
        try {
          this.peerConnection.addTrack(track, this.localStream);
        } catch (e) {
          console.warn('addTrack note:', e);
        }
      }
    });
  }

  /**
   * Setup Web Audio API to detect when the local user is speaking
   */
  setupSpeakingDetector() {
    if (!this.localStream || this.localStream.getAudioTracks().length === 0) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext) {
        this.audioContext = new AudioCtx();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkSpeaking = () => {
        if (!this.analyser || this.isMuted) {
          document.getElementById('local-bubble')?.classList.remove('speaking');
          requestAnimationFrame(checkSpeaking);
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        const localBubble = document.getElementById('local-bubble');
        if (average > 25) {
          localBubble?.classList.add('speaking');
        } else {
          localBubble?.classList.remove('speaking');
        }

        requestAnimationFrame(checkSpeaking);
      };

      checkSpeaking();
    } catch (e) {
      console.log('AudioContext speaking detector note:', e);
    }
  }

  /**
   * Initialize RTCPeerConnection for a remote peer
   */
  createPeerConnection(remotePeerId, isInitiator = false) {
    if (this.peerConnection && this.targetPeerId === remotePeerId && this.peerConnection.signalingState !== 'closed') {
      console.log('[WebRTC Camera] Peer connection already exists for', remotePeerId);
      if (isInitiator && this.peerConnection.signalingState === 'stable') {
        this.initiateOffer(remotePeerId);
      }
      return;
    }

    if (this.targetPeerId !== remotePeerId) {
      this.iceCandidateQueue = [];
    }
    this.targetPeerId = remotePeerId;

    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (_) {}
    }

    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Attach local media tracks or add sendrecv transceivers
    if (this.localStream && this.localStream.getTracks().length > 0) {
      this.localStream.getTracks().forEach((track) => {
        try {
          this.peerConnection.addTrack(track, this.localStream);
        } catch (e) {
          console.warn('Track add error:', e);
        }
      });
      // Ensure video transceiver exists even if local stream is currently audio-only
      if (!this.localStream.getVideoTracks().length) {
        this.peerConnection.addTransceiver('video', { direction: 'sendrecv' });
      }
    } else {
      // Ready for both sending and receiving media
      try {
        this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
        this.peerConnection.addTransceiver('video', { direction: 'sendrecv' });
      } catch (e) {
        console.warn('addTransceiver note:', e);
      }
    }

    // Handle incoming remote track
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC Camera] Received remote track:', event.track.kind);
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
      }

      if (this.onRemoteStreamChange) {
        this.onRemoteStreamChange(this.remoteStream, event.track);
      }
    };

    // Send local ICE candidates to peer
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal-ice', {
          targetId: remotePeerId,
          candidate: event.candidate
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC Camera] Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'connected') {
        // Send current local media states so peer renders exact camera/mic state immediately
        this.socket.emit('update-media-state', {
          videoEnabled: !this.isCamOff,
          audioEnabled: !this.isMuted
        });
      } else if (this.peerConnection.connectionState === 'failed') {
        console.warn('[WebRTC Camera] Connection failed, attempting ICE restart...');
        if (isInitiator) {
          this.peerConnection.restartIce();
        }
      }
    };

    if (isInitiator) {
      this.initiateOffer(remotePeerId);
    }
  }

  async initiateOffer(remotePeerId) {
    if (!this.peerConnection || this.peerConnection.signalingState !== 'stable') return;
    try {
      console.log('[WebRTC Camera] Creating offer for:', remotePeerId);
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      this.socket.emit('signal-offer', {
        targetId: remotePeerId,
        sdp: offer
      });
    } catch (err) {
      console.error('[WebRTC Camera] Error creating offer:', err);
    }
  }

  async handleOffer(senderId, sdp) {
    console.log('[WebRTC Camera] Handling offer from:', senderId);
    if (!this.peerConnection || this.targetPeerId !== senderId || this.peerConnection.signalingState === 'closed') {
      this.createPeerConnection(senderId, false);
    }

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushIceCandidateQueue();

      this.attachLocalTracksToPeer();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.socket.emit('signal-answer', {
        targetId: senderId,
        sdp: answer
      });
    } catch (err) {
      console.error('[WebRTC Camera] Error handling offer:', err);
    }
  }

  async handleAnswer(sdp) {
    console.log('[WebRTC Camera] Handling answer');
    try {
      if (this.peerConnection && this.peerConnection.signalingState === 'have-local-offer') {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        await this.flushIceCandidateQueue();
      }
    } catch (err) {
      console.error('[WebRTC Camera] Error setting remote description:', err);
    }
  }

  async handleIceCandidate(candidate) {
    if (!candidate) return;
    try {
      if (!this.peerConnection || !this.peerConnection.remoteDescription || !this.peerConnection.remoteDescription.type) {
        this.iceCandidateQueue.push(candidate);
        return;
      }
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC Camera] Error adding ICE candidate:', err);
    }
  }

  async flushIceCandidateQueue() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC Camera] Failed to flush ICE candidate:', err);
      }
    }
  }

  /**
   * Toggle Microphone Mute/Unmute
   */
  toggleAudio() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        this.isMuted = !this.isMuted;
        audioTrack.enabled = !this.isMuted;
        this.socket.emit('update-media-state', {
          audioEnabled: !this.isMuted,
          videoEnabled: !this.isCamOff
        });
        return !this.isMuted;
      }
    }
    // If no stream was acquired yet, attempt to acquire audio
    this.isMuted = !this.isMuted;
    this.socket.emit('update-media-state', {
      audioEnabled: !this.isMuted,
      videoEnabled: !this.isCamOff
    });
    return !this.isMuted;
  }

  /**
   * Toggle Camera ON/OFF (WhatsApp / Instagram Style)
   * When turned OFF: camera is disabled, avatar shown locally & remotely.
   * When turned ON: camera is acquired/enabled, live video streams to peer.
   */
  async toggleVideo(localVideoElement) {
    if (this.isCamOff) {
      // Turn Camera ON
      let videoTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;

      if (!videoTrack || videoTrack.readyState === 'ended') {
        try {
          const freshStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: this.currentFacing,
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 24 }
            }
          });
          const newTrack = freshStream.getVideoTracks()[0];

          if (!this.localStream) {
            this.localStream = new MediaStream();
          }
          if (videoTrack) {
            this.localStream.removeTrack(videoTrack);
          }
          this.localStream.addTrack(newTrack);
          videoTrack = newTrack;
        } catch (e) {
          console.warn('Could not turn on camera hardware:', e);
          return false;
        }
      } else {
        videoTrack.enabled = true;
      }

      this.isCamOff = false;

      if (localVideoElement) {
        localVideoElement.srcObject = this.localStream;
        localVideoElement.muted = true;
        localVideoElement.play().catch(() => {});
      }

      const localBubble = document.getElementById('local-bubble');
      if (localBubble) localBubble.classList.remove('cam-off');

      this.attachLocalTracksToPeer();

      this.socket.emit('update-media-state', {
        videoEnabled: true,
        audioEnabled: !this.isMuted
      });

      return true;
    } else {
      // Turn Camera OFF
      this.isCamOff = true;

      if (this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = false;
        }
      }

      const localBubble = document.getElementById('local-bubble');
      if (localBubble) localBubble.classList.add('cam-off');

      // Update sender to null or disabled
      if (this.peerConnection) {
        const transceivers = this.peerConnection.getTransceivers();
        const videoTransceiver = transceivers.find((t) =>
          (t.sender && t.sender.track && t.sender.track.kind === 'video') ||
          (t.receiver && t.receiver.track && t.receiver.track.kind === 'video')
        );
        if (videoTransceiver && videoTransceiver.sender && this.localStream) {
          const videoTrack = this.localStream.getVideoTracks()[0];
          if (videoTrack) {
            videoTransceiver.sender.replaceTrack(videoTrack).catch(() => {});
          }
        }
      }

      this.socket.emit('update-media-state', {
        videoEnabled: false,
        audioEnabled: !this.isMuted
      });

      return false;
    }
  }

  /**
   * Flip between front and rear camera on mobile devices
   */
  async flipCamera(localVideoElement) {
    this.currentFacing = (this.currentFacing === 'user') ? 'environment' : 'user';

    if (this.localStream) {
      const oldVideoTrack = this.localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        oldVideoTrack.stop();
      }

      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: this.currentFacing,
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });

        const newVideoTrack = newStream.getVideoTracks()[0];
        if (oldVideoTrack) {
          this.localStream.removeTrack(oldVideoTrack);
        }
        this.localStream.addTrack(newVideoTrack);
        this.isCamOff = false;

        if (localVideoElement) {
          localVideoElement.srcObject = this.localStream;
          localVideoElement.style.transform = (this.currentFacing === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
        }

        this.attachLocalTracksToPeer();
        return true;
      } catch (err) {
        console.error('Failed to flip camera:', err);
        return false;
      }
    }
    return false;
  }

  close() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}

window.WebRTCManager = WebRTCManager;
