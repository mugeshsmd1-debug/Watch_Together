/**
 * WebRTC Connection and AV Media Manager
 * Handles local camera/mic stream, peer-to-peer connection, and speaking detection.
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

    // WebRTC configuration with Google STUN servers
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
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
        videoElement.play().catch(() => {});
      }

      if (previewElement) {
        previewElement.srcObject = this.localStream;
        previewElement.play().catch(() => {});
      }

      this.setupSpeakingDetector();
      return true;
    } catch (err) {
      console.warn('getUserMedia error (camera/mic may be unavailable or denied):', err);
      // Fallback: Try audio only if video failed
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.isCamOff = true;
        this.setupSpeakingDetector();
        return true;
      } catch (audioErr) {
        console.warn('Audio fallback also failed:', audioErr);
        return false;
      }
    }
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
      console.log('AudioContext not allowed or not yet active:', e);
    }
  }

  /**
   * Initialize RTCPeerConnection for a remote peer
   */
  createPeerConnection(remotePeerId, isInitiator = false) {
    this.targetPeerId = remotePeerId;

    if (this.peerConnection) {
      this.peerConnection.close();
    }

    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    // Add local tracks to connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle remote track
    this.peerConnection.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      this.remoteStream = event.streams[0];
      if (this.onRemoteStreamChange) {
        this.onRemoteStreamChange(this.remoteStream);
      }
    };

    // ICE Candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal-ice', {
          targetId: remotePeerId,
          candidate: event.candidate
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Peer connection state:', this.peerConnection.connectionState);
    };

    if (isInitiator) {
      this.initiateOffer(remotePeerId);
    }
  }

  async initiateOffer(remotePeerId) {
    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await this.peerConnection.setLocalDescription(offer);

      this.socket.emit('signal-offer', {
        targetId: remotePeerId,
        sdp: offer
      });
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  }

  async handleOffer(senderId, sdp) {
    this.createPeerConnection(senderId, false);
    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.socket.emit('signal-answer', {
        targetId: senderId,
        sdp: answer
      });
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  }

  async handleAnswer(sdp) {
    try {
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    } catch (err) {
      console.error('Error setting remote description:', err);
    }
  }

  async handleIceCandidate(candidate) {
    try {
      if (this.peerConnection) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
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
          // Mirror only if front camera
          localVideoElement.style.transform = (this.currentFacing === 'user') ? 'scaleX(-1)' : 'scaleX(1)';
        }

        // Replace track in active WebRTC peer connection
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
