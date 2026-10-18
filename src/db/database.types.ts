export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      chunks: {
        Row: {
          block_end: number;
          block_start: number;
          company_id: string;
          content: string;
          document_id: string;
          embedding: string;
          fts: unknown;
          id: string;
          page: number | null;
          section: string | null;
          seq: number;
          token_count: number;
        };
        ComputedFields: never;
        Insert: {
          block_end: number;
          block_start: number;
          company_id: string;
          content: string;
          document_id: string;
          embedding: string;
          fts?: never;
          id?: string;
          page?: number | null;
          section?: string | null;
          seq: number;
          token_count: number;
        };
        Update: {
          block_end?: number;
          block_start?: number;
          company_id?: string;
          content?: string;
          document_id?: string;
          embedding?: string;
          fts?: never;
          id?: string;
          page?: number | null;
          section?: string | null;
          seq?: number;
          token_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "chunks_company_id_document_id_fkey";
            columns: ["company_id", "document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["company_id", "id"];
          },
        ];
      };
      companies: {
        Row: {
          created_at: string;
          created_by_visitor: string | null;
          expires_at: string | null;
          id: string;
          kind: Database["public"]["Enums"]["company_kind"];
          library_company_id: string | null;
          name: string;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by_visitor?: string | null;
          expires_at?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["company_kind"];
          library_company_id?: string | null;
          name: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          created_by_visitor?: string | null;
          expires_at?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["company_kind"];
          library_company_id?: string | null;
          name?: string;
          slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: "companies_library_company_id_fkey";
            columns: ["library_company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          last_activity_at: string;
          title: string;
          turn_count: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          last_activity_at?: string;
          title: string;
          turn_count?: number;
          user_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          last_activity_at?: string;
          title?: string;
          turn_count?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      document_blocks: {
        Row: {
          company_id: string;
          document_id: string;
          kind: Database["public"]["Enums"]["block_kind"];
          level: number | null;
          page: number | null;
          section: string | null;
          seq: number;
          text: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          document_id: string;
          kind: Database["public"]["Enums"]["block_kind"];
          level?: number | null;
          page?: number | null;
          section?: string | null;
          seq: number;
          text: string;
        };
        Update: {
          company_id?: string;
          document_id?: string;
          kind?: Database["public"]["Enums"]["block_kind"];
          level?: number | null;
          page?: number | null;
          section?: string | null;
          seq?: number;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_blocks_company_id_document_id_fkey";
            columns: ["company_id", "document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["company_id", "id"];
          },
        ];
      };
      documents: {
        Row: {
          block_count: number | null;
          chunk_count: number | null;
          company_id: string;
          created_at: string;
          effective_date: string | null;
          error: string | null;
          file_name: string;
          format: Database["public"]["Enums"]["document_format"];
          id: string;
          page_count: number | null;
          processed_at: string | null;
          size_bytes: number;
          status: Database["public"]["Enums"]["document_status"];
          storage_path: string;
          supersedes_id: string | null;
          title: string;
          uploaded_by: string | null;
          version_label: string | null;
        };
        ComputedFields: never;
        Insert: {
          block_count?: number | null;
          chunk_count?: number | null;
          company_id: string;
          created_at?: string;
          effective_date?: string | null;
          error?: string | null;
          file_name: string;
          format: Database["public"]["Enums"]["document_format"];
          id?: string;
          page_count?: number | null;
          processed_at?: string | null;
          size_bytes: number;
          status?: Database["public"]["Enums"]["document_status"];
          storage_path: string;
          supersedes_id?: string | null;
          title: string;
          uploaded_by?: string | null;
          version_label?: string | null;
        };
        Update: {
          block_count?: number | null;
          chunk_count?: number | null;
          company_id?: string;
          created_at?: string;
          effective_date?: string | null;
          error?: string | null;
          file_name?: string;
          format?: Database["public"]["Enums"]["document_format"];
          id?: string;
          page_count?: number | null;
          processed_at?: string | null;
          size_bytes?: number;
          status?: Database["public"]["Enums"]["document_status"];
          storage_path?: string;
          supersedes_id?: string | null;
          title?: string;
          uploaded_by?: string | null;
          version_label?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "documents_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_company_id_supersedes_id_fkey";
            columns: ["company_id", "supersedes_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["company_id", "id"];
          },
        ];
      };
      handoffs: {
        Row: {
          answer: string | null;
          answered_at: string | null;
          answered_by: string | null;
          asked_by: string;
          company_id: string;
          context: NonNullable<Json>;
          conversation_id: string;
          created_at: string;
          id: string;
          question: string;
          reason: string | null;
          status: Database["public"]["Enums"]["handoff_status"];
        };
        ComputedFields: never;
        Insert: {
          answer?: string | null;
          answered_at?: string | null;
          answered_by?: string | null;
          asked_by: string;
          company_id: string;
          context?: NonNullable<Json>;
          conversation_id: string;
          created_at?: string;
          id?: string;
          question: string;
          reason?: string | null;
          status?: Database["public"]["Enums"]["handoff_status"];
        };
        Update: {
          answer?: string | null;
          answered_at?: string | null;
          answered_by?: string | null;
          asked_by?: string;
          company_id?: string;
          context?: NonNullable<Json>;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          question?: string;
          reason?: string | null;
          status?: Database["public"]["Enums"]["handoff_status"];
        };
        Relationships: [
          {
            foreignKeyName: "handoffs_company_id_conversation_id_fkey";
            columns: ["company_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["company_id", "id"];
          },
        ];
      };
      memberships: {
        Row: {
          company_id: string;
          created_at: string;
          display_name: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          display_name: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          display_name?: string;
          role?: Database["public"]["Enums"]["member_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          content: NonNullable<Json>;
          conversation_id: string;
          created_at: string;
          role: string;
          seq: number;
        };
        ComputedFields: never;
        Insert: {
          content: NonNullable<Json>;
          conversation_id: string;
          created_at?: string;
          role: string;
          seq: number;
        };
        Update: {
          content?: NonNullable<Json>;
          conversation_id?: string;
          created_at?: string;
          role?: string;
          seq?: number;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      turns: {
        Row: {
          answer: Json | null;
          cache_read_tokens: number;
          cache_write_tokens: number;
          citation_count: number;
          company_id: string;
          conversation_id: string;
          cost_micro_usd: number;
          created_at: string;
          effort: string | null;
          embedding_tokens: number;
          first_token_ms: number | null;
          handoff_id: string | null;
          id: string;
          input_tokens: number;
          model: string;
          outcome: Database["public"]["Enums"]["turn_outcome"];
          output_tokens: number;
          question: string;
          question_embedding: string | null;
          search_count: number;
          seq: number;
          total_ms: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          answer?: Json | null;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          citation_count?: number;
          company_id: string;
          conversation_id: string;
          cost_micro_usd?: number;
          created_at?: string;
          effort?: string | null;
          embedding_tokens?: number;
          first_token_ms?: number | null;
          handoff_id?: string | null;
          id?: string;
          input_tokens?: number;
          model: string;
          outcome: Database["public"]["Enums"]["turn_outcome"];
          output_tokens?: number;
          question: string;
          question_embedding?: string | null;
          search_count?: number;
          seq: number;
          total_ms: number;
          user_id: string;
        };
        Update: {
          answer?: Json | null;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          citation_count?: number;
          company_id?: string;
          conversation_id?: string;
          cost_micro_usd?: number;
          created_at?: string;
          effort?: string | null;
          embedding_tokens?: number;
          first_token_ms?: number | null;
          handoff_id?: string | null;
          id?: string;
          input_tokens?: number;
          model?: string;
          outcome?: Database["public"]["Enums"]["turn_outcome"];
          output_tokens?: number;
          question?: string;
          question_embedding?: string | null;
          search_count?: number;
          seq?: number;
          total_ms?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "turns_company_id_conversation_id_fkey";
            columns: ["company_id", "conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["company_id", "id"];
          },
          {
            foreignKeyName: "turns_company_id_handoff_id_fkey";
            columns: ["company_id", "handoff_id"];
            isOneToOne: false;
            referencedRelation: "handoffs";
            referencedColumns: ["company_id", "id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      match_chunks: {
        Args: {
          p_candidates?: number;
          p_company_ids: string[];
          p_match_count?: number;
          p_query_embedding: string;
          p_query_text: string;
        };
        Returns: {
          block_start: number;
          blocks: Json;
          chunk_id: string;
          company_id: string;
          document_id: string;
          effective_date: string;
          format: Database["public"]["Enums"]["document_format"];
          page: number;
          score: number;
          section: string;
          superseded_by_title: string;
          supersedes_title: string;
          text_rank: number;
          title: string;
          vector_rank: number;
          version_label: string;
        }[];
      };
    };
    Enums: {
      block_kind: "heading" | "paragraph" | "list_item" | "table_row";
      company_kind: "standard" | "template" | "sandbox";
      document_format: "pdf" | "docx";
      document_status: "uploading" | "processing" | "ready" | "failed";
      handoff_status: "open" | "answered";
      member_role: "admin" | "member";
      turn_outcome: "answered" | "not_found" | "refused" | "error";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      block_kind: ["heading", "paragraph", "list_item", "table_row"],
      company_kind: ["standard", "template", "sandbox"],
      document_format: ["pdf", "docx"],
      document_status: ["uploading", "processing", "ready", "failed"],
      handoff_status: ["open", "answered"],
      member_role: ["admin", "member"],
      turn_outcome: ["answered", "not_found", "refused", "error"],
    },
  },
} as const;
