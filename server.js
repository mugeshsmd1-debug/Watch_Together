const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode');
const selfsigned = require('selfsigned');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Generate self-signed certificate for local HTTPS (required for iOS Safari getUserMedia)
const pems = selfsigned.generate([{ name: 'commonName', value: 'WatchTogether Local' }], {
  days: 365,
  algorithm: 'sha256'
});

const HTTPS_PORT = process.env.HTTPS_PORT || 3000;
const HTTP_PORT = process.env.HTTP_PORT || 3001;

const httpsServer = https.createServer({
  key: pems.private,
  cert: pems.cert
}, app);

const httpServer = http.createServer(app);

// Attach Socket.io to both servers
const io = new Server({
  cors: { origin: '*' }
});
io.attach(httpsServer);
io.attach(httpServer);

// Helper to get local IPv4 address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIpAddress();

// In-memory room store
// roomId -> { users: Map<socketId, { id, name, isHost, audioEnabled, videoEnabled }>, videoState: {...}, chat: [] }
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      users: new Map(),
      videoState: {
        sourceType: 'sample',
        src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        title: 'Big Buck Bunny (Sample HD)',
        isPlaying: false,
        currentTime: 0,
        playbackRate: 1.0,
        lastUpdatedBy: null,
        lastUpdatedAt: Date.now()
      },
      chat: []
    });
  }
  return rooms.get(roomId);
}

// REST API for QR code and room metadata
app.get('/api/info', (req, res) => {
  res.json({
    localIp,
    httpsPort: HTTPS_PORT,
    httpPort: HTTP_PORT,
    httpsUrl: `https://${localIp}:${HTTPS_PORT}`,
    httpUrl: `http://${localIp}:${HTTP_PORT}`
  });
});

