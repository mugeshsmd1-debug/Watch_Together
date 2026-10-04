/**
 * WebRTC Connection and AV Media Manager
 * Handles local camera/mic stream, peer-to-peer connection with candidate queuing,
 * transceivers, and speaking detection.
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

    // WebRTC configuration with Google, Cloudflare & Mozilla STUN & Metered OpenRelay TURN servers
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
      console.warn('getUserMedia camera/mic prompt note:', err);
      // Fallback: Try audio only if video failed
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.isCamOff = true;
        const localBubble = document.getElementById('local-bubble');
        if (localBubble) localBubble.classList.add('cam-off');
        this.attachLocalTracksToPeer();
        this.setupSpeakingDetector();
        return true;
      } catch (audioErr) {
        console.warn('Audio fallback also failed or blocked:', audioErr);
        return false;
      }
    }
  }

  attachLocalTracksToPeer() {
    if (!this.peerConnection || !this.localStream) return;

    const currentSenders = this.peerConnection.getSenders();
    this.localStream.getTracks().forEach((track) => {
      const existingSender = currentSenders.find((s) => s.track && s.track.kind === track.kind);
      if (existingSender) {
        existingSender.replaceTrack(track).catch(() => {});
      } else {
        try {
          this.peerConnection.addTrack(track, this.localStream);
        } catch (e) {
          console.warn('Track add note:', e);
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

      this.audioContext = new AudioCtx();
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

    // Attach local media tracks directly
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          this.peerConnection.addTrack(track, this.localStream);
        } catch (e) {
          console.warn('Track add error:', e);
        }
      });
    } else {
      // Receive-only fallback if local media not yet granted
      try {
        this.peerConnection.addTransceiver('audio', { direction: 'recvonly' });
        this.peerConnection.addTransceiver('video', { direction: 'recvonly' });
      } catch (e) {
        console.warn('addTransceiver note:', e);
      }
    }

    // Handle remote track
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

      const remoteBubble = document.getElementById('remote-bubble');
      if (remoteBubble) remoteBubble.classList.remove('cam-off');

      if (this.onRemoteStreamChange) {
        this.onRemoteStreamChange(this.remoteStream);
      }
    };

    // Send local ICE candidates
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
      const remoteBubble = document.getElementById('remote-bubble');
      if (this.peerConnection.connectionState === 'connected') {
        if (remoteBubble) remoteBubble.classList.remove('cam-off');
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
   * Toggle Microphone mute
   */
  toggleAudio() {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isMuted = !this.isMuted;
      audioTrack.enabled = !this.isMuted;
      this.socket.emit('update-media-state', { audioEnabled: !this.isMuted });
      return !this.isMuted;
    }
    return false;
  }

  /**
   * Toggle Camera on/off
   */
  toggleVideo() {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      this.isCamOff = !this.isCamOff;
      videoTrack.enabled = !this.isCamOff;
      this.socket.emit('update-media-state', { videoEnabled: !this.isCamOff });
      return !this.isCamOff;
    }
    return false;
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
        this.localStream.removeTrack(oldVideoTrack);
        this.localStream.addTrack(newVideoTrack);

        if (localVideoElement) {
          localVideoElement.srcObject = this.localStream;
          localVideoElement.style.transform = (this.currentFacing === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
        }

        if (this.peerConnection) {
          const sender = this.peerConnection.getSenders().find((s) => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(newVideoTrack);
          }
        }
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
