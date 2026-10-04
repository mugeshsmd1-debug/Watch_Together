/**
 * WatchTogether — Main Client Application
 * Connects WebRTC calling, video synchronization, chat, floating camera bubbles,
 * auto-hiding cinema mode, and Google Drive streaming.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const screenHome = document.getElementById('screen-home');
  const screenRoom = document.getElementById('screen-room');
  const toastContainer = document.getElementById('toast-container');

  // Home inputs
  const inputUsername = document.getElementById('input-username');
  const inputRoomCode = document.getElementById('input-room-code');
  const btnCreateRoom = document.getElementById('btn-create-room');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const previewVideo = document.getElementById('preview-video');
  const previewPlaceholder = document.getElementById('preview-placeholder');

  // Room header & tags
  const btnLeaveRoom = document.getElementById('btn-leave-room');
  const btnRoomBadge = document.getElementById('btn-room-badge');
  const labelRoomCode = document.getElementById('label-room-code');
  const btnToggleUi = document.getElementById('btn-toggle-ui');
  const btnShowQr = document.getElementById('btn-show-qr');

  // Video & Stage
  const movieStage = document.getElementById('movie-stage');
  const mainVideo = document.getElementById('main-video');
  const videoOverlay = document.getElementById('video-overlay');
  const videoTitle = document.getElementById('video-title');
  const centerPlayIndicator = document.getElementById('center-play-indicator');
  const labelCurrentTime = document.getElementById('label-current-time');
  const labelDurationTime = document.getElementById('label-duration-time');
  const progressTrack = document.getElementById('progress-track');
  const progressFill = document.getElementById('progress-fill');
  const progressBuffer = document.getElementById('progress-buffer');
  const progressHandle = document.getElementById('progress-handle');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const btnRewind = document.getElementById('btn-rewind-10');
  const btnForward = document.getElementById('btn-forward-10');
  const btnFullscreen = document.getElementById('btn-fullscreen');

  // Camera Bubbles
  const localBubble = document.getElementById('local-bubble');
  const remoteBubble = document.getElementById('remote-bubble');
  const localVideo = document.getElementById('local-video');
  const remoteVideo = document.getElementById('remote-video');
  const localTagName = document.getElementById('local-tag-name');
  const remoteTagName = document.getElementById('remote-tag-name');
  const localFallback = document.getElementById('local-fallback');
  const remoteFallback = document.getElementById('remote-fallback');

  // Bottom Control Dock
  const floatingDock = document.getElementById('floating-dock');
  const btnToggleMic = document.getElementById('btn-toggle-mic');
  const iconMicOn = document.getElementById('icon-mic-on');
  const iconMicOff = document.getElementById('icon-mic-off');
  const btnToggleCam = document.getElementById('btn-toggle-cam');
  const iconCamOn = document.getElementById('icon-cam-on');
  const iconCamOff = document.getElementById('icon-cam-off');
  const btnFlipCam = document.getElementById('btn-flip-cam');
  const btnOpenMedia = document.getElementById('btn-open-media');
  const btnOpenChat = document.getElementById('btn-open-chat');
  const chatUnreadBadge = document.getElementById('chat-unread-badge');

  // Modals & Sheets
  const sheetChatBackdrop = document.getElementById('sheet-chat-backdrop');
  const btnCloseChat = document.getElementById('btn-close-chat');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  const sheetMediaBackdrop = document.getElementById('sheet-media-backdrop');
  const btnCloseMedia = document.getElementById('btn-close-media');
  const btnChooseLocalFile = document.getElementById('btn-choose-local-file');
  const inputLocalVideo = document.getElementById('input-local-video');
  const inputCustomUrl = document.getElementById('input-custom-url');
  const btnLoadUrl = document.getElementById('btn-load-url');
  const inputDriveUrl = document.getElementById('input-drive-url');
  const btnLoadDrive = document.getElementById('btn-load-drive');
  const btnStreamScreen = document.getElementById('btn-stream-screen');

  // Stream & Standby Stage Elements
  const streamStatusBadge = document.getElementById('stream-status-badge');
  const streamStatusText = document.getElementById('stream-status-text');
  const btnStopStreaming = document.getElementById('btn-stop-streaming');
  const stageStandbyOverlay = document.getElementById('stage-standby-overlay');
  const btnStandbyStreamFile = document.getElementById('btn-standby-stream-file');
  const btnStandbyShareScreen = document.getElementById('btn-standby-share-screen');
  const btnStandbySampleMovie = document.getElementById('btn-standby-sample-movie');

  const sheetInviteBackdrop = document.getElementById('sheet-invite-backdrop');
  const btnCloseInvite = document.getElementById('btn-close-invite');
  const qrImage = document.getElementById('qr-image');
  const inputRoomUrl = document.getElementById('input-room-url');
  const btnCopyUrl = document.getElementById('btn-copy-url');

  const reactionsContainer = document.getElementById('reactions-container');

  // Application State
  let socket = null;
  let webrtc = null;
  let movieStream = null;
  let activePeerId = null;
  let syncManager = null;
  let currentRoomId = null;
  let currentUser = null;
  let unreadChatCount = 0;
  let isChatOpen = false;
  let hideControlsTimer = null;

  // Realtime Bridge: Auto-switches between Supabase Realtime (on Vercel) and Socket.io (locally)
  class RealtimeBridge {
    constructor() {
      this.isVercel = window.location.hostname.includes('vercel.app') || (typeof io === 'undefined');
      this.listeners = new Map();
      this.supabaseRoom = null;
      this.socket = null;

      if (!this.isVercel && typeof io !== 'undefined') {
        try {
          this.socket = io({ transports: ['websocket', 'polling'] });
        } catch (e) {
          this.isVercel = true;
        }
      }
    }

    initSupabase(roomId, userName) {
      if (this.supabaseRoom) {
        this.supabaseRoom.leaveRoom();
      }

      this.supabaseRoom = new SupabaseRoomManager({
        userName,
        onUserJoined: (user) => this.dispatch('user-joined', { user }),
        onUserLeft: (user) => this.dispatch('user-left', user),
        onSignalOffer: (data) => this.dispatch('signal-offer', data),
        onSignalAnswer: (data) => this.dispatch('signal-answer', data),
        onSignalIce: (data) => this.dispatch('signal-ice', data),
        onMediaStateChanged: (data) => this.dispatch('user-media-state-changed', data),
        onVideoSync: (action) => this.dispatch('video-sync', action),
        onSyncPulse: (pulse) => this.dispatch('sync-pulse-echo', pulse),
        onRequestSync: (senderId) => this.dispatch('request-sync', { senderId }),
        onNewChat: (msg) => this.dispatch('new-chat', msg),
        onNewReaction: (reaction) => this.dispatch('new-reaction', reaction),
        onMovieSignalOffer: (data) => this.dispatch('movie-signal-offer', data),
        onMovieSignalAnswer: (data) => this.dispatch('movie-signal-answer', data),
        onMovieSignalIce: (data) => this.dispatch('movie-signal-ice', data),
        onMovieStreamStarted: (data) => this.dispatch('movie-stream-started', data),
        onMovieStreamStopped: (data) => this.dispatch('movie-stream-stopped', data),
        onMovieControlAction: (data) => this.dispatch('movie-control-action', data),
        onMovieProgressUpdate: (data) => this.dispatch('movie-progress-update', data)
      });

      this.id = this.supabaseRoom.userId;
      this.supabaseRoom.joinRoom(roomId, userName);

      this.dispatch('room-joined', {
        roomId,
        user: { id: this.supabaseRoom.userId, name: userName, isHost: true },
        otherUsers: []
      });
    }

    on(event, callback) {
      if (this.socket) {
        this.socket.on(event, callback);
      }
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(callback);
    }

    dispatch(event, payload) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).forEach((cb) => cb(payload));
      }
    }

    emit(event, payload) {
      if (this.socket && !this.isVercel) {
        this.socket.emit(event, payload);
        return;
      }

      if (this.supabaseRoom) {
        if (event === 'join-room') {
          // Handled via initSupabase
        } else if (event === 'signal-offer') this.supabaseRoom.sendSignalOffer(payload.targetId, payload.sdp);
        else if (event === 'signal-answer') this.supabaseRoom.sendSignalAnswer(payload.targetId, payload.sdp);
        else if (event === 'signal-ice') this.supabaseRoom.sendSignalIce(payload.targetId, payload.candidate);
        else if (event === 'update-media-state') this.supabaseRoom.sendMediaState(payload.audioEnabled, payload.videoEnabled);
        else if (event === 'video-action') this.supabaseRoom.sendVideoAction(payload);
        else if (event === 'sync-pulse') this.supabaseRoom.sendSyncPulse(payload.currentTime, payload.isPlaying);
        else if (event === 'send-chat') this.supabaseRoom.sendChat(payload.text);
        else if (event === 'send-reaction') this.supabaseRoom.sendReaction(payload.emoji);
        else if (event === 'movie-signal-offer') this.supabaseRoom.sendMovieSignalOffer(payload.targetId, payload.sdp);
        else if (event === 'movie-signal-answer') this.supabaseRoom.sendMovieSignalAnswer(payload.targetId, payload.sdp);
        else if (event === 'movie-signal-ice') this.supabaseRoom.sendMovieSignalIce(payload.targetId, payload.candidate);
        else if (event === 'movie-stream-started') this.supabaseRoom.sendMovieStreamStarted(payload);
        else if (event === 'movie-stream-stopped') this.supabaseRoom.sendMovieStreamStopped();
        else if (event === 'movie-control-action') this.supabaseRoom.sendMovieControlAction(payload);
        else if (event === 'movie-progress-update') this.supabaseRoom.sendMovieProgressUpdate(payload);
      }
    }
  }

  socket = new RealtimeBridge();

  // Autoplay prompt helper
  let autoplayOverlayPrompt = null;
  function triggerAutoplayResume() {
    if (mainVideo && !mainVideo.paused) {
      mainVideo.play().catch(() => {});
    }
    if (remoteVideo && remoteVideo.srcObject) {
      remoteVideo.play().catch(() => {});
    }
    if (autoplayOverlayPrompt) {
      autoplayOverlayPrompt.remove();
      autoplayOverlayPrompt = null;
    }
  }

  function showAutoplayPrompt() {
    if (autoplayOverlayPrompt) return;
    autoplayOverlayPrompt = document.createElement('div');
    autoplayOverlayPrompt.className = 'autoplay-prompt-banner';
    autoplayOverlayPrompt.innerHTML = `<span>🔊 Tap to start audio & video sync</span>`;
    autoplayOverlayPrompt.addEventListener('click', triggerAutoplayResume);
    document.body.appendChild(autoplayOverlayPrompt);
  }
  window.showAutoplayPrompt = showAutoplayPrompt;

  window.addEventListener('click', triggerAutoplayResume, { passive: true });
  window.addEventListener('touchstart', triggerAutoplayResume, { passive: true });

  // WebRTC Instance
  webrtc = new WebRTCManager(socket, (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    remoteVideo.playsInline = true;
    const playPromise = remoteVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Autoplay prevented remote video stream:', err);
        showAutoplayPrompt();
      });
    }
    remoteBubble.classList.remove('cam-off');
    showToast('Friend connected video stream! 📹', '🎉');
  });

  // Sync Manager Instance
  syncManager = new VideoSyncManager(mainVideo, socket, {
    videoTitle,
    centerPlayIndicator,
    labelCurrentTime,
    labelDurationTime,
    progressTrack,
    progressFill,
    progressBuffer,
    progressHandle,
    btnPlayPause,
    iconPlay,
    iconPause,
    btnRewind,
    btnForward,
    btnFullscreen
  });

  // Movie Stream Manager Instance (Streams movie/screen from one device to the other)
  movieStream = new MovieStreamManager(socket, mainVideo, {
    onStreamStateChange: ({ isStreamer, isWatching, streamerName, title, streamType }) => {
      if (isStreamer) {
        if (stageStandbyOverlay) stageStandbyOverlay.classList.add('hidden');
        if (streamStatusBadge) {
          streamStatusBadge.classList.remove('hidden');
          streamStatusText.textContent = `STREAMING: ${title || 'Movie'}`;
          btnStopStreaming.style.display = 'inline-block';
        }
        if (videoTitle) videoTitle.textContent = title || 'Your Stream';
      } else if (isWatching) {
        if (stageStandbyOverlay) stageStandbyOverlay.classList.add('hidden');
        if (streamStatusBadge) {
          streamStatusBadge.classList.remove('hidden');
          streamStatusText.textContent = `🔴 LIVE: ${streamerName || 'Friend'}'s Stream`;
          btnStopStreaming.style.display = 'none';
        }
        if (videoTitle) videoTitle.textContent = title || `${streamerName}'s Stream`;
      } else {
        if (stageStandbyOverlay) stageStandbyOverlay.classList.remove('hidden');
        if (streamStatusBadge) streamStatusBadge.classList.add('hidden');
        if (videoTitle) videoTitle.textContent = 'OurScreen';
      }
    },
    onToast: (msg, icon) => showToast(msg, icon),
    onAutoplayPrompt: () => showAutoplayPrompt(),
    onProgressUpdate: (data) => {
      if (syncManager) {
        syncManager.lastKnownCurrentTime = data.currentTime;
        if (labelCurrentTime) labelCurrentTime.textContent = syncManager.formatTime(data.currentTime);
        if (labelDurationTime) labelDurationTime.textContent = syncManager.formatTime(data.duration);
        const pct = (data.currentTime / (data.duration || 1)) * 100;
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressHandle) progressHandle.style.left = `${pct}%`;
        syncManager.updatePlayPauseUI(data.isPlaying);
      }
    }
  });
  window.movieStream = movieStream;

  // Dynamic Island Toast Helper
  function showToast(message, icon = '✨') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  // Pre-fill Display Name from LocalStorage or generate default
  const savedName = localStorage.getItem('wt_username') || `Friend-${Math.floor(100 + Math.random() * 900)}`;
  inputUsername.value = savedName;

  // Check URL query parameters (e.g. ?room=WT-1234)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    inputRoomCode.value = roomParam.toUpperCase();
  }

  // Start local camera preview on Home screen
  webrtc.startLocalMedia(localVideo, previewVideo).then((hasMedia) => {
    if (hasMedia && previewPlaceholder) {
      previewPlaceholder.style.display = 'none';
    }
  });

  // Touch / Pointer Draggable Camera Bubbles
  function makeBubbleDraggable(el) {
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
    let isDragging = false;

    const onStart = (clientX, clientY) => {
      isDragging = true;
      startX = clientX;
      startY = clientY;
      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      el.style.transition = 'none';
    };

    const onMove = (clientX, clientY) => {
      if (!isDragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;

      const maxX = window.innerWidth - el.offsetWidth - 8;
      const maxY = window.innerHeight - el.offsetHeight - 8;

      const newLeft = Math.max(8, Math.min(maxX, initialLeft + dx));
      const newTop = Math.max(8, Math.min(maxY, initialTop + dy));

      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
      el.style.right = 'auto';
    };

    const onEnd = () => {
      isDragging = false;
      el.style.transition = '';
    };

    el.addEventListener('touchstart', (e) => {
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchend', onEnd);

    el.addEventListener('pointerdown', (e) => {
      onStart(e.clientX, e.clientY);
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      onMove(e.clientX, e.clientY);
    });

    el.addEventListener('pointerup', (e) => {
      if (isDragging) {
        onEnd();
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    });
  }

  makeBubbleDraggable(localBubble);
  makeBubbleDraggable(remoteBubble);

  // =================================================================
  // CINEMA VIEW: AUTO-HIDE CHAT, REACTIONS & CONTROLS DURING PLAYBACK
  // =================================================================
  function hideControls() {
    if (!mainVideo.paused && !isChatOpen && !sheetMediaBackdrop.classList.contains('open') && !sheetInviteBackdrop.classList.contains('open')) {
      screenRoom.classList.add('controls-hidden');
    }
  }

  function showControls() {
    screenRoom.classList.remove('controls-hidden');
    clearTimeout(hideControlsTimer);
    if (!mainVideo.paused) {
      hideControlsTimer = setTimeout(hideControls, 3500);
    }
  }

  // Auto-hide when playing
  mainVideo.addEventListener('play', () => {
    showControls();
  });

  // Always show controls when paused
  mainVideo.addEventListener('pause', () => {
    screenRoom.classList.remove('controls-hidden');
    clearTimeout(hideControlsTimer);
  });

  // Tap video stage to reveal or toggle controls
  movieStage.addEventListener('pointerdown', (e) => {
    if (screenRoom.classList.contains('controls-hidden')) {
      e.stopPropagation();
      showControls();
    } else {
      showControls();
    }
  });

  // Mouse move / touch activity reveals controls
  ['pointermove', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, () => {
      if (screenRoom.classList.contains('controls-hidden')) {
        showControls();
      }
    }, { passive: true });
  });

  // Manual Toggle UI button
  if (btnToggleUi) {
    btnToggleUi.addEventListener('click', () => {
      if (screenRoom.classList.contains('controls-hidden')) {
        showControls();
      } else {
        screenRoom.classList.add('controls-hidden');
      }
    });
  }

  // Floating Reaction Generator
  function triggerReaction(emoji) {
    const reactionEl = document.createElement('div');
    reactionEl.className = 'floating-reaction';
    reactionEl.textContent = emoji;

    const leftPct = 15 + Math.random() * 70;
    const rotDeg = (Math.random() * 40 - 20) + 'deg';
    reactionEl.style.left = `${leftPct}%`;
    reactionEl.style.setProperty('--rot', rotDeg);

    reactionsContainer.appendChild(reactionEl);
    setTimeout(() => reactionEl.remove(), 2900);
  }

  document.querySelectorAll('.reaction-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = btn.dataset.emoji;
      triggerReaction(emoji);
      socket.emit('send-reaction', { emoji });
    });
  });

  // Room Join Action
  function joinRoom(roomId) {
    const username = inputUsername.value.trim() || 'Alex';
    localStorage.setItem('wt_username', username);

    let cleanCode = (roomId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanCode.startsWith('WT') && /^\d+$/.test(cleanCode)) {
      cleanCode = 'WT-' + cleanCode;
    } else if (cleanCode.startsWith('WT') && !cleanCode.startsWith('WT-')) {
      cleanCode = 'WT-' + cleanCode.substring(2);
    }

    currentRoomId = cleanCode || 'WT-MAIN';
    labelRoomCode.textContent = currentRoomId;
    localTagName.textContent = username;
    localFallback.textContent = username.charAt(0).toUpperCase();

    screenHome.classList.add('hidden');
    screenRoom.classList.remove('hidden');

    if (socket.isVercel || typeof io === 'undefined') {
      socket.initSupabase(currentRoomId, username);
    } else {
      socket.emit('join-room', {
        roomId: currentRoomId,
        userName: username
      });
    }

    showToast(`Joined Room ${currentRoomId}`, '🎉');
  }

  btnCreateRoom.addEventListener('click', () => {
    const randomCode = 'WT-' + Math.floor(1000 + Math.random() * 9000);
    joinRoom(randomCode);
  });

  btnJoinRoom.addEventListener('click', () => {
    const code = inputRoomCode.value.trim();
    if (!code) {
      showToast('Please enter a room code', '⚠️');
      return;
    }
    joinRoom(code);
  });

  btnLeaveRoom.addEventListener('click', () => {
    if (confirm('Leave this watch room?')) {
      window.location.href = window.location.pathname;
    }
  });

  // Socket: Room Joined
  socket.on('room-joined', ({ roomId, user, otherUsers, videoState, currentStreamer, chatHistory }) => {
    currentUser = user;
    currentRoomId = roomId;

    if (currentStreamer) {
      showToast(`🔴 Friend is streaming "${currentStreamer.title}"!`, '🍿');
    } else {
      if (stageStandbyOverlay) stageStandbyOverlay.classList.remove('hidden');
    }

    if (chatHistory && chatHistory.length > 0) {
      chatMessages.innerHTML = '';
      chatHistory.forEach(appendChatMessage);
    }

    if (otherUsers && otherUsers.length > 0) {
      const peer = otherUsers[0];
      activePeerId = peer.id;
      remoteTagName.textContent = peer.name;
      remoteFallback.textContent = peer.name.charAt(0).toUpperCase();

      // New joiner creates receiver peer connection and awaits offer from established peer
      console.log('Peer found in room, awaiting offer from:', peer.id);
      webrtc.createPeerConnection(peer.id, false);

      if (movieStream && movieStream.isStreamer) {
        setTimeout(() => {
          movieStream.initiateMoviePeerConnection(peer.id);
        }, 500);
      }
    } else {
      remoteTagName.textContent = 'Waiting for friend...';
    }
  });

  // Socket: User Joined (Trigger WebRTC call from established host/peer)
  socket.on('user-joined', ({ user }) => {
    showToast(`${user.name} joined!`, '👋');
    activePeerId = user.id;
    remoteTagName.textContent = user.name;
    remoteFallback.textContent = user.name.charAt(0).toUpperCase();

    // Polite Peer pattern: peer with smaller ID initiates WebRTC offer
    const myId = socket.isVercel && socket.supabaseRoom ? socket.supabaseRoom.userId : (socket.id || '');
    const isInitiator = !myId || !user.id || myId < user.id;

    console.log(`[Peer Joined] ${user.name} (${user.id}). My ID: ${myId}. Am I initiator? ${isInitiator}`);
    webrtc.createPeerConnection(user.id, isInitiator);

    // If I am currently streaming a movie, immediately connect movie stream to the new user!
    if (movieStream && movieStream.isStreamer) {
      setTimeout(() => {
        movieStream.initiateMoviePeerConnection(user.id);
      }, 500);
    }
  });

  // Socket: Request Sync (Peer joined and requested current movie state)
  socket.on('request-sync', ({ senderId }) => {
    console.log('Peer requested movie sync:', senderId);
    if (movieStream && movieStream.isStreamer) {
      movieStream.initiateMoviePeerConnection(senderId);
    }
  });

  // Socket: User Left
  socket.on('user-left', ({ userId, userName }) => {
    showToast(`${userName || 'Friend'} left the room`, '🚪');
    if (activePeerId === userId) {
      activePeerId = null;
    }
    remoteTagName.textContent = 'Waiting for friend...';
    remoteVideo.srcObject = null;
    remoteBubble.classList.add('cam-off');

    if (movieStream && movieStream.isWatching && movieStream.streamerId === userId) {
      movieStream.stopWatching();
    }
  });

  // Socket: WebRTC Signals
  socket.on('signal-offer', ({ senderId, sdp }) => {
    console.log('Received WebRTC offer from:', senderId);
    webrtc.handleOffer(senderId, sdp);
  });

  socket.on('signal-answer', ({ sdp }) => {
    console.log('Received WebRTC answer');
    webrtc.handleAnswer(sdp);
  });

  socket.on('signal-ice', ({ candidate }) => {
    webrtc.handleIceCandidate(candidate);
  });

  // Socket: Peer Media State Changed
  socket.on('user-media-state-changed', ({ audioEnabled, videoEnabled }) => {
    if (audioEnabled !== undefined) {
      if (audioEnabled) {
        remoteBubble.classList.remove('mic-muted');
      } else {
        remoteBubble.classList.add('mic-muted');
      }
    }
    if (videoEnabled !== undefined) {
      if (videoEnabled) {
        remoteBubble.classList.remove('cam-off');
      } else {
        remoteBubble.classList.add('cam-off');
      }
    }
  });

  // Socket: Video Sync Actions
  socket.on('video-sync', (action) => {
    console.log('Handling video-sync action:', action);
    if (movieStream && movieStream.isWatching) {
      // In live stream mode, video playback and audio are streamed directly via WebRTC
      return;
    }
    syncManager.handleSyncAction(action);
  });

  socket.on('sync-pulse-echo', (pulse) => {
    const myId = socket.isVercel && socket.supabaseRoom ? socket.supabaseRoom.userId : socket.id;
    if (pulse.senderId !== myId) {
      syncManager.handleSyncPulse(pulse);
    }
  });

  setInterval(() => {
    if (currentRoomId && !mainVideo.paused && currentUser) {
      socket.emit('sync-pulse', {
        currentTime: mainVideo.currentTime,
        isPlaying: !mainVideo.paused
      });
    }
  }, 2000);

  // Socket: Live Chat
  function appendChatMessage(msg) {
    const isMine = msg.senderId === socket.id;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMine ? 'mine' : 'theirs'}`;

    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bubble.innerHTML = `
      <div class="chat-meta">${isMine ? 'You' : msg.senderName} • ${timeStr}</div>
      <div class="chat-text">${escapeHtml(msg.text)}</div>
    `;

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (!isChatOpen && !isMine) {
      unreadChatCount++;
      chatUnreadBadge.textContent = unreadChatCount;
      chatUnreadBadge.classList.add('active');
      showToast(`${msg.senderName}: ${msg.text.substring(0, 30)}`, '💬');
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  socket.on('new-chat', (msg) => {
    appendChatMessage(msg);
  });

  socket.on('new-reaction', ({ emoji }) => {
    triggerReaction(emoji);
  });

  // Dock: Toggle Mic
  btnToggleMic.addEventListener('click', () => {
    const isAudioActive = webrtc.toggleAudio();
    iconMicOn.style.display = isAudioActive ? 'block' : 'none';
    iconMicOff.style.display = isAudioActive ? 'none' : 'block';
    btnToggleMic.classList.toggle('danger', !isAudioActive);
    localBubble.classList.toggle('mic-muted', !isAudioActive);
    showToast(isAudioActive ? 'Microphone On 🎙️' : 'Microphone Muted 🔇');
  });

  // Dock: Toggle Cam
  btnToggleCam.addEventListener('click', () => {
    const isVideoActive = webrtc.toggleVideo();
    iconCamOn.style.display = isVideoActive ? 'block' : 'none';
    iconCamOff.style.display = isVideoActive ? 'none' : 'block';
    btnToggleCam.classList.toggle('danger', !isVideoActive);
    localBubble.classList.toggle('cam-off', !isVideoActive);
    showToast(isVideoActive ? 'Camera On 📹' : 'Camera Off 🚫');
  });

  // Dock: Flip Camera (mobile front/rear camera)
  btnFlipCam.addEventListener('click', async () => {
    showToast('Flipping camera... 🔄');
    const flipped = await webrtc.flipCamera(localVideo);
    if (flipped) {
      showToast('Camera flipped');
    }
  });

  // Dock: Open Media Selector
  btnOpenMedia.addEventListener('click', () => {
    sheetMediaBackdrop.classList.add('open');
  });
  btnCloseMedia.addEventListener('click', () => {
    sheetMediaBackdrop.classList.remove('open');
  });
  sheetMediaBackdrop.addEventListener('click', (e) => {
    if (e.target === sheetMediaBackdrop) sheetMediaBackdrop.classList.remove('open');
  });

  // =================================================================
  // GOOGLE DRIVE OAUTH & VIDEO PICKER
  // =================================================================
  const driveLoggedOut = document.getElementById('drive-logged-out');
  const driveLoggedIn = document.getElementById('drive-logged-in');
  const driveStatusDesc = document.getElementById('drive-status-desc');
  const driveUserEmailLabel = document.getElementById('drive-user-email-label');
  const btnGoogleSignin = document.getElementById('btn-google-signin');
  const btnGoogleSignout = document.getElementById('btn-google-signout');
  const btnBrowseDrive = document.getElementById('btn-browse-drive');
  const driveFilesContainer = document.getElementById('drive-files-container');
  const inputGdriveClientId = document.getElementById('input-gdrive-client-id');
  const btnSaveGdriveClientId = document.getElementById('btn-save-gdrive-client-id');

  const btnLoadDriveUrl = document.getElementById('btn-load-drive-url');

  if (btnLoadDriveUrl && inputDriveUrl) {
    btnLoadDriveUrl.addEventListener('click', (e) => {
      e.stopPropagation();
      const rawUrl = inputDriveUrl.value.trim();
      if (!rawUrl) {
        showToast('Please paste a Google Drive link', '⚠️');
        return;
      }

      // Extract file ID
      let driveId = null;
      const matchFile = rawUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (matchFile) driveId = matchFile[1];
      const matchId = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (matchId) driveId = matchId[1];
      if (/^[a-zA-Z0-9_-]{20,}$/.test(rawUrl)) driveId = rawUrl;

      if (!driveId) {
        showToast('Could not find Google Drive File ID', '❌');
        return;
      }

      const streamUrl = `/api/drive/stream?fileId=${driveId}`;
      const title = 'Google Drive Movie';

      syncManager.loadVideoSource(streamUrl, title, 0, true);

      socket.emit('video-action', {
        type: 'change-source',
        sourceType: 'drive',
        src: streamUrl,
        title: title,
        currentTime: 0,
        isPlaying: true,
        timestamp: Date.now()
      });

      sheetMediaBackdrop.classList.remove('open');
      showToast('Streaming Google Drive Video! 🎬', '☁️');
    });
  }

  const driveManager = new GoogleDriveManager({
    onAuthChange: (isAuthenticated, email) => {
      if (isAuthenticated) {
        if (driveLoggedOut) driveLoggedOut.style.display = 'none';
        if (driveLoggedIn) driveLoggedIn.style.display = 'flex';
        if (driveStatusDesc) driveStatusDesc.textContent = 'Connected to Google Drive';
        if (email && driveUserEmailLabel) driveUserEmailLabel.textContent = `Signed in as ${email}`;
        showToast('Google Drive connected! ☁️', '✅');
      } else {
        if (driveLoggedOut) driveLoggedOut.style.display = 'flex';
        if (driveLoggedIn) driveLoggedIn.style.display = 'none';
        if (driveFilesContainer) driveFilesContainer.style.display = 'none';
        if (driveStatusDesc) driveStatusDesc.textContent = 'Sign in with your Google account to access your Drive videos';
        showToast('Signed out of Google Drive', 'ℹ️');
      }
    }
  });

  if (driveManager.clientId && inputGdriveClientId) {
    inputGdriveClientId.value = driveManager.clientId;
  }

  if (driveManager.accessToken) {
    if (driveLoggedOut) driveLoggedOut.style.display = 'none';
    if (driveLoggedIn) driveLoggedIn.style.display = 'flex';
    if (driveStatusDesc) driveStatusDesc.textContent = 'Connected to Google Drive';
    if (driveManager.userEmail && driveUserEmailLabel) {
      driveUserEmailLabel.textContent = `Signed in as ${driveManager.userEmail}`;
    }
  }

  if (btnSaveGdriveClientId) {
    btnSaveGdriveClientId.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = inputGdriveClientId.value.trim();
      if (!id) {
        showToast('Please enter a Google Client ID', '⚠️');
        return;
      }
      driveManager.setClientId(id);
      showToast('Client ID saved! Now tap Sign in with Google', '💾');
    });
  }

  if (btnGoogleSignin) {
    btnGoogleSignin.addEventListener('click', (e) => {
      e.stopPropagation();
      driveManager.signIn();
    });
  }

  if (btnGoogleSignout) {
    btnGoogleSignout.addEventListener('click', (e) => {
      e.stopPropagation();
      driveManager.signOut();
    });
  }

  if (btnBrowseDrive) {
    btnBrowseDrive.addEventListener('click', async (e) => {
      e.stopPropagation();
      driveFilesContainer.style.display = 'flex';
      driveFilesContainer.innerHTML = '<div style="font-size:12px; color:var(--text-tertiary); text-align:center; padding:10px;">Loading videos from your Drive...</div>';

      try {
        const files = await driveManager.listDriveVideos();
        if (files.length === 0) {
          driveFilesContainer.innerHTML = '<div style="font-size:12px; color:var(--text-tertiary); text-align:center; padding:10px;">No video files found in your Google Drive.</div>';
          return;
        }

        driveFilesContainer.innerHTML = '';
        files.forEach((file) => {
          const item = document.createElement('div');
          item.className = 'media-item-card';
          item.style.padding = '8px 12px';

          const sizeMB = file.size ? (parseInt(file.size, 10) / (1024 * 1024)).toFixed(1) + ' MB' : '';

          item.innerHTML = `
            <div class="media-card-info" style="max-width: 75%;">
              <div class="media-card-title" style="font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">🎬 ${escapeHtml(file.name)}</div>
              <div class="media-card-desc" style="font-size:11px;">${sizeMB} • Google Drive</div>
            </div>
            <button class="btn-primary" style="width:auto; padding:4px 12px; font-size:12px; border-radius:10px;">Play</button>
          `;

          item.addEventListener('click', () => {
            const streamUrl = driveManager.getStreamUrl(file.id);
            const title = file.name;

            syncManager.loadVideoSource(streamUrl, title, 0, true);

            socket.emit('video-action', {
              type: 'change-source',
              sourceType: 'drive',
              src: streamUrl,
              title: title,
              currentTime: 0,
              isPlaying: true,
              timestamp: Date.now()
            });

            sheetMediaBackdrop.classList.remove('open');
            showToast(`Streaming from Drive: ${title}`, '☁️');
          });

          driveFilesContainer.appendChild(item);
        });
      } catch (err) {
        console.error(err);
        driveFilesContainer.innerHTML = `<div style="font-size:12px; color:var(--accent-pink); text-align:center; padding:10px;">${escapeHtml(err.message)}</div>`;
      }
    });
  }

  // Media: Preloaded Movies Click (Stream sample movie directly to room)
  document.querySelectorAll('.media-item-card[data-src]').forEach((card) => {
    card.addEventListener('click', async () => {
      const src = card.dataset.src;
      const title = card.dataset.title;

      sheetMediaBackdrop.classList.remove('open');
      showToast(`Starting stream: ${title}... 🍿`, '🎬');

      await movieStream.startSampleStream(src, title, activePeerId);
    });
  });

  // Media: Screen / Tab / App Streamer
  if (btnStreamScreen) {
    btnStreamScreen.addEventListener('click', async () => {
      sheetMediaBackdrop.classList.remove('open');
      await movieStream.startScreenStream(activePeerId);
    });
  }

  // Media: Local File Picker (Streams the movie file directly to friend - zero file needed on their side!)
  btnChooseLocalFile.addEventListener('click', () => {
    inputLocalVideo.click();
  });

  inputLocalVideo.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    sheetMediaBackdrop.classList.remove('open');
    showToast(`Streaming "${file.name}" to the room... 🍿`, '🎬');

    const started = await movieStream.startFileStream(file, activePeerId);
    if (started) {
      showToast(`Now streaming "${file.name}"! Friend is watching live!`, '✨');
    }
  });

  // Standby Stage Quick Action Buttons
  if (btnStandbyStreamFile) {
    btnStandbyStreamFile.addEventListener('click', () => {
      inputLocalVideo.click();
    });
  }

  if (btnStandbyShareScreen) {
    btnStandbyShareScreen.addEventListener('click', async () => {
      await movieStream.startScreenStream(activePeerId);
    });
  }

  if (btnStandbySampleMovie) {
    btnStandbySampleMovie.addEventListener('click', () => {
      sheetMediaBackdrop.classList.add('open');
    });
  }

  // Stop Streaming Button
  if (btnStopStreaming) {
    btnStopStreaming.addEventListener('click', (e) => {
      e.stopPropagation();
      movieStream.stopStream(true);
      showToast('Stopped streaming movie to room', '⏹️');
    });
  }

  // Media: Custom URL
  btnLoadUrl.addEventListener('click', () => {
    const url = inputCustomUrl.value.trim();
    if (!url) return;

    syncManager.loadVideoSource(url, 'Custom Stream', 0, true);

    socket.emit('video-action', {
      type: 'change-source',
      sourceType: 'url',
      src: url,
      title: 'Custom Stream',
      currentTime: 0,
      isPlaying: true,
      timestamp: Date.now()
    });

    sheetMediaBackdrop.classList.remove('open');
    showToast('Loaded custom stream', '🎬');
  });

  // Dock: Open Chat
  btnOpenChat.addEventListener('click', () => {
    isChatOpen = true;
    unreadChatCount = 0;
    chatUnreadBadge.textContent = '0';
    chatUnreadBadge.classList.remove('active');
    sheetChatBackdrop.classList.add('open');
    setTimeout(() => chatInput.focus(), 300);
  });

  btnCloseChat.addEventListener('click', () => {
    isChatOpen = false;
    sheetChatBackdrop.classList.remove('open');
  });

  sheetChatBackdrop.addEventListener('click', (e) => {
    if (e.target === sheetChatBackdrop) {
      isChatOpen = false;
      sheetChatBackdrop.classList.remove('open');
    }
  });

  // Submit Chat Message
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    socket.emit('send-chat', { text });
    chatInput.value = '';
  });

  // Share & QR Modal
  async function openShareModal() {
    if (!currentRoomId) return;

    sheetInviteBackdrop.classList.add('open');

    const joinUrl = `${window.location.origin}/?room=${encodeURIComponent(currentRoomId)}`;
    inputRoomUrl.value = joinUrl;
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(joinUrl)}`;

    if (!socket.isVercel) {
      try {
        const res = await fetch(`/api/room-qr/${currentRoomId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.qrDataUrl) qrImage.src = data.qrDataUrl;
          if (data.joinUrl) inputRoomUrl.value = data.joinUrl;
        }
      } catch (_) {}
    }
  }

  btnShowQr.addEventListener('click', openShareModal);
  btnRoomBadge.addEventListener('click', openShareModal);

  btnCloseInvite.addEventListener('click', () => {
    sheetInviteBackdrop.classList.remove('open');
  });

  sheetInviteBackdrop.addEventListener('click', (e) => {
    if (e.target === sheetInviteBackdrop) sheetInviteBackdrop.classList.remove('open');
  });

  btnCopyUrl.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inputRoomUrl.value);
      btnCopyUrl.textContent = 'Copied!';
      showToast('Room link copied to clipboard! 📋');
      setTimeout(() => { btnCopyUrl.textContent = 'Copy'; }, 2000);
    } catch (_) {
      inputRoomUrl.select();
      document.execCommand('copy');
      showToast('Room link copied!');
    }
  });
});