app.get('/api/room-qr/:roomId', async (req, res) => {
  try {
    const roomId = req.params.roomId.toUpperCase();
    const joinUrl = `https://${localIp}:${HTTPS_PORT}/?room=${roomId}`;
    const qrDataUrl = await qrcode.toDataURL(joinUrl, {
      margin: 1,
      width: 320,
      color: {
        dark: '#ffffff',
        light: '#00000000'
      }
    });
    res.json({ qrDataUrl, joinUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Socket.io real-time signaling & video sync
io.on('connection', (socket) => {
  let currentRoomId = null;

  // 1. Join Room
  socket.on('join-room', ({ roomId, userName }) => {
    roomId = roomId.trim().toUpperCase();
    currentRoomId = roomId;
    socket.join(roomId);

    const room = getOrCreateRoom(roomId);
    const isFirstUser = room.users.size === 0;

    const userProfile = {
      id: socket.id,
      name: userName || `Guest ${Math.floor(100 + Math.random() * 900)}`,
      isHost: isFirstUser,
      audioEnabled: true,
      videoEnabled: true
    };

    room.users.set(socket.id, userProfile);

    // Existing peers in the room
    const otherUsers = Array.from(room.users.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, u]) => ({ id, name: u.name, isHost: u.isHost, audioEnabled: u.audioEnabled, videoEnabled: u.videoEnabled }));

    // Send welcome state to joining user
    socket.emit('room-joined', {
      roomId,
      user: userProfile,
      otherUsers,
      videoState: room.videoState,
      chatHistory: room.chat.slice(-30)
    });

    // Notify other peers in room about new user
    socket.to(roomId).emit('user-joined', {
      user: userProfile
    });

    console.log(`[Room ${roomId}] User ${userProfile.name} (${socket.id}) joined. Total: ${room.users.size}`);
  });

  // 2. WebRTC Signaling (1-to-1 or peer-to-peer mesh)
  socket.on('signal-offer', ({ targetId, sdp }) => {
    socket.to(targetId).emit('signal-offer', {
      senderId: socket.id,
      sdp
    });
  });

  socket.on('signal-answer', ({ targetId, sdp }) => {
    socket.to(targetId).emit('signal-answer', {
      senderId: socket.id,
      sdp
    });
  });

  socket.on('signal-ice', ({ targetId, candidate }) => {
    socket.to(targetId).emit('signal-ice', {
      senderId: socket.id,
      candidate
    });
  });

  // 3. User AV State (Mic / Cam toggle)
  socket.on('update-media-state', ({ audioEnabled, videoEnabled }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || !room.users.has(socket.id)) return;

    const user = room.users.get(socket.id);
    if (audioEnabled !== undefined) user.audioEnabled = audioEnabled;
    if (videoEnabled !== undefined) user.videoEnabled = videoEnabled;

    socket.to(currentRoomId).emit('user-media-state-changed', {
      userId: socket.id,
      audioEnabled: user.audioEnabled,
      videoEnabled: user.videoEnabled
    });
  });

  // 4. Movie Player Synchronization
  socket.on('video-action', (action) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const sender = room.users.get(socket.id);
    const senderName = sender ? sender.name : 'Someone';

    // Update room master state
    const now = Date.now();
    if (action.type === 'play') {
      room.videoState.isPlaying = true;
      room.videoState.currentTime = action.currentTime;
      room.videoState.lastUpdatedAt = now;
      room.videoState.lastUpdatedBy = senderName;
    } else if (action.type === 'pause') {
      room.videoState.isPlaying = false;
      room.videoState.currentTime = action.currentTime;
      room.videoState.lastUpdatedAt = now;
      room.videoState.lastUpdatedBy = senderName;
    } else if (action.type === 'seek') {
      room.videoState.currentTime = action.currentTime;
      room.videoState.lastUpdatedAt = now;
      room.videoState.lastUpdatedBy = senderName;
    } else if (action.type === 'change-source') {
      room.videoState.sourceType = action.sourceType;
      room.videoState.src = action.src;
      room.videoState.title = action.title;
      room.videoState.currentTime = 0;
      room.videoState.isPlaying = action.isPlaying ?? false;
      room.videoState.lastUpdatedAt = now;
      room.videoState.lastUpdatedBy = senderName;
    }

    // Broadcast to everyone else in the room
    socket.to(currentRoomId).emit('video-sync', {
      ...action,
      senderId: socket.id,
      senderName,
      serverTimestamp: now
    });
  });

  // 5. Periodic Time Sync Pulse (Host or master pulse)
  socket.on('sync-pulse', ({ currentTime, isPlaying }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    room.videoState.currentTime = currentTime;
    room.videoState.isPlaying = isPlaying;
    room.videoState.lastUpdatedAt = Date.now();

    socket.to(currentRoomId).emit('sync-pulse-echo', {
      currentTime,
      isPlaying,
      serverTimestamp: Date.now(),
      senderId: socket.id
    });
  });

  // 6. Live Chat
  socket.on('send-chat', ({ text }) => {
    if (!currentRoomId || !text || !text.trim()) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const sender = room.users.get(socket.id);
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      senderId: socket.id,
      senderName: sender ? sender.name : 'Guest',
      isHost: sender ? sender.isHost : false,
      text: text.trim().substring(0, 500),
      timestamp: Date.now()
    };

    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.shift();

    io.in(currentRoomId).emit('new-chat', msg);
  });

  // 7. Live Reactions (Floating emoji burst)
  socket.on('send-reaction', ({ emoji }) => {
    if (!currentRoomId || !emoji) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const sender = room.users.get(socket.id);
    const reaction = {
      id: 'react_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      emoji,
      senderName: sender ? sender.name : 'Guest',
      timestamp: Date.now()
    };

    io.in(currentRoomId).emit('new-reaction', reaction);
  });

  // 8. Disconnect handling
  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const user = room.users.get(socket.id);
    room.users.delete(socket.id);

    console.log(`[Room ${currentRoomId}] User disconnected (${socket.id}). Remaining: ${room.users.size}`);

    socket.to(currentRoomId).emit('user-left', {
      userId: socket.id,
      userName: user ? user.name : 'Guest'
    });

    // If host left and peers remain, promote next user to host
    if (user && user.isHost && room.users.size > 0) {
      const nextHostEntry = room.users.entries().next().value;
      if (nextHostEntry) {
        const [nextHostId, nextHostUser] = nextHostEntry;
        nextHostUser.isHost = true;
        io.in(currentRoomId).emit('host-changed', {
          newHostId: nextHostId,
          newHostName: nextHostUser.name
        });
      }
    }

    // Clean up empty room after 10 minutes
    if (room.users.size === 0) {
      setTimeout(() => {
        if (room.users.size === 0) {
          rooms.delete(currentRoomId);
          console.log(`[Room ${currentRoomId}] Cleaned up inactive room.`);
        }
      }, 10 * 60 * 1000);
    }
  });
});

// Start servers
httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🎬 WatchTogether Server Running!`);
  console.log(`------------------------------------------------------`);
  console.log(`🔒 HTTPS (Required for iPhone Camera/Mic):`);
  console.log(`   ➜ Local:   https://localhost:${HTTPS_PORT}`);
  console.log(`   ➜ iPhone:  https://${localIp}:${HTTPS_PORT}`);
  console.log(`------------------------------------------------------`);
  console.log(`🌐 HTTP (For Desktop browsers):`);
  console.log(`   ➜ Local:   http://localhost:${HTTP_PORT}`);
  console.log(`   ➜ Network: http://${localIp}:${HTTP_PORT}`);
  console.log(`======================================================\n`);
});

httpServer.listen(HTTP_PORT, '0.0.0.0');
