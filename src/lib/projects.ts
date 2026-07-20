import { supabase } from "@/integrations/supabase/client";
import { queryOptions } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type Clip = Database["public"]["Tables"]["clips"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type CreditTransaction =
  Database["public"]["Tables"]["credit_transactions"]["Row"];
export type Transcript = Database["public"]["Tables"]["transcripts"]["Row"];

export type TranscriptSegment = { text: string; start: number; end: number };

export const clipQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["clip", id],
    queryFn: async (): Promise<Clip | null> => {
      const { data, error } = await supabase
        .from("clips")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const transcriptQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["transcript", projectId],
    queryFn: async (): Promise<Transcript | null> => {
      const { data, error } = await supabase
        .from("transcripts")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: ["projects"],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const projectQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id],
    queryFn: async (): Promise<Project | null> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const projectClipsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id, "clips"],
    queryFn: async (): Promise<Clip[]> => {
      const { data, error } = await supabase
        .from("clips")
        .select("*")
        .eq("project_id", id)
        .order("virality_score", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

export const profileQueryOptions = () =>
  queryOptions({
    queryKey: ["profile"],
    queryFn: async (): Promise<Profile | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const dashboardStatsQueryOptions = () =>
  queryOptions({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [projectsRes, clipsRes] = await Promise.all([
        supabase.from("projects").select("id,status", { count: "exact" }),
        supabase.from("clips").select("id,virality_score", { count: "exact" }),
      ]);
      if (projectsRes.error) throw projectsRes.error;
      if (clipsRes.error) throw clipsRes.error;
      const projects = projectsRes.data ?? [];
      const clips = clipsRes.data ?? [];
      const activeStatuses: Array<Database["public"]["Enums"]["project_status"]> = [
        "transcribing",
        "analyzing",
        "uploading",
      ];
      const active = projects.filter((p) => activeStatuses.includes(p.status)).length;
      const avgVirality =
        clips.length > 0
          ? Math.round(
              clips.reduce((s, c) => s + (c.virality_score ?? 0), 0) /
                clips.length,
            )
          : 0;
      return {
        totalProjects: projects.length,
        active,
        totalClips: clips.length,
        avgVirality,
      };
    },
  });

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 4) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}
