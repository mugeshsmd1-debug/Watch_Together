import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://thjfjhekmqwgtypbhlar.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoamZqaGVrbXF3Z3R5cGJobGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3Njg5OTEsImV4cCI6MjEwNjM0NDk5MX0.pPUJAzMJyPOpVcliiadgCeFWaS-vZOGJWlN0YjUCEa0";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 15,
    },
  },
});

export interface WatchRoom {
  id: string;
  name: string;
  host_id: string;
  video_source_type: "sample" | "url" | "local_sync" | "stream";
  video_url: string | null;
  video_title: string | null;
  playback_position: number;
  is_playing: boolean;
  last_sync_at: string;
  created_at: string;
  updated_at: string;
}

export interface WatchMessage {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
}
