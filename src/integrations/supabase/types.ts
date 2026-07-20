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
          is_active: boolean
          is_premium: boolean
          name: string
          preview_url: string | null
          slug: string
          sort_order: number
          style: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_premium?: boolean
          name: string
          preview_url?: string | null
          slug: string
          sort_order?: number
          style?: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_premium?: boolean
          name?: string
          preview_url?: string | null
          slug?: string
          sort_order?: number
          style?: Json
        }
        Relationships: []
      }
      clip_categories: {
        Row: {
          created_at: string
          description: string | null
          emoji: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      clips: {
        Row: {
          aspect_ratio: string
          caption_data: Json
          category_id: string | null
          created_at: string
          end_sec: number
          hook_text: string | null
          id: string
          project_id: string
          render_url: string | null
          score: number | null
          start_sec: number
          status: Database["public"]["Enums"]["clip_status"]
          template_id: string | null
          thumbnail_url: string | null
          title: string
          transcript_excerpt: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: string
          caption_data?: Json
          category_id?: string | null
          created_at?: string
          end_sec: number
          hook_text?: string | null
          id?: string
          project_id: string
          render_url?: string | null
          score?: number | null
          start_sec: number
          status?: Database["public"]["Enums"]["clip_status"]
          template_id?: string | null
          thumbnail_url?: string | null
          title: string
          transcript_excerpt?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: string
          caption_data?: Json
          category_id?: string | null
          created_at?: string
          end_sec?: number
          hook_text?: string | null
          id?: string
          project_id?: string
          render_url?: string | null
          score?: number | null
          start_sec?: number
          status?: Database["public"]["Enums"]["clip_status"]
          template_id?: string | null
          thumbnail_url?: string | null
          title?: string
          transcript_excerpt?: string | null
          updated_at?: string
          user_id?: string
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
          balance_after: number
          created_at: string
          delta: number
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["credit_kind"]
          metadata: Json
          project_id: string | null
          user_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          delta: number
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["credit_kind"]
          metadata?: Json
          project_id?: string | null
          user_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          delta?: number
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["credit_kind"]
          metadata?: Json
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
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          credits?: number
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          duration_sec: number | null
          error_message: string | null
          id: string
          language: string
          max_clip_sec: number
          metadata: Json
          min_clip_sec: number
          name: string
          progress: number
          source_type: Database["public"]["Enums"]["project_source"]
          source_url: string | null
          status: Database["public"]["Enums"]["project_status"]
          storage_path: string | null
          target_clip_count: number
          thumbnail_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          duration_sec?: number | null
          error_message?: string | null
          id?: string
          language?: string
          max_clip_sec?: number
          metadata?: Json
          min_clip_sec?: number
          name: string
          progress?: number
          source_type?: Database["public"]["Enums"]["project_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          storage_path?: string | null
          target_clip_count?: number
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          duration_sec?: number | null
          error_message?: string | null
          id?: string
          language?: string
          max_clip_sec?: number
          metadata?: Json
          min_clip_sec?: number
          name?: string
          progress?: number
          source_type?: Database["public"]["Enums"]["project_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          storage_path?: string | null
          target_clip_count?: number
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transcripts: {
        Row: {
          created_at: string
          id: string
          language: string | null
          model: string | null
          project_id: string
          raw_text: string | null
          segments: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string | null
          model?: string | null
          project_id: string
          raw_text?: string | null
          segments?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string | null
          model?: string | null
          project_id?: string
          raw_text?: string | null
          segments?: Json
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
      clip_status:
        | "suggested"
        | "approved"
        | "rejected"
        | "rendering"
        | "rendered"
        | "failed"
      credit_kind: "grant" | "consume" | "refund" | "purchase" | "adjustment"
      project_source: "upload" | "youtube"
      project_status:
        | "draft"
        | "uploading"
        | "uploaded"
        | "transcribing"
        | "analyzing"
        | "generating_clips"
        | "ready"
        | "rendering"
        | "completed"
        | "failed"
        | "canceled"
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
      clip_status: [
        "suggested",
        "approved",
        "rejected",
        "rendering",
        "rendered",
        "failed",
      ],
      credit_kind: ["grant", "consume", "refund", "purchase", "adjustment"],
      project_source: ["upload", "youtube"],
      project_status: [
        "draft",
        "uploading",
        "uploaded",
        "transcribing",
        "analyzing",
        "generating_clips",
        "ready",
        "rendering",
        "completed",
        "failed",
        "canceled",
      ],
    },
  },
} as const
