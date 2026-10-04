/**
 * Supabase Realtime Signaling & Video Synchronization Engine
 * Enables OurScreen to run fully serverless on Vercel with real-time video sync,
 * WebRTC signaling, presence, chat, and reactions.
 */
class SupabaseRoomManager {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || 'https://thjfjhekmqwgtypbhlar.supabase.co';
    // Using standard Supabase JWT anon key for universal WebSocket Realtime compatibility
    this.supabaseKey = options.supabaseKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoamZqaGVrbXF3Z3R5cGJobGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3Njg5OTEsImV4cCI6MjEwNjM0NDk5MX0.pPUJAzMJyPOpVcliiadgCeFWaS-vZOGJWlN0YjUCEa0';
    this.client = null;
    this.channel = null;
    this.currentRoomId = null;
    this.userId = 'user_' + Math.random().toString(36).substring(2, 9);
    this.userName = options.userName || 'Guest';
    this.knownPeers = new Set();

    this.onUserJoined = options.onUserJoined || null;
    this.onUserLeft = options.onUserLeft || null;
    this.onSignalOffer = options.onSignalOffer || null;
    this.onSignalAnswer = options.onSignalAnswer || null;
    this.onSignalIce = options.onSignalIce || null;
    this.onVideoSync = options.onVideoSync || null;
    this.onSyncPulse = options.onSyncPulse || null;
    this.onRequestSync = options.onRequestSync || null;
    this.onNewChat = options.onNewChat || null;
    this.onNewReaction = options.onNewReaction || null;
    this.onMediaStateChanged = options.onMediaStateChanged || null;
    this.onMovieSignalOffer = options.onMovieSignalOffer || null;
    this.onMovieSignalAnswer = options.onMovieSignalAnswer || null;
    this.onMovieSignalIce = options.onMovieSignalIce || null;
    this.onMovieStreamStarted = options.onMovieStreamStarted || null;
    this.onMovieStreamStopped = options.onMovieStreamStopped || null;
    this.onMovieControlAction = options.onMovieControlAction || null;
    this.onMovieProgressUpdate = options.onMovieProgressUpdate || null;

