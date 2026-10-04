"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Film,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Share2,
  MessageSquare,
  Users,
  Copy,
  Check,
  Sparkles,
  ArrowLeft,
  FolderOpen,
  Link as LinkIcon,
  Tv,
  MonitorUp,
  X,
  Send,
  Radio,
} from "lucide-react";
import { supabase, WatchRoom, WatchMessage } from "../../../lib/supabase";

interface Participant {
  id: string;
  name: string;
  isHost?: boolean;
  hasVideo?: boolean;
  hasAudio?: boolean;
  stream?: MediaStream;
}

interface FloatingEmoji {
  id: string;
  emoji: string;
  senderName: string;
  left: number;
}

const SAMPLE_MOVIES = [
  {
    title: "Big Buck Bunny (Animation)",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  },
  {
    title: "Tears of Steel (Sci-Fi 4K)",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  },
  {
    title: "Sintel (Fantasy Trailer)",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  },
];

export default function WatchRoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = (params?.id as string)?.toUpperCase() || "";

  // User state
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("Viewer");
  const [isHost, setIsHost] = useState(false);

  // Video playback state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const isLocalAction = useRef(false);

  // Video source state
  const [sourceType, setSourceType] = useState<"sample" | "url" | "local_sync" | "stream">("sample");
  const [currentVideoUrl, setCurrentVideoUrl] = useState(SAMPLE_MOVIES[0].url);
  const [currentVideoTitle, setCurrentVideoTitle] = useState(SAMPLE_MOVIES[0].title);
  const [customUrlInput, setCustomUrlInput] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [showSourceModal, setShowSourceModal] = useState(false);

  // Realtime & Presence
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<WatchMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // WebRTC Call state (FaceTime / WhatsApp video call)
  const [myCameraStream, setMyCameraStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const peerConnections = useRef<{ [peerId: string]: RTCPeerConnection }>({});
  const localStreamRef = useRef<MediaStream | null>(null);

  // Screen/Movie Live Stream Mode (WebRTC Host Streamer)
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Channel reference
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // 1. Initialize user and load room data
  useEffect(() => {
    let savedId = localStorage.getItem("ourscreen_userid");
    if (!savedId) {
      savedId = "usr_" + Math.random().toString(36).substring(2, 9);
      localStorage.setItem("ourscreen_userid", savedId);
    }
    setUserId(savedId);

    const savedName = localStorage.getItem("ourscreen_username") || `Viewer_${savedId.slice(-3)}`;
    setUserName(savedName);

    // Fetch initial room record
    const fetchRoom = async () => {
      try {
        const { data, error } = await supabase.from("watch_rooms").select("*").eq("id", roomId).single();
        if (data) {
          if (data.host_id === savedId) {
            setIsHost(true);
          }
          if (data.video_url) {
            setCurrentVideoUrl(data.video_url);
            setCurrentVideoTitle(data.video_title || "Shared Movie");
            setSourceType(data.video_source_type || "sample");
          }
        }
      } catch (err) {
        console.warn("Could not query room directly:", err);
      }
    };

    fetchRoom();
  }, [roomId]);

  // 2. Realtime Broadcast & Presence Channel Setup
  useEffect(() => {
    if (!roomId || !userId) return;

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userId },
      },
    });

    channelRef.current = channel;

    // A. SYNC Broadcast Events
    channel
      .on("broadcast", { event: "SYNC_PLAY" }, ({ payload }) => {
        if (!videoRef.current) return;
        isLocalAction.current = true;
        const diff = Math.abs(videoRef.current.currentTime - payload.time);
        if (diff > 0.4) {
          videoRef.current.currentTime = payload.time;
        }
        videoRef.current.play().catch(() => setAutoplayBlocked(true));
        setIsPlaying(true);
        setTimeout(() => {
          isLocalAction.current = false;
        }, 150);
      })
      .on("broadcast", { event: "SYNC_PAUSE" }, ({ payload }) => {
        if (!videoRef.current) return;
        isLocalAction.current = true;
        videoRef.current.currentTime = payload.time;
        videoRef.current.pause();
        setIsPlaying(false);
        setTimeout(() => {
          isLocalAction.current = false;
        }, 150);
      })
      .on("broadcast", { event: "SYNC_SEEK" }, ({ payload }) => {
        if (!videoRef.current) return;
        isLocalAction.current = true;
        videoRef.current.currentTime = payload.time;
        if (payload.isPlaying) {
          videoRef.current.play().catch(() => setAutoplayBlocked(true));
          setIsPlaying(true);
        } else {
          videoRef.current.pause();
          setIsPlaying(false);
        }
        setTimeout(() => {
          isLocalAction.current = false;
        }, 150);
      })
      .on("broadcast", { event: "SYNC_SOURCE" }, ({ payload }) => {
        setSourceType(payload.sourceType);
        setCurrentVideoUrl(payload.sourceUrl);
        setCurrentVideoTitle(payload.title);
        if (videoRef.current) {
          videoRef.current.src = payload.sourceUrl;
          videoRef.current.load();
        }
      })
      .on("broadcast", { event: "REACTION" }, ({ payload }) => {
        showFloatingReaction(payload.emoji, payload.senderName);
      })
      .on("broadcast", { event: "CHAT_MESSAGE" }, ({ payload }) => {
        setMessages((prev) => [...prev, payload]);
      })
      .on("broadcast", { event: "WEBRTC_SIGNAL" }, async ({ payload }) => {
        if (payload.targetId !== userId) return;
        handleWebRtcSignal(payload.senderId, payload.signal);
      });

    // B. Presence Tracking
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const activeUsers: Participant[] = [];
        for (const id in state) {
          const u = state[id][0] as { name: string; hasVideo?: boolean; hasAudio?: boolean; isHost?: boolean };
          activeUsers.push({
            id,
            name: u.name || "Viewer",
            isHost: u.isHost,
            hasVideo: u.hasVideo,
            hasAudio: u.hasAudio,
          });
        }
        setParticipants(activeUsers);
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        // If a new peer joins, establish WebRTC connection if camera/audio is active
        const newPeer = newPresences[0] as { key: string; name: string };
        if (newPeer && newPeer.key !== userId && localStreamRef.current) {
          initiateWebRtcCall(newPeer.key);
        }
      });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          name: userName,
          isHost,
          hasVideo: cameraActive,
          hasAudio: micActive,
        });
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [roomId, userId, userName, isHost, cameraActive, micActive]);

  // 3. WebRTC Call Helpers (FaceTime-style video calls over Supabase Realtime signaling)
  const getOrCreatePeerConnection = (peerId: string) => {
    if (peerConnections.current[peerId]) {
      return peerConnections.current[peerId];
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    // Attach local audio/video tracks if present
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "WEBRTC_SIGNAL",
          payload: {
            senderId: userId,
            targetId: peerId,
            signal: { type: "ice", candidate: event.candidate },
          },
        });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setParticipants((prev) =>
        prev.map((p) => (p.id === peerId ? { ...p, stream: remoteStream, hasVideo: true } : p))
      );
    };

    peerConnections.current[peerId] = pc;
    return pc;
  };

  const initiateWebRtcCall = async (peerId: string) => {
    try {
      const pc = getOrCreatePeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      channelRef.current?.send({
        type: "broadcast",
        event: "WEBRTC_SIGNAL",
        payload: {
          senderId: userId,
          targetId: peerId,
          signal: { type: "offer", sdp: offer },
        },
      });
    } catch (err) {
      console.error("WebRTC offer error:", err);
    }
  };

  const handleWebRtcSignal = async (senderId: string, signal: any) => {
    try {
      const pc = getOrCreatePeerConnection(senderId);
      if (signal.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        channelRef.current?.send({
          type: "broadcast",
          event: "WEBRTC_SIGNAL",
          payload: {
            senderId: userId,
            targetId: senderId,
            signal: { type: "answer", sdp: answer },
          },
        });
      } else if (signal.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.type === "ice" && signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.error("WebRTC signal handling error:", err);
    }
  };

  // 4. Camera & Microphone Toggle
  const toggleCamera = async () => {
    try {
      if (cameraActive && myCameraStream) {
        myCameraStream.getVideoTracks().forEach((track) => track.stop());
        const audioTracks = myCameraStream.getAudioTracks();
        if (audioTracks.length > 0) {
          const newStream = new MediaStream(audioTracks);
          setMyCameraStream(newStream);
          localStreamRef.current = newStream;
        } else {
          setMyCameraStream(null);
          localStreamRef.current = null;
        }
        setCameraActive(false);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
          audio: micActive,
        });

        setMyCameraStream(stream);
        localStreamRef.current = stream;
        setCameraActive(true);

        // Add track to all existing peer connections
        Object.entries(peerConnections.current).forEach(([peerId, pc]) => {
          stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream));
          initiateWebRtcCall(peerId);
        });
      }

      // Update presence
      channelRef.current?.track({
        name: userName,
        isHost,
        hasVideo: !cameraActive,
        hasAudio: micActive,
      });
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Could not access camera. Please allow camera permissions in your browser.");
    }
  };

  const toggleMic = async () => {
    try {
      if (micActive && myCameraStream) {
        myCameraStream.getAudioTracks().forEach((track) => (track.enabled = false));
        setMicActive(false);
      } else if (myCameraStream && myCameraStream.getAudioTracks().length > 0) {
        myCameraStream.getAudioTracks().forEach((track) => (track.enabled = true));
        setMicActive(true);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (myCameraStream) {
          stream.getAudioTracks().forEach((t) => myCameraStream.addTrack(t));
        } else {
          setMyCameraStream(stream);
          localStreamRef.current = stream;
        }
        setMicActive(true);
      }

      channelRef.current?.track({
        name: userName,
        isHost,
        hasVideo: cameraActive,
        hasAudio: !micActive,
      });
    } catch (err) {
      console.error("Mic access error:", err);
    }
  };

  // 5. Video Player Playback Control & Sync Handlers
  const handlePlay = () => {
    if (isLocalAction.current || !videoRef.current) return;
    setIsPlaying(true);
    channelRef.current?.send({
      type: "broadcast",
      event: "SYNC_PLAY",
      payload: { time: videoRef.current.currentTime, senderId: userId },
    });
  };

  const handlePause = () => {
    if (isLocalAction.current || !videoRef.current) return;
    setIsPlaying(false);
    channelRef.current?.send({
      type: "broadcast",
      event: "SYNC_PAUSE",
      payload: { time: videoRef.current.currentTime, senderId: userId },
    });
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const targetTime = parseFloat(e.target.value);
    videoRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);

    channelRef.current?.send({
      type: "broadcast",
      event: "SYNC_SEEK",
      payload: { time: targetTime, isPlaying, senderId: userId },
    });
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => setAutoplayBlocked(true));
      handlePlay();
    } else {
      videoRef.current.pause();
      handlePause();
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
  };

  // 6. Local File Selection (Local Movie File Sync Mode)
  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;

    const fileUrl = URL.createObjectURL(file);
    setSelectedFileName(file.name);
    setCurrentVideoTitle(file.name);
    setCurrentVideoUrl(fileUrl);
    setSourceType("local_sync");

    videoRef.current.src = fileUrl;
    videoRef.current.load();
    setShowSourceModal(false);

    // Notify room of source change
    channelRef.current?.send({
      type: "broadcast",
      event: "SYNC_SOURCE",
      payload: {
        sourceType: "local_sync",
        sourceUrl: fileUrl,
        title: file.name,
        senderId: userId,
      },
    });
  };

  // 7. Custom URL Source Selection
  const handleApplyCustomUrl = (urlToUse?: string, titleToUse?: string) => {
    const targetUrl = urlToUse || customUrlInput.trim();
    if (!targetUrl || !videoRef.current) return;

    const targetTitle = titleToUse || "Web Video Stream";
    setCurrentVideoUrl(targetUrl);
    setCurrentVideoTitle(targetTitle);
    setSourceType("url");

    videoRef.current.src = targetUrl;
    videoRef.current.load();
    setShowSourceModal(false);
    setCustomUrlInput("");

    channelRef.current?.send({
      type: "broadcast",
      event: "SYNC_SOURCE",
      payload: {
        sourceType: "url",
        sourceUrl: targetUrl,
        title: targetTitle,
        senderId: userId,
      },
    });
  };

  // 8. Emoji Reactions
  const sendReaction = (emoji: string) => {
    showFloatingReaction(emoji, "You");
    channelRef.current?.send({
      type: "broadcast",
      event: "REACTION",
      payload: { emoji, senderName: userName, id: Math.random().toString() },
    });
  };

  const showFloatingReaction = (emoji: string, senderName: string) => {
    const newReaction: FloatingEmoji = {
      id: Math.random().toString(36).substring(2, 9),
      emoji,
      senderName,
      left: Math.floor(Math.random() * 70) + 15,
    };
    setFloatingEmojis((prev) => [...prev, newReaction]);
    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((r) => r.id !== newReaction.id));
    }, 2000);
  };

  // 9. Chat Message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const newMsg: WatchMessage = {
      id: Math.random().toString(),
      room_id: roomId,
      user_id: userId,
      user_name: userName,
      content: chatInput.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMsg]);
    setChatInput("");

    channelRef.current?.send({
      type: "broadcast",
      event: "CHAT_MESSAGE",
      payload: newMsg,
    });
  };

  // 10. Copy Invite Link & WhatsApp Share
  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const shareViaWhatsApp = () => {
    const inviteUrl = `${window.location.origin}/room/${roomId}`;
    const text = encodeURIComponent(`🍿 Join my movie room on OurScreen! Watch together with sync and video call:\n${inviteUrl}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col justify-between overflow-x-hidden">
      {/* Autoplay Unmute Alert Banner */}
      {autoplayBlocked && (
        <div className="bg-gradient-to-r from-amber-600 to-indigo-600 px-4 py-2.5 text-center text-xs sm:text-sm font-semibold flex items-center justify-center gap-3 shadow-lg z-50">
          <span>🔊 Sound is muted by browser policy. Tap to unmute and join playback:</span>
          <button
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = false;
                videoRef.current.play();
                setIsMuted(false);
                setAutoplayBlocked(false);
              }
            }}
            className="px-3 py-1 bg-white text-slate-900 rounded-lg text-xs font-bold shadow hover:bg-slate-100 transition-all"
          >
            Enable Sound
          </button>
        </div>
      )}

      {/* Top Bar */}
      <header className="px-4 lg:px-8 py-3 bg-[#0d1322]/90 backdrop-blur-md border-b border-white/5 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
            title="Back to Home"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm sm:text-base text-white tracking-tight">OurScreen</span>
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-mono font-bold uppercase">
                #{roomId}
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate max-w-[200px] sm:max-w-xs">{currentVideoTitle}</p>
          </div>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Change movie source button */}
          <button
            onClick={() => setShowSourceModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 hover:text-white transition-all"
          >
            <Tv className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Change Movie</span>
          </button>

          {/* Invite button */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-md shadow-indigo-600/30 transition-all"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Invite</span>
          </button>

          {/* Toggle Chat button */}
          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-2 rounded-xl border transition-all relative ${
              showChat
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            {messages.length > 0 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-pink-500"></span>
            )}
          </button>
        </div>
      </header>

      {/* Main Room Content */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-2 sm:p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        {/* Left 3 cols: Cinema Theater & Video Call Bar */}
        <div className={`space-y-4 ${showChat ? "lg:col-span-3" : "lg:col-span-4"}`}>
          {/* Cinema Screen Container */}
          <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden bg-black aspect-video shadow-2xl border border-white/10 flex items-center justify-center group">
            {/* The HTML5 Video Element */}
            <video
              ref={videoRef}
              src={currentVideoUrl}
              onPlay={handlePlay}
              onPause={handlePause}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              playsInline
              className="w-full h-full object-contain"
            />

            {/* Floating Reactions Overlay */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
              {floatingEmojis.map((r) => (
                <div
                  key={r.id}
                  style={{ left: `${r.left}%`, bottom: "15%" }}
                  className="absolute animate-float-reaction flex flex-col items-center select-none"
                >
                  <span className="text-4xl drop-shadow-lg">{r.emoji}</span>
                  <span className="text-[10px] font-bold bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded-full text-white/90">
                    {r.senderName}
                  </span>
                </div>
              ))}
            </div>

            {/* Tap to Play / Pause Center Overlay */}
            <div
              onClick={togglePlayPause}
              className="absolute inset-0 cursor-pointer flex items-center justify-center z-10"
            >
              {!isPlaying && (
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-indigo-600/80 backdrop-blur-md flex items-center justify-center shadow-2xl shadow-indigo-600/50 hover:scale-110 transition-transform">
                  <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-white text-white translate-x-0.5" />
                </div>
              )}
            </div>

            {/* Custom Cinema Control Bar (Visible on Hover / Tap) */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-3 sm:p-4 z-30 transition-opacity duration-300 opacity-90 sm:opacity-0 sm:group-hover:opacity-100">
              {/* Seek progress slider */}
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1.5 bg-white/20 accent-indigo-500 rounded-lg cursor-pointer mb-3"
              />

              <div className="flex items-center justify-between text-xs sm:text-sm">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlayPause}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-all"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-white" />}
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        if (videoRef.current) {
                          const nextMute = !isMuted;
                          videoRef.current.muted = nextMute;
                          setIsMuted(nextMute);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-all"
                    >
                      {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setVolume(val);
                        if (videoRef.current) {
                          videoRef.current.volume = val;
                          videoRef.current.muted = false;
                          setIsMuted(false);
                        }
                      }}
                      className="w-16 h-1 bg-white/20 accent-indigo-500 rounded-lg hidden sm:inline"
                    />
                  </div>

                  <span className="text-xs font-mono text-slate-300">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                {/* Right controls: Fullscreen */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!document.fullscreenElement) {
                        videoRef.current?.requestFullscreen?.();
                        setIsFullscreen(true);
                      } else {
                        document.exitFullscreen?.();
                        setIsFullscreen(false);
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-all"
                  >
                    {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Reaction Emoji Bar */}
          <div className="flex items-center justify-between p-2.5 rounded-2xl bg-[#0f172a]/80 border border-white/5 backdrop-blur-md">
            <span className="text-xs font-semibold text-slate-400 px-2 hidden sm:inline">React:</span>
            <div className="flex items-center gap-1.5 sm:gap-3 flex-1 justify-around sm:justify-start">
              {["❤️", "🔥", "😂", "🍿", "🚀", "👏", "😱"].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/5 hover:bg-white/15 hover:scale-125 active:scale-95 transition-all flex items-center justify-center text-lg sm:text-xl"
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pl-2 border-l border-white/10">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-semibold text-slate-300">{participants.length} watching</span>
            </div>
          </div>

          {/* Video Call & Audio Mesh (FaceTime / WhatsApp Style Floating Heads) */}
          <div className="p-4 rounded-2xl bg-[#0f172a]/90 border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Live Video Call</h3>
              </div>

              {/* Call Control Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleCamera}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    cameraActive
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                      : "bg-white/5 hover:bg-white/10 text-slate-300"
                  }`}
                >
                  {cameraActive ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  <span>{cameraActive ? "Camera On" : "Start Camera"}</span>
                </button>

                <button
                  onClick={toggleMic}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    micActive
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                      : "bg-white/5 hover:bg-white/10 text-slate-300"
                  }`}
                >
                  {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5 text-rose-400" />}
                  <span>{micActive ? "Mic On" : "Muted"}</span>
                </button>
              </div>
            </div>

            {/* Video Call Tiles Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Local User Tile */}
              <div className="relative aspect-video rounded-xl overflow-hidden bg-black/60 border border-white/10 flex items-center justify-center">
                {cameraActive && myCameraStream ? (
                  <video
                    ref={(v) => {
                      if (v && v.srcObject !== myCameraStream) {
                        v.srcObject = myCameraStream;
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover transform -scale-x-100"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center font-bold text-sm text-indigo-300">
                      {userName.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-[10px] text-slate-400">Camera Off</span>
                  </div>
                )}
                <div className="absolute bottom-1.5 left-2 flex items-center gap-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-white">
                  <span>{userName} (You)</span>
                  {micActive ? <Mic className="w-2.5 h-2.5 text-emerald-400" /> : <MicOff className="w-2.5 h-2.5 text-rose-400" />}
                </div>
              </div>

              {/* Remote Participants Tiles */}
              {participants
                .filter((p) => p.id !== userId)
                .map((peer) => (
                  <div
                    key={peer.id}
                    className="relative aspect-video rounded-xl overflow-hidden bg-black/60 border border-white/10 flex items-center justify-center"
                  >
                    {peer.stream ? (
                      <video
                        ref={(v) => {
                          if (v && v.srcObject !== peer.stream) {
                            v.srcObject = peer.stream!;
                          }
                        }}
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-10 h-10 rounded-full bg-pink-500/20 border border-pink-500/40 flex items-center justify-center font-bold text-sm text-pink-300">
                          {peer.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-[10px] text-slate-400">Watching</span>
                      </div>
                    )}
                    <div className="absolute bottom-1.5 left-2 flex items-center gap-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-white">
                      <span>{peer.name}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Right 1 col: Realtime Chat Drawer */}
        {showChat && (
          <div className="lg:col-span-1 bg-[#0f172a]/90 border border-white/10 rounded-2xl sm:rounded-3xl p-4 h-[550px] flex flex-col justify-between backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <h3 className="font-bold text-sm text-white">Live Chat</h3>
              </div>
              <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages list */}
            <div className="flex-1 overflow-y-auto py-3 space-y-2.5 pr-1">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-xs text-slate-500">
                  <Sparkles className="w-6 h-6 mb-2 text-indigo-400/50" />
                  <p>No messages yet.</p>
                  <p>Say hello to everyone in the room!</p>
                </div>
              ) : (
                messages.map((m) => {
                  const isMe = m.user_id === userId;
                  return (
                    <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                      <span className="text-[10px] text-slate-400 px-1">{m.user_name}</span>
                      <div
                        className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs ${
                          isMe
                            ? "bg-indigo-600 text-white rounded-tr-none"
                            : "bg-white/10 text-slate-200 rounded-tl-none"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Message input */}
            <form onSubmit={handleSendMessage} className="pt-2 flex items-center gap-2 border-t border-white/10">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-600/30"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Modal: Change Movie Source */}
      {showSourceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setShowSourceModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-xl font-bold text-white mb-1">Choose Movie to Watch</h2>
            <p className="text-xs text-slate-400 mb-6">
              Pick a free sample movie, select your own local file, or enter an online streaming link.
            </p>

            <div className="space-y-4">
              {/* Option 1: Sample movies */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-2">
                  Sample Open-Source Movies (Instant Sync)
                </label>
                <div className="space-y-2">
                  {SAMPLE_MOVIES.map((sample) => (
                    <button
                      key={sample.title}
                      onClick={() => handleApplyCustomUrl(sample.url, sample.title)}
                      className="w-full p-3 rounded-xl bg-white/5 hover:bg-indigo-600/20 border border-white/10 hover:border-indigo-500/50 text-left transition-all flex items-center justify-between"
                    >
                      <div>
                        <p className="text-xs font-bold text-white">{sample.title}</p>
                        <p className="text-[10px] text-slate-400 truncate max-w-xs">{sample.url}</p>
                      </div>
                      <Play className="w-4 h-4 text-indigo-400 fill-indigo-400" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Option 2: Local Video File Sync */}
              <div className="pt-2 border-t border-white/10">
                <label className="block text-xs font-semibold uppercase tracking-wider text-pink-400 mb-1">
                  Local Movie File Sync
                </label>
                <p className="text-[11px] text-slate-400 mb-2">
                  Select your copy of the movie file. Zero upload delay — both devices play directly from disk in sync!
                </p>
                <label className="flex items-center justify-center gap-2 w-full p-3 rounded-xl bg-pink-500/10 hover:bg-pink-500/20 border border-pink-500/30 text-pink-300 font-semibold text-xs cursor-pointer transition-all">
                  <FolderOpen className="w-4 h-4" />
                  <span>{selectedFileName ? `Selected: ${selectedFileName}` : "Browse Local Movie File (.mp4, .mkv, .webm)"}</span>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleLocalFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Option 3: Direct Video URL */}
              <div className="pt-2 border-t border-white/10">
                <label className="block text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1">
                  Direct Web Video URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customUrlInput}
                    onChange={(e) => setCustomUrlInput(e.target.value)}
                    placeholder="https://example.com/video.mp4"
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={() => handleApplyCustomUrl()}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white transition-all shadow-md shadow-emerald-600/30"
                  >
                    Play URL
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Invite Friends */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-3xl max-w-md w-full p-6 shadow-2xl relative text-center">
            <button
              onClick={() => setShowInviteModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto mb-4">
              <Share2 className="w-6 h-6" />
            </div>

            <h2 className="text-xl font-bold text-white mb-1">Invite Friends</h2>
            <p className="text-xs text-slate-400 mb-6">
              Anyone with this link or code can join immediately on iPhone, Android, or PC.
            </p>

            <div className="bg-black/50 border border-white/10 rounded-2xl p-4 mb-4">
              <p className="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Room Code</p>
              <p className="text-2xl font-black font-mono tracking-widest text-indigo-400">{roomId}</p>
            </div>

            <div className="space-y-3">
              <button
                onClick={copyInviteLink}
                className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/30"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? "Link Copied!" : "Copy Invite Link"}</span>
              </button>

              <button
                onClick={shareViaWhatsApp}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-600/30"
              >
                <span>Share via WhatsApp</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
