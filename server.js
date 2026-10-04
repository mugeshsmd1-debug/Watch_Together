const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Readable } = require('stream');
const qrcode = require('qrcode');
const selfsigned = require('selfsigned');

// Load environment variables from .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Generate Apple-compliant self-signed certificate with SubjectAltName (SAN) for iOS Safari
const pems = selfsigned.generate([
  { name: 'commonName', value: localIp }
], {
  days: 365,
  algorithm: 'sha256',
  keySize: 2048,
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: localIp }
      ]
    }
  ]
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

// REST API for metadata
app.get('/api/info', (req, res) => {
  res.json({
    localIp,
    httpsPort: HTTPS_PORT,
    httpPort: HTTP_PORT,
    httpsUrl: `https://${localIp}:${HTTPS_PORT}`,
    httpUrl: `http://${localIp}:${HTTP_PORT}`
  });
});

// Google OAuth Client Configuration for seamless sign-in
app.get('/api/auth/google/config', (req, res) => {
  res.json({
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

app.get('/api/room-qr/:roomId', async (req, res) => {
  try {
    const rawHost = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const baseUrl = rawHost ? `${protocol}://${rawHost}` : `https://${localIp}:${HTTPS_PORT}`;
    
    let cleanCode = (req.params.roomId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanCode.startsWith('WT') && /^\d+$/.test(cleanCode)) {
      cleanCode = 'WT-' + cleanCode;
    } else if (cleanCode.startsWith('WT') && !cleanCode.startsWith('WT-')) {
      cleanCode = 'WT-' + cleanCode.substring(2);
    }
    const roomId = cleanCode || 'WT-MAIN';
    const joinUrl = `${baseUrl}/?room=${roomId}`;
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

// Authenticated Google Drive Stream with HTTP 206 Partial Content Range support
app.get('/api/drive/stream', async (req, res) => {
  const fileId = req.query.fileId || req.query.id;
  const token = req.query.token;

  if (!fileId) return res.status(400).send('Missing fileId');

  try {
    const googleHeaders = {};
    if (token) {
      googleHeaders['Authorization'] = `Bearer ${token}`;
    }
    if (req.headers.range) {
      googleHeaders['Range'] = req.headers.range;
    }

    const driveUrl = token
      ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
      : `https://drive.google.com/uc?export=download&id=${fileId}`;

    const googleRes = await fetch(driveUrl, {
      headers: googleHeaders
    });

    if (!googleRes.ok) {
      const errText = await googleRes.text();
      console.error(`Google Drive stream error (${googleRes.status}):`, errText);
      return res.status(googleRes.status).send(errText);
    }

    res.status(googleRes.status);
    ['content-range', 'content-length', 'content-type', 'accept-ranges'].forEach((h) => {
      const val = googleRes.headers.get(h);
      if (val) res.setHeader(h, val);
    });

    if (!googleRes.headers.get('accept-ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    const nodeStream = Readable.fromWeb(googleRes.body);
    nodeStream.pipe(res);

    req.on('close', () => {
      nodeStream.destroy();
    });
  } catch (err) {
    console.error('Error streaming from Google Drive:', err);
    if (!res.headersSent) {
      res.status(500).send('Failed to stream video from Google Drive');
    }
  }
});

// Google Drive List User Video Files (OAuth 2.0)
app.get('/api/drive/files', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=mimeType contains 'video/' and trashed = false&fields=files(id, name, mimeType, size, thumbnailLink, createdTime)&orderBy=modifiedTime desc&pageSize=25`;
    const googleRes = await fetch(listUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!googleRes.ok) {
      const err = await googleRes.json();
      return res.status(googleRes.status).json(err);
    }

    const data = await googleRes.json();
    res.json(data);
  } catch (err) {
    console.error('Error listing Google Drive files:', err);
    res.status(500).json({ error: 'Failed to list Google Drive files' });
  }
});

// Socket.io real-time signaling & video sync
io.on('connection', (socket) => {
  let currentRoomId = null;

  // 1. Join Room
  socket.on('join-room', ({ roomId, userName }) => {
    let cleanCode = (roomId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleanCode.startsWith('WT') && /^\d+$/.test(cleanCode)) {
      cleanCode = 'WT-' + cleanCode;
    } else if (cleanCode.startsWith('WT') && !cleanCode.startsWith('WT-')) {
      cleanCode = 'WT-' + cleanCode.substring(2);
    }
    roomId = cleanCode || 'WT-MAIN';
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
      currentStreamer: room.currentStreamer || null,
      chatHistory: room.chat.slice(-30)
    });

    // Notify other peers in room about new user
    socket.to(roomId).emit('user-joined', {
      user: userProfile
    });

    console.log(`[Room ${roomId}] User ${userProfile.name} (${socket.id}) joined. Total: ${room.users.size}`);
  });

  // 2. WebRTC Signaling (Direct peer routing)
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

  // 2b. Movie WebRTC Signaling (Direct peer streaming of movies & screen)
  socket.on('movie-signal-offer', ({ targetId, sdp }) => {
    socket.to(targetId).emit('movie-signal-offer', {
      senderId: socket.id,
      sdp
    });
  });

  socket.on('movie-signal-answer', ({ targetId, sdp }) => {
    socket.to(targetId).emit('movie-signal-answer', {
      senderId: socket.id,
      sdp
    });
  });

  socket.on('movie-signal-ice', ({ targetId, candidate }) => {
    socket.to(targetId).emit('movie-signal-ice', {
      senderId: socket.id,
      candidate
    });
  });

  socket.on('movie-stream-started', (data) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.currentStreamer = {
        streamerId: socket.id,
        streamerName: data.streamerName,
        title: data.title,
        streamType: data.streamType
      };
    }
    socket.to(currentRoomId).emit('movie-stream-started', {
      ...data,
      streamerId: socket.id
    });
  });

  socket.on('movie-stream-request', ({ targetId }) => {
    if (!currentRoomId) return;
    if (targetId) {
      socket.to(targetId).emit('movie-stream-request', {
        watcherId: socket.id
      });
    } else {
      socket.to(currentRoomId).emit('movie-stream-request', {
        watcherId: socket.id
      });
    }
  });

  socket.on('movie-stream-stopped', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.currentStreamer = null;
    }
    socket.to(currentRoomId).emit('movie-stream-stopped', {
      streamerId: socket.id
    });
  });

  socket.on('movie-control-action', (action) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('movie-control-action', {
      ...action,
      senderId: socket.id
    });
  });

  socket.on('movie-progress-update', (data) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('movie-progress-update', {
      ...data,
      senderId: socket.id
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

  // 5. Periodic Time Sync Pulse
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

    if (room.currentStreamer && room.currentStreamer.streamerId === socket.id) {
      room.currentStreamer = null;
      socket.to(currentRoomId).emit('movie-stream-stopped', {
        streamerId: socket.id
      });
    }

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
const CLOUD_PORT = process.env.PORT;

if (CLOUD_PORT) {
  httpServer.listen(CLOUD_PORT, '0.0.0.0', () => {
    console.log(`🎬 WatchTogether Cloud Server running on port ${CLOUD_PORT}`);
  });
} else {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🎬 WatchTogether Server Running!`);
    console.log(`------------------------------------------------------`);
    console.log(`🔒 HTTPS (For iPhone Camera/Mic with Apple SAN SSL):`);
    console.log(`   ➜ Local:   https://localhost:${HTTPS_PORT}`);
    console.log(`   ➜ iPhone:  https://${localIp}:${HTTPS_PORT}`);
    console.log(`------------------------------------------------------`);
    console.log(`🌐 HTTP (Direct network browser access):`);
    console.log(`   ➜ Local:   http://localhost:${HTTP_PORT}`);
    console.log(`   ➜ Network: http://${localIp}:${HTTP_PORT}`);
    console.log(`======================================================\n`);
  });

  httpServer.listen(HTTP_PORT, '0.0.0.0');
}