    this.initClient();
  }

  initClient() {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      this.client = supabase.createClient(this.supabaseUrl, this.supabaseKey, {
        realtime: {
          params: {
            eventsPerSecond: 20
          }
        }
      });
    } else {
      console.warn('Supabase SDK not loaded yet');
    }
  }

  joinRoom(roomId, userName) {
    if (!this.client) this.initClient();
    if (!this.client) {
      console.error('Cannot join room: Supabase client unavailable');
      return;
    }

    if (this.channel) {
      this.channel.unsubscribe();
      this.knownPeers.clear();
    }

    this.currentRoomId = roomId;
    this.userName = userName;

    // Create unique Supabase Realtime channel for this room
    this.channel = this.client.channel(`watchtogether_room_${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: this.userId }
      }
    });

    const handlePeerPresence = (userId, name) => {
      if (!userId || userId === this.userId) return;
      if (!this.knownPeers.has(userId)) {
        this.knownPeers.add(userId);
        console.log(`[Supabase Realtime] Discovered peer: ${userId} (${name})`);
        if (this.onUserJoined) {
          this.onUserJoined({
            id: userId,
            name: name || 'Friend'
          });
        }
      }
    };

    // 1. Presence: Handle 'sync' (Existing users already in room when you join)
    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel.presenceState();
      console.log('[Supabase Realtime] Presence state synchronized:', state);
      Object.keys(state).forEach((key) => {
        const presences = state[key];
        if (presences && Array.isArray(presences)) {
          presences.forEach((p) => {
            handlePeerPresence(p.userId, p.userName);
          });
        }
      });
    });

    // 2. Presence: Handle 'join' (New peers joining after you)
    this.channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      if (!newPresences || newPresences.length === 0) return;
      newPresences.forEach((p) => {
        handlePeerPresence(p.userId, p.userName);
      });
    });

    // 3. Presence: Handle 'leave'
    this.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      if (!leftPresences || leftPresences.length === 0) return;
      leftPresences.forEach((p) => {
        if (p.userId && p.userId !== this.userId) {
          this.knownPeers.delete(p.userId);
          console.log(`[Supabase Realtime] Peer left: ${p.userId}`);
          if (this.onUserLeft) {
            this.onUserLeft({
              userId: p.userId,
              userName: p.userName || 'Friend'
            });
          }
        }
      });
    });

    // 4. WebRTC Signaling Broadcasts
    this.channel
      .on('broadcast', { event: 'signal-offer' }, ({ payload }) => {
        if (payload.targetId === this.userId && this.onSignalOffer) {
          console.log('[Signaling] Received WebRTC offer from:', payload.senderId);
          this.onSignalOffer({ senderId: payload.senderId, sdp: payload.sdp });
        }
      })
      .on('broadcast', { event: 'signal-answer' }, ({ payload }) => {
        if (payload.targetId === this.userId && this.onSignalAnswer) {
          console.log('[Signaling] Received WebRTC answer from:', payload.senderId);
          this.onSignalAnswer({ senderId: payload.senderId, sdp: payload.sdp });
        }
      })
      .on('broadcast', { event: 'signal-ice' }, ({ payload }) => {
        if (payload.targetId === this.userId && this.onSignalIce) {
          this.onSignalIce({ candidate: payload.candidate });
        }
      })
      .on('broadcast', { event: 'media-state' }, ({ payload }) => {
        if (payload.userId !== this.userId && this.onMediaStateChanged) {
          this.onMediaStateChanged(payload);
        }
      });

    // 5. Movie Synchronization Broadcasts
    this.channel
      .on('broadcast', { event: 'video-action' }, ({ payload }) => {
        console.log('[Video Action Received]', payload.type, payload.src || '');
        if (this.onVideoSync) {
          this.onVideoSync(payload);
        }
      })
      .on('broadcast', { event: 'sync-pulse' }, ({ payload }) => {
        if (payload.senderId !== this.userId && this.onSyncPulse) {
          this.onSyncPulse(payload);
        }
      })
      .on('broadcast', { event: 'request-sync' }, ({ payload }) => {
        if (payload.senderId !== this.userId && this.onRequestSync) {
          this.onRequestSync(payload.senderId);
        }
      });

    // 6. Live Chat & Reactions
    this.channel
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (this.onNewChat) {
          this.onNewChat(payload);
        }
      })
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        if (this.onNewReaction) {
          this.onNewReaction(payload);
        }
      });

    // 7. Movie WebRTC Stream & Control Broadcasts
    this.channel
      .on('broadcast', { event: 'movie-signal-offer' }, ({ payload }) => {
        if (payload.targetId === this.userId && this.onMovieSignalOffer) {
          this.onMovieSignalOffer({ senderId: payload.senderId, sdp: payload.sdp });
        }
      })
      .on('broadcast', { event: 'movie-signal-answer' }, ({ payload }) => {
        if (payload.targetId === this.userId && this.onMovieSignalAnswer) {
          this.onMovieSignalAnswer({ senderId: payload.senderId, sdp: payload.sdp });
        }
      })
      .on('broadcast', { event: 'movie-signal-ice' }, ({ payload }) => {
        if (payload.targetId === this.userId && this.onMovieSignalIce) {
          this.onMovieSignalIce({ candidate: payload.candidate });
        }
      })
      .on('broadcast', { event: 'movie-stream-started' }, ({ payload }) => {
        if (payload.streamerId !== this.userId && this.onMovieStreamStarted) {
          this.onMovieStreamStarted(payload);
        }
      })
      .on('broadcast', { event: 'movie-stream-stopped' }, ({ payload }) => {
        if (payload.streamerId !== this.userId && this.onMovieStreamStopped) {
          this.onMovieStreamStopped(payload);
        }
      })
      .on('broadcast', { event: 'movie-control-action' }, ({ payload }) => {
        if (payload.senderId !== this.userId && this.onMovieControlAction) {
          this.onMovieControlAction(payload);
        }
      })
      .on('broadcast', { event: 'movie-progress-update' }, ({ payload }) => {
        if (payload.senderId !== this.userId && this.onMovieProgressUpdate) {
          this.onMovieProgressUpdate(payload);
        }
      });

    // Subscribe and track presence
    this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Supabase Realtime] Subscribed to room: ${roomId}`);
        await this.channel.track({
          userId: this.userId,
          userName: this.userName,
          onlineAt: new Date().toISOString()
        });

        // Request initial movie state from any existing peer in the room
        setTimeout(() => {
          this.sendRequestSync();
        }, 800);
      }
    });
  }

  // Emitters
  sendSignalOffer(targetId, sdp) {
    if (!this.channel) return;
    const cleanSdp = sdp && sdp.toJSON ? sdp.toJSON() : { type: sdp.type, sdp: sdp.sdp };
    this.channel.send({
      type: 'broadcast',
      event: 'signal-offer',
      payload: { senderId: this.userId, targetId, sdp: cleanSdp }
    });
  }

  sendSignalAnswer(targetId, sdp) {
    if (!this.channel) return;
    const cleanSdp = sdp && sdp.toJSON ? sdp.toJSON() : { type: sdp.type, sdp: sdp.sdp };
    this.channel.send({
      type: 'broadcast',
      event: 'signal-answer',
      payload: { senderId: this.userId, targetId, sdp: cleanSdp }
    });
  }

  sendSignalIce(targetId, candidate) {
    if (!this.channel || !candidate) return;
    const cleanCandidate = candidate.toJSON ? candidate.toJSON() : {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment
    };
    this.channel.send({
      type: 'broadcast',
      event: 'signal-ice',
      payload: { senderId: this.userId, targetId, candidate: cleanCandidate }
    });
  }

  sendMediaState(audioEnabled, videoEnabled) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'media-state',
      payload: { userId: this.userId, audioEnabled, videoEnabled }
    });
  }

  sendVideoAction(action) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'video-action',
      payload: {
        ...action,
        senderId: this.userId,
        senderName: this.userName,
        serverTimestamp: Date.now()
      }
    });
  }

  sendSyncPulse(currentTime, isPlaying) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'sync-pulse',
      payload: {
        currentTime,
        isPlaying,
        serverTimestamp: Date.now(),
        senderId: this.userId
      }
    });
  }

  sendRequestSync() {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'request-sync',
      payload: {
        senderId: this.userId
      }
    });
  }

  sendChat(text) {
    if (!this.channel || !text.trim()) return;
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      senderId: this.userId,
      senderName: this.userName,
      text: text.trim().substring(0, 500),
      timestamp: Date.now()
    };

    this.channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: msg
    });

    if (this.onNewChat) {
      this.onNewChat(msg);
    }
  }

  sendReaction(emoji) {
    if (!this.channel || !emoji) return;
    const reaction = {
      id: 'react_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      emoji,
      senderName: this.userName,
      timestamp: Date.now()
    };

    this.channel.send({
      type: 'broadcast',
      event: 'reaction',
      payload: reaction
    });

    if (this.onNewReaction) {
      this.onNewReaction(reaction);
    }
  }

  sendMovieSignalOffer(targetId, sdp) {
    if (!this.channel) return;
    const cleanSdp = sdp && sdp.toJSON ? sdp.toJSON() : { type: sdp.type, sdp: sdp.sdp };
    this.channel.send({
      type: 'broadcast',
      event: 'movie-signal-offer',
      payload: { senderId: this.userId, targetId, sdp: cleanSdp }
    });
  }

  sendMovieSignalAnswer(targetId, sdp) {
    if (!this.channel) return;
    const cleanSdp = sdp && sdp.toJSON ? sdp.toJSON() : { type: sdp.type, sdp: sdp.sdp };
    this.channel.send({
      type: 'broadcast',
      event: 'movie-signal-answer',
      payload: { senderId: this.userId, targetId, sdp: cleanSdp }
    });
  }

  sendMovieSignalIce(targetId, candidate) {
    if (!this.channel || !candidate) return;
    const cleanCandidate = candidate.toJSON ? candidate.toJSON() : {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment
    };
    this.channel.send({
      type: 'broadcast',
      event: 'movie-signal-ice',
      payload: { senderId: this.userId, targetId, candidate: cleanCandidate }
    });
  }

  sendMovieStreamStarted(data) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'movie-stream-started',
      payload: { ...data, streamerId: this.userId }
    });
  }

  sendMovieStreamStopped() {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'movie-stream-stopped',
      payload: { streamerId: this.userId }
    });
  }

  sendMovieControlAction(action) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'movie-control-action',
      payload: { ...action, senderId: this.userId }
    });
  }

  sendMovieProgressUpdate(data) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'movie-progress-update',
      payload: { ...data, senderId: this.userId }
    });
  }

  leaveRoom() {
    if (this.channel) {
      this.channel.untrack();
      this.channel.unsubscribe();
      this.channel = null;
      this.knownPeers.clear();
    }
  }
}

window.SupabaseRoomManager = SupabaseRoomManager;
