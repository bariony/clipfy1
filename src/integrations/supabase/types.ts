export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      caption_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          preview_url: string | null
          slug: string
          sort_order: number | null
          style: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          preview_url?: string | null
          slug: string
          sort_order?: number | null
          style?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          preview_url?: string | null
          slug?: string
          sort_order?: number | null
          style?: Json
        }
        Relationships: []
      }
      clip_categories: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          slug: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          slug: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          slug?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      clips: {
        Row: {
          aspect_ratio: string | null
          category_id: string | null
          created_at: string
          end_seconds: number
          hook: string | null
          id: string
          metadata: Json | null
          project_id: string
          render_url: string | null
          scene_plan: Json | null
          start_seconds: number
          status: Database["public"]["Enums"]["clip_status"]
          template_id: string | null
          thumbnail_url: string | null
          title: string
          transcript_excerpt: string | null
          updated_at: string
          user_id: string
          virality_score: number | null
        }
        Insert: {
          aspect_ratio?: string | null
          category_id?: string | null
          created_at?: string
          end_seconds: number
          hook?: string | null
          id?: string
          metadata?: Json | null
          project_id: string
          render_url?: string | null
          scene_plan?: Json | null
          start_seconds: number
          status?: Database["public"]["Enums"]["clip_status"]
          template_id?: string | null
          thumbnail_url?: string | null
          title: string
          transcript_excerpt?: string | null
          updated_at?: string
          user_id: string
          virality_score?: number | null
        }
        Update: {
          aspect_ratio?: string | null
          category_id?: string | null
          created_at?: string
          end_seconds?: number
          hook?: string | null
          id?: string
          metadata?: Json | null
          project_id?: string
          render_url?: string | null
          scene_plan?: Json | null
          start_seconds?: number
          status?: Database["public"]["Enums"]["clip_status"]
          template_id?: string | null
          thumbnail_url?: string | null
          title?: string
          transcript_excerpt?: string | null
          updated_at?: string
          user_id?: string
          virality_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clips_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "clip_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clips_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clips_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "caption_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["credit_kind"]
          project_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["credit_kind"]
          project_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["credit_kind"]
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          credits: number
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          duration_seconds: number | null
          error_message: string | null
          id: string
          language: string | null
          max_clip_seconds: number | null
          min_clip_seconds: number | null
          preferences: Json
          slug: string
          source: Database["public"]["Enums"]["project_source"]
          source_url: string | null
          status: Database["public"]["Enums"]["project_status"]
          storage_path: string | null
          target_clip_count: number | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          user_id: string
          virality_bias: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          language?: string | null
          max_clip_seconds?: number | null
          min_clip_seconds?: number | null
          preferences?: Json
          slug: string
          source?: Database["public"]["Enums"]["project_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          storage_path?: string | null
          target_clip_count?: number | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          user_id: string
          virality_bias?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          language?: string | null
          max_clip_seconds?: number | null
          min_clip_seconds?: number | null
          preferences?: Json
          slug?: string
          source?: Database["public"]["Enums"]["project_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          storage_path?: string | null
          target_clip_count?: number | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          virality_bias?: number | null
        }
        Relationships: []
      }
      render_jobs: {
        Row: {
          clip_id: string
          completed_at: string | null
          created_at: string
          edl: Json
          error_message: string | null
          id: string
          output_url: string | null
          progress: number
          project_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["render_job_status"]
          thumbnail_url: string | null
          updated_at: string
          user_id: string
          worker_id: string | null
        }
        Insert: {
          clip_id: string
          completed_at?: string | null
          created_at?: string
          edl?: Json
          error_message?: string | null
          id?: string
          output_url?: string | null
          progress?: number
          project_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["render_job_status"]
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
          worker_id?: string | null
        }
        Update: {
          clip_id?: string
          completed_at?: string | null
          created_at?: string
          edl?: Json
          error_message?: string | null
          id?: string
          output_url?: string | null
          progress?: number
          project_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["render_job_status"]
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "render_jobs_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          created_at: string
          full_text: string | null
          id: string
          language: string | null
          project_id: string
          provider: string | null
          segments: Json | null
          speakers: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_text?: string | null
          id?: string
          language?: string | null
          project_id: string
          provider?: string | null
          segments?: Json | null
          speakers?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_text?: string | null
          id?: string
          language?: string | null
          project_id?: string
          provider?: string | null
          segments?: Json | null
          speakers?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_project_with_credits: {
        Args: {
          _description: string
          _estimated_cost: number
          _language: string
          _max_clip_seconds: number
          _min_clip_seconds: number
          _source: Database["public"]["Enums"]["project_source"]
          _source_url: string
          _storage_path: string
          _target_clip_count: number
          _title: string
        }
        Returns: {
          created_at: string
          description: string | null
          duration_seconds: number | null
          error_message: string | null
          id: string
          language: string | null
          max_clip_seconds: number | null
          min_clip_seconds: number | null
          preferences: Json
          slug: string
          source: Database["public"]["Enums"]["project_source"]
          source_url: string | null
          status: Database["public"]["Enums"]["project_status"]
          storage_path: string | null
          target_clip_count: number | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          user_id: string
          virality_bias: number | null
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_project_slug: { Args: { _title: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      clip_status: "suggested" | "rendering" | "ready" | "failed" | "discarded"
      credit_kind:
        | "bonus"
        | "purchase"
        | "consumption"
        | "refund"
        | "adjustment"
      project_source: "upload" | "youtube" | "url"
      project_status:
        | "draft"
        | "uploading"
        | "transcribing"
        | "analyzing"
        | "ready"
        | "failed"
        | "archived"
      render_job_status:
        | "queued"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      clip_status: ["suggested", "rendering", "ready", "failed", "discarded"],
      credit_kind: ["bonus", "purchase", "consumption", "refund", "adjustment"],
      project_source: ["upload", "youtube", "url"],
      project_status: [
        "draft",
        "uploading",
        "transcribing",
        "analyzing",
        "ready",
        "failed",
        "archived",
      ],
      render_job_status: [
        "queued",
        "processing",
        "completed",
        "failed",
        "cancelled",
      ],
    },
  },
} as const
