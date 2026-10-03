/**
 * Supabase Realtime Signaling & Video Synchronization Engine
 * Enables WatchTogether to run fully serverless on Vercel with real-time video sync,
 * WebRTC signaling, presence, chat, and reactions.
 */
class SupabaseRoomManager {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || 'https://thjfjhekmqwgtypbhlar.supabase.co';
    this.supabaseKey = options.supabaseKey || 'sb_publishable_syLrN87RaxCMyUc-3F-N3A_79VI05q0';
    this.client = null;
    this.channel = null;
    this.currentRoomId = null;
    this.userId = 'user_' + Math.random().toString(36).substring(2, 9);
    this.userName = options.userName || 'Guest';

    this.onUserJoined = options.onUserJoined || null;
    this.onUserLeft = options.onUserLeft || null;
    this.onSignalOffer = options.onSignalOffer || null;
    this.onSignalAnswer = options.onSignalAnswer || null;
    this.onSignalIce = options.onSignalIce || null;
    this.onVideoSync = options.onVideoSync || null;
    this.onSyncPulse = options.onSyncPulse || null;
    this.onNewChat = options.onNewChat || null;
    this.onNewReaction = options.onNewReaction || null;
    this.onMediaStateChanged = options.onMediaStateChanged || null;

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

    // 1. Presence: Peer Join & Leave Tracking
    this.channel
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        if (!newPresences || newPresences.length === 0) return;
        newPresences.forEach((presence) => {
          if (presence.userId !== this.userId && this.onUserJoined) {
            this.onUserJoined({
              id: presence.userId,
              name: presence.userName || 'Friend'
            });
          }
        });
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (!leftPresences || leftPresences.length === 0) return;
        leftPresences.forEach((presence) => {
          if (presence.userId !== this.userId && this.onUserLeft) {
            this.onUserLeft({
              userId: presence.userId,
              userName: presence.userName || 'Friend'
            });
          }
        });
      });

    // 2. WebRTC Signaling Broadcasts
    this.channel
      .on('broadcast', { event: 'signal-offer' }, ({ payload }) => {
        if (payload.targetId === this.userId && this.onSignalOffer) {
          this.onSignalOffer({ senderId: payload.senderId, sdp: payload.sdp });
        }
      })
      .on('broadcast', { event: 'signal-answer' }, ({ payload }) => {
        if (payload.targetId === this.userId && this.onSignalAnswer) {
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

    // 3. Movie Synchronization Broadcasts
    this.channel
      .on('broadcast', { event: 'video-action' }, ({ payload }) => {
        if (this.onVideoSync) {
          this.onVideoSync(payload);
        }
      })
      .on('broadcast', { event: 'sync-pulse' }, ({ payload }) => {
        if (payload.senderId !== this.userId && this.onSyncPulse) {
          this.onSyncPulse(payload);
        }
      });

    // 4. Live Chat & Reactions
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

    // Subscribe and track presence
    this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[Supabase Realtime] Subscribed to room: ${roomId}`);
        await this.channel.track({
          userId: this.userId,
          userName: this.userName,
          onlineAt: new Date().toISOString()
        });
      }
    });
  }

  // Emitters
  sendSignalOffer(targetId, sdp) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'signal-offer',
      payload: { senderId: this.userId, targetId, sdp }
    });
  }

  sendSignalAnswer(targetId, sdp) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'signal-answer',
      payload: { senderId: this.userId, targetId, sdp }
    });
  }

  sendSignalIce(targetId, candidate) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'signal-ice',
      payload: { senderId: this.userId, targetId, candidate }
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

  sendChat(text) {
    if (!this.channel || !text.trim()) return;
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      senderId: this.userId,
      senderName: this.userName,
      text: text.trim().substring(0, 500),
      timestamp: Date.now()
    };

    // Send to others and deliver to self
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

  leaveRoom() {
    if (this.channel) {
      this.channel.untrack();
      this.channel.unsubscribe();
      this.channel = null;
    }
  }
}

window.SupabaseRoomManager = SupabaseRoomManager;
