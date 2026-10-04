"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Film, Play, Users, Sparkles, Plus, ArrowRight, Share2, Smartphone, Monitor, Video, ShieldCheck, Heart } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [roomName, setRoomName] = useState("Movie Night 🍿");
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [recentRooms, setRecentRooms] = useState<{ id: string; name: string; date: string }[]>([]);
  const [showPwaBanner, setShowPwaBanner] = useState(false);

  useEffect(() => {
    // Load stored user info
    const savedName = localStorage.getItem("ourscreen_username");
    if (savedName) setUserName(savedName);

    try {
      const savedRooms = JSON.parse(localStorage.getItem("ourscreen_recents") || "[]");
      setRecentRooms(savedRooms);
    } catch {
      // ignore
    }

    // Detect if running as standalone PWA
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as unknown as { standalone?: boolean }).standalone;
    if (!isStandalone) {
      setShowPwaBanner(true);
    }
  }, []);

  const generateRoomId = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalUserName = userName.trim() || `User_${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem("ourscreen_username", finalUserName);

    setIsCreating(true);
    setErrorMsg("");

    const newRoomId = generateRoomId();
    const userId = "usr_" + Math.random().toString(36).substring(2, 9);
    localStorage.setItem("ourscreen_userid", userId);

    try {
      const { error } = await supabase.from("watch_rooms").insert([
        {
          id: newRoomId,
          name: roomName.trim() || "Movie Night",
          host_id: userId,
          video_source_type: "sample",
          video_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          video_title: "Big Buck Bunny (Sample)",
          playback_position: 0,
          is_playing: false,
        },
      ]);

      if (error) {
        console.error("Supabase insert error:", error);
        // If table doesn't exist or error, navigate anyway as Realtime channel operates independently
      }

      // Save to recents
      const updatedRecents = [
        { id: newRoomId, name: roomName.trim() || "Movie Night", date: new Date().toLocaleDateString() },
        ...recentRooms.filter((r) => r.id !== newRoomId),
      ].slice(0, 5);
      localStorage.setItem("ourscreen_recents", JSON.stringify(updatedRecents));

      router.push(`/room/${newRoomId}`);
    } catch (err: unknown) {
      console.error("Create room error:", err);
      // Fallback: router push to room anyway
      router.push(`/room/${newRoomId}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = joinCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cleanCode) {
      setErrorMsg("Please enter a valid 6-character room code.");
      return;
    }

    const finalUserName = userName.trim() || `User_${Math.floor(Math.random() * 900 + 100)}`;
    localStorage.setItem("ourscreen_username", finalUserName);

    setIsJoining(true);
    setErrorMsg("");

    // Save to recents
    const updatedRecents = [
      { id: cleanCode, name: `Room #${cleanCode}`, date: new Date().toLocaleDateString() },
      ...recentRooms.filter((r) => r.id !== cleanCode),
    ].slice(0, 5);
    localStorage.setItem("ourscreen_recents", JSON.stringify(updatedRecents));

    router.push(`/room/${cleanCode}`);
  };

  return (
    <main className="min-h-screen flex flex-col justify-between bg-gradient-to-b from-[#090d16] via-[#0f172a] to-[#090d16] text-white">
      {/* Top Navbar */}
      <header className="border-b border-white/5 bg-[#090d16]/80 backdrop-blur-md sticky top-0 z-50 px-4 lg:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Film className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              OurScreen
            </span>
            <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              v2.0
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Realtime Sync Active
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="max-w-5xl mx-auto w-full px-4 pt-8 pb-16 flex-1 flex flex-col justify-center">
        {/* PWA / Mobile Notice Banner */}
        {showPwaBanner && (
          <div className="mb-8 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-indigo-950/60 to-purple-950/40 border border-indigo-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs sm:text-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-slate-200">Watch seamlessly across iPhone, Android, Mac & Windows</p>
                <p className="text-slate-400 text-xs">On iOS Safari: Tap <span className="text-indigo-300 font-medium">Share</span> &gt; <span className="text-indigo-300 font-medium">Add to Home Screen</span> for the full cinema app experience.</p>
              </div>
            </div>
            <button
              onClick={() => setShowPwaBanner(false)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-4">
            <Sparkles className="w-3.5 h-3.5" /> Synchronized Cinema Platform
          </div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight mb-4">
            Watch movies together <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-indigo-400 via-pink-400 to-amber-300 bg-clip-text text-transparent">
              in perfect sync anywhere.
            </span>
          </h1>
          <p className="text-sm sm:text-base text-slate-400">
            Zero delays. Watch online video links or local movie files together with built-in FaceTime-style video call and live reactions.
          </p>
        </div>

        {/* Action Cards: Create & Join */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto w-full">
          {/* Create Room Card */}
          <div className="bg-surface/80 border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl hover:border-indigo-500/40 transition-all shadow-xl shadow-black/40 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-5">
                <Plus className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Create a Watch Room</h2>
              <p className="text-xs sm:text-sm text-slate-400 mb-6">
                Start a private cinema room, invite your friends with a short link, and control playback together.
              </p>

              <form onSubmit={handleCreateRoom} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Your Nickname</label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="e.g. Alex"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Room Name</label>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="e.g. Friday Movie Night"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full mt-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-semibold text-sm shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isCreating ? (
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <>
                      Create Room Now <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Join Room Card */}
          <div className="bg-surface/80 border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl hover:border-pink-500/40 transition-all shadow-xl shadow-black/40 flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 mb-5">
                <Users className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Join with Code</h2>
              <p className="text-xs sm:text-sm text-slate-400 mb-6">
                Have an invite code from a friend? Enter it below to jump straight into their movie room.
              </p>

              <form onSubmit={handleJoinRoom} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Your Nickname</label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="e.g. Sam"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">6-Character Room Code</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="e.g. AB12CD"
                    className="w-full uppercase tracking-widest font-mono text-center bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-lg font-bold text-white placeholder-slate-600 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                  />
                </div>

                {errorMsg && <p className="text-xs text-rose-400 font-medium">{errorMsg}</p>}

                <button
                  type="submit"
                  disabled={isJoining}
                  className="w-full mt-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-600 hover:to-rose-700 text-white font-semibold text-sm shadow-lg shadow-pink-500/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isJoining ? (
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <>
                      Join Watch Room <Play className="w-4 h-4 fill-white" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Recent Rooms */}
        {recentRooms.length > 0 && (
          <div className="mt-12 max-w-4xl mx-auto w-full">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 px-1">
              Recent Rooms
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {recentRooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => router.push(`/room/${room.id}`)}
                  className="p-3.5 rounded-2xl bg-white/5 border border-white/10 hover:border-indigo-500/50 hover:bg-white/10 text-left transition-all flex items-center justify-between group"
                >
                  <div>
                    <p className="font-semibold text-sm text-slate-200 group-hover:text-white">{room.name}</p>
                    <p className="text-xs font-mono text-indigo-400">#{room.id}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-transform group-hover:translate-x-1" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feature Grid */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto w-full text-center">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col items-center">
            <Play className="w-6 h-6 text-indigo-400 mb-2" />
            <span className="font-bold text-sm text-white">Millisecond Sync</span>
            <span className="text-xs text-slate-400 mt-1">Play, pause & seek stay matched instantly</span>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col items-center">
            <Video className="w-6 h-6 text-emerald-400 mb-2" />
            <span className="font-bold text-sm text-white">FaceTime Video Call</span>
            <span className="text-xs text-slate-400 mt-1">See friends reactions while watching</span>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col items-center">
            <Monitor className="w-6 h-6 text-pink-400 mb-2" />
            <span className="font-bold text-sm text-white">All Devices</span>
            <span className="text-xs text-slate-400 mt-1">iPhone, Android, Windows, Mac, Linux</span>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col items-center">
            <Heart className="w-6 h-6 text-amber-400 mb-2" />
            <span className="font-bold text-sm text-white">Live Emoji Bursts</span>
            <span className="text-xs text-slate-400 mt-1">Tap emoji reactions floating on screen</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 py-6 px-4 text-center text-xs text-slate-500">
        <p>OurScreen • Cross-Platform Watch Together Powered by Supabase Realtime & WebRTC</p>
      </footer>
    </main>
  );
}
