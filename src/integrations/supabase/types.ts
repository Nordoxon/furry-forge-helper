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
      agent_tokens: {
        Row: {
          created_at: string
          id: string
          label: string
          last_seen_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          last_seen_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_seen_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      characters: {
        Row: {
          base_tags: string[]
          created_at: string
          description_template: string
          gallery_folder: string
          gen_batch_count: number
          gen_cfg: number
          gen_height: number
          gen_sampler: string
          gen_steps: number
          gen_style: string
          gen_width: number
          generation_enabled: boolean
          id: string
          is_default: boolean
          is_mature: boolean
          name: string
          negative_prompt: string
          notes: string
          nsfw_prompt: string
          nsfw_target: number
          preview_target: number
          prompt_approved: boolean
          sfw_prompt: string
          sfw_target: number
          species: string
          title_template: string
          user_id: string
        }
        Insert: {
          base_tags?: string[]
          created_at?: string
          description_template?: string
          gallery_folder?: string
          gen_batch_count?: number
          gen_cfg?: number
          gen_height?: number
          gen_sampler?: string
          gen_steps?: number
          gen_style?: string
          gen_width?: number
          generation_enabled?: boolean
          id?: string
          is_default?: boolean
          is_mature?: boolean
          name: string
          negative_prompt?: string
          notes?: string
          nsfw_prompt?: string
          nsfw_target?: number
          preview_target?: number
          prompt_approved?: boolean
          sfw_prompt?: string
          sfw_target?: number
          species?: string
          title_template?: string
          user_id: string
        }
        Update: {
          base_tags?: string[]
          created_at?: string
          description_template?: string
          gallery_folder?: string
          gen_batch_count?: number
          gen_cfg?: number
          gen_height?: number
          gen_sampler?: string
          gen_steps?: number
          gen_style?: string
          gen_width?: number
          generation_enabled?: boolean
          id?: string
          is_default?: boolean
          is_mature?: boolean
          name?: string
          negative_prompt?: string
          notes?: string
          nsfw_prompt?: string
          nsfw_target?: number
          preview_target?: number
          prompt_approved?: boolean
          sfw_prompt?: string
          sfw_target?: number
          species?: string
          title_template?: string
          user_id?: string
        }
        Relationships: []
      }
      images: {
        Row: {
          asset_name: string | null
          character_id: string | null
          content_kind: string
          created_at: string
          description: string
          deviation_url: string | null
          error: string | null
          filename: string
          gallery_folder: string | null
          height: number | null
          id: string
          is_cover: boolean
          is_preview: boolean
          local_path: string
          pack_id: string | null
          preview_path: string | null
          seq: number
          status: Database["public"]["Enums"]["image_status"]
          tags: string[]
          template_id: string | null
          title: string
          updated_at: string
          user_id: string
          width: number | null
        }
        Insert: {
          asset_name?: string | null
          character_id?: string | null
          content_kind?: string
          created_at?: string
          description?: string
          deviation_url?: string | null
          error?: string | null
          filename: string
          gallery_folder?: string | null
          height?: number | null
          id?: string
          is_cover?: boolean
          is_preview?: boolean
          local_path: string
          pack_id?: string | null
          preview_path?: string | null
          seq?: number
          status?: Database["public"]["Enums"]["image_status"]
          tags?: string[]
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
          width?: number | null
        }
        Update: {
          asset_name?: string | null
          character_id?: string | null
          content_kind?: string
          created_at?: string
          description?: string
          deviation_url?: string | null
          error?: string | null
          filename?: string
          gallery_folder?: string | null
          height?: number | null
          id?: string
          is_cover?: boolean
          is_preview?: boolean
          local_path?: string
          pack_id?: string | null
          preview_path?: string | null
          seq?: number
          status?: Database["public"]["Enums"]["image_status"]
          tags?: string[]
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "images_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "publish_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      packs: {
        Row: {
          character_id: string | null
          created_at: string
          id: string
          nsfw_count: number
          pack_number: number | null
          sfw_count: number
          status: string
          title: string
          updated_at: string
          user_id: string
          zip_path: string | null
          zip_url: string | null
        }
        Insert: {
          character_id?: string | null
          created_at?: string
          id?: string
          nsfw_count?: number
          pack_number?: number | null
          sfw_count?: number
          status?: string
          title?: string
          updated_at?: string
          user_id: string
          zip_path?: string | null
          zip_url?: string | null
        }
        Update: {
          character_id?: string | null
          created_at?: string
          id?: string
          nsfw_count?: number
          pack_number?: number | null
          sfw_count?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          zip_path?: string | null
          zip_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packs_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_templates: {
        Row: {
          add_watermark: boolean
          allow_comments: boolean
          allow_free_download: boolean
          auto_publish: boolean
          category_path: string
          created_at: string
          description_template: string
          display_resolution: number
          download_price: number
          exclusive_price: number
          gallery_folder: string
          id: string
          is_ai_generated: boolean
          is_default: boolean
          is_downloadable: boolean
          is_exclusive: boolean
          is_mature: boolean
          license_cc: boolean
          license_commercial: boolean
          license_modify: string
          mature_classification: string[]
          mature_level: string
          name: string
          noai: boolean
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          add_watermark?: boolean
          allow_comments?: boolean
          allow_free_download?: boolean
          auto_publish?: boolean
          category_path?: string
          created_at?: string
          description_template?: string
          display_resolution?: number
          download_price?: number
          exclusive_price?: number
          gallery_folder?: string
          id?: string
          is_ai_generated?: boolean
          is_default?: boolean
          is_downloadable?: boolean
          is_exclusive?: boolean
          is_mature?: boolean
          license_cc?: boolean
          license_commercial?: boolean
          license_modify?: string
          mature_classification?: string[]
          mature_level?: string
          name: string
          noai?: boolean
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          add_watermark?: boolean
          allow_comments?: boolean
          allow_free_download?: boolean
          auto_publish?: boolean
          category_path?: string
          created_at?: string
          description_template?: string
          display_resolution?: number
          download_price?: number
          exclusive_price?: number
          gallery_folder?: string
          id?: string
          is_ai_generated?: boolean
          is_default?: boolean
          is_downloadable?: boolean
          is_exclusive?: boolean
          is_mature?: boolean
          license_cc?: boolean
          license_commercial?: boolean
          license_modify?: string
          mature_classification?: string[]
          mature_level?: string
          name?: string
          noai?: boolean
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      image_status:
        | "new"
        | "approved"
        | "rejected"
        | "upscaling"
        | "uploading"
        | "published"
        | "error"
        | "ready"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      image_status: [
        "new",
        "approved",
        "rejected",
        "upscaling",
        "uploading",
        "published",
        "error",
        "ready",
      ],
    },
  },
} as const
