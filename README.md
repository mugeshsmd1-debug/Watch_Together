# 🎬 OurScreen

A native-feel, mobile-first Progressive Web App (PWA) designed to stream movies in sync with real-time peer-to-peer video calls, floating camera bubbles, live text chat, and animated emoji reactions.

Tested and optimized for iPhone (iOS Safari) and desktop browsers.

---

## 🌟 Key Features

1. **👤 1-Click Room Creation & QR Invite**:
   - Host generates a unique room code.
   - Built-in QR Code generation allows your friend or your iPhone to join immediately by pointing the iPhone Camera at the screen.
2. **📹 Peer-to-Peer Video & Audio (WebRTC)**:
   - Real-time two-way camera and voice communication via WebRTC.
   - Mute/unmute microphone and toggle camera on/off.
   - Front/rear camera flipping support for mobile devices.
   - Real-time speaking detection with an audio-reactive glowing halo around the camera bubble.
3. **🎬 Draggable Floating Camera Bubbles**:
   - Camera feeds hover directly over the movie player in sleek iOS glass bubbles.
   - Touch and pointer draggable anywhere on screen so they never block subtitles.
4. **📡 One-Device Movie & Screen Streaming (P2P WebRTC)**:
   - Either device (the host or anyone who joined the room) can be the Streamer.
   - Stream any local movie file (MP4, MKV, WebM, MOV), preloaded film, or share a Screen / Browser Tab / App window.
   - The other device(s) watch the incoming live stream in real time with synchronized audio — **no need to have, upload, or play the movie file on both devices**!
   - Remote controls: Watchers can pause, play, or seek, and the streamer's device updates instantly for everyone.
5. **📁 Multiple Content Options**:
   - Stream Local Movie Files directly from device storage.
   - Screen / Tab / App sharing with system & tab audio (YouTube, VLC, desktop media players).
   - Preloaded High-Definition classics (Big Buck Bunny, Tears of Steel, Sintel, Elephants Dream).
   - Authenticated Google Drive streaming with HTTP 206 range seeking.
   - Direct video stream URL input (MP4 / WebM).
6. **💬 Live Chat & ❤️ Reactions**:
   - Slide-up iOS bottom sheet chat drawer with unread counter badge.
   - Floating emoji reactions (❤️, 😂, 🍿, 🔥, 👏) that burst into physics-based floating animations over the video.
7. **📱 iPhone Native PWA Experience**:
   - Standalone display mode with iOS notch/Dynamic Island safe-area handling.
   - Supports "Add to Home Screen" in iOS Safari for a distraction-free, native fullscreen app experience.

---

## 🚀 Quick Start

### 1. Start the Server
```bash
npm start
```

The server automatically spins up both:
- **🔒 HTTPS (`https://192.168.1.19:3000`)**: Required by iOS Safari to permit camera and microphone access.
- **🌐 HTTP (`http://localhost:3001`)**: Available for local desktop testing.

---

## 📱 Testing on Your iPhone

1. Make sure your **iPhone** is connected to the same Wi-Fi network as this PC.
2. On your iPhone, open **Safari** and visit:
   ```
   https://192.168.1.19:3000
   ```
   *(Or on your PC, create a room, click the **QR code icon**, and scan it with your iPhone Camera!)*
3. **First-time SSL prompt on iPhone**:
   Because the local server generates an internal development certificate, Safari will display a warning:
   - Tap **"Show Details"** (or **"Advanced"**).
   - Tap **"visit this website"** / **"Proceed"**.
4. Tap **"Allow"** when Safari prompts for Camera and Microphone access.
5. *(Optional)* Tap the Safari **Share icon** ➔ **"Add to Home Screen"** to run OurScreen as a standalone fullscreen app!
