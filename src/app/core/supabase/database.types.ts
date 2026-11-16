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
      favorites: {
        Row: {
          created_at: string;
          item_id: string;
          item_type: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          item_id: string;
          item_type: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          item_id?: string;
          item_type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      pattern_rounds: {
        Row: {
          consumed: number;
          declared_total: number | null;
          id: string;
          parsed_ok: boolean;
          pattern_id: string;
          position: number;
          produced: number;
          raw: string;
          round_number: number;
        };
        ComputedFields: never;
        Insert: {
          consumed?: number;
          declared_total?: number | null;
          id?: string;
          parsed_ok: boolean;
          pattern_id: string;
          position: number;
          produced?: number;
          raw: string;
          round_number: number;
        };
        Update: {
          consumed?: number;
          declared_total?: number | null;
          id?: string;
          parsed_ok?: boolean;
          pattern_id?: string;
          position?: number;
          produced?: number;
          raw?: string;
          round_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'pattern_rounds_pattern_id_fkey';
            columns: ['pattern_id'];
            isOneToOne: false;
            referencedRelation: 'patterns';
            referencedColumns: ['id'];
          },
        ];
      };
      patterns: {
        Row: {
          attribution: string | null;
          created_at: string;
          deleted_at: string | null;
          file_mime: string | null;
          file_name: string | null;
          file_path: string | null;
          file_size: number | null;
          id: string;
          is_sample: boolean;
          level: string;
          name: string;
          name_ar: string | null;
          name_en: string | null;
          owner_id: string | null;
          raw_text: string;
          reading_position: number;
          source_type: string;
          source_url: string | null;
          terms: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attribution?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          file_mime?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          id?: string;
          is_sample?: boolean;
          level?: string;
          name: string;
          name_ar?: string | null;
          name_en?: string | null;
          owner_id?: string | null;
          raw_text?: string;
          reading_position?: number;
          source_type?: string;
          source_url?: string | null;
          terms?: string;
          updated_at?: string;
        };
        Update: {
          attribution?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          file_mime?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size?: number | null;
          id?: string;
          is_sample?: boolean;
          level?: string;
          name?: string;
          name_ar?: string | null;
          name_en?: string | null;
          owner_id?: string | null;
          raw_text?: string;
          reading_position?: number;
          source_type?: string;
          source_url?: string | null;
          terms?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          interests: string[];
          level: string;
          locale: string;
          onboarded: boolean;
          terms: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string;
          id: string;
          interests?: string[];
          level?: string;
          locale?: string;
          onboarded?: boolean;
          terms?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          interests?: string[];
          level?: string;
          locale?: string;
          onboarded?: boolean;
          terms?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_notes: {
        Row: {
          body: string;
          id: string;
          owner_id: string;
          project_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string;
          id?: string;
          owner_id: string;
          project_id: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          id?: string;
          owner_id?: string;
          project_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_notes_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: true;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      project_parts: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
          pattern_id: string | null;
          position: number;
          project_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_id: string;
          pattern_id?: string | null;
          position?: number;
          project_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_id?: string;
          pattern_id?: string | null;
          position?: number;
          project_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_parts_pattern_id_fkey';
            columns: ['pattern_id'];
            isOneToOne: false;
            referencedRelation: 'patterns';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_parts_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      project_photos: {
        Row: {
          created_at: string;
          height: number | null;
          id: string;
          is_cover: boolean;
          mime_type: string;
          owner_id: string;
          project_id: string;
          size_bytes: number;
          storage_path: string;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          height?: number | null;
          id?: string;
          is_cover?: boolean;
          mime_type: string;
          owner_id: string;
          project_id: string;
          size_bytes: number;
          storage_path: string;
          width?: number | null;
        };
        Update: {
          created_at?: string;
          height?: number | null;
          id?: string;
          is_cover?: boolean;
          mime_type?: string;
          owner_id?: string;
          project_id?: string;
          size_bytes?: number;
          storage_path?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'project_photos_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      project_progress: {
        Row: {
          action_ptr: number;
          count: number;
          count_mode: string;
          history: NonNullable<Json>;
          mode: string;
          owner_id: string;
          pattern_history: NonNullable<Json>;
          pattern_id: string | null;
          pattern_round_index: number;
          per_tap: number;
          project_id: string;
          round: number;
          target: number;
          total_rounds: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          action_ptr?: number;
          count?: number;
          count_mode?: string;
          history?: NonNullable<Json>;
          mode?: string;
          owner_id: string;
          pattern_history?: NonNullable<Json>;
          pattern_id?: string | null;
          pattern_round_index?: number;
          per_tap?: number;
          project_id: string;
          round?: number;
          target?: number;
          total_rounds?: number;
          updated_at?: string;
        };
        Update: {
          action_ptr?: number;
          count?: number;
          count_mode?: string;
          history?: NonNullable<Json>;
          mode?: string;
          owner_id?: string;
          pattern_history?: NonNullable<Json>;
          pattern_id?: string | null;
          pattern_round_index?: number;
          per_tap?: number;
          project_id?: string;
          round?: number;
          target?: number;
          total_rounds?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_progress_pattern_id_fkey';
            columns: ['pattern_id'];
            isOneToOne: false;
            referencedRelation: 'patterns';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_progress_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: true;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      projects: {
        Row: {
          category: string;
          cover_path: string | null;
          created_at: string;
          deleted_at: string | null;
          estimated_hours: number;
          hook_size: string;
          id: string;
          last_worked_at: string;
          name: string;
          owner_id: string;
          pattern_id: string | null;
          status: string;
          updated_at: string;
          worked_seconds: number;
          yarn_type: string;
        };
        ComputedFields: never;
        Insert: {
          category?: string;
          cover_path?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          estimated_hours?: number;
          hook_size?: string;
          id?: string;
          last_worked_at?: string;
          name: string;
          owner_id: string;
          pattern_id?: string | null;
          status?: string;
          updated_at?: string;
          worked_seconds?: number;
          yarn_type?: string;
        };
        Update: {
          category?: string;
          cover_path?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          estimated_hours?: number;
          hook_size?: string;
          id?: string;
          last_worked_at?: string;
          name?: string;
          owner_id?: string;
          pattern_id?: string | null;
          status?: string;
          updated_at?: string;
          worked_seconds?: number;
          yarn_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_pattern_id_fkey';
            columns: ['pattern_id'];
            isOneToOne: false;
            referencedRelation: 'patterns';
            referencedColumns: ['id'];
          },
        ];
      };
      store_interest: {
        Row: {
          created_at: string;
          email: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      tutorial_bookmarks: {
        Row: {
          creator_name: string | null;
          id: string;
          notes: string;
          project_id: string | null;
          tutorial_id: string;
          updated_at: string;
          user_id: string;
          youtube_url: string | null;
        };
        ComputedFields: never;
        Insert: {
          creator_name?: string | null;
          id?: string;
          notes?: string;
          project_id?: string | null;
          tutorial_id: string;
          updated_at?: string;
          user_id: string;
          youtube_url?: string | null;
        };
        Update: {
          creator_name?: string | null;
          id?: string;
          notes?: string;
          project_id?: string | null;
          tutorial_id?: string;
          updated_at?: string;
          user_id?: string;
          youtube_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tutorial_bookmarks_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
      tutorial_timestamps: {
        Row: {
          bookmark_id: string;
          created_at: string;
          id: string;
          note: string;
          seconds: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          bookmark_id: string;
          created_at?: string;
          id?: string;
          note?: string;
          seconds: number;
          user_id: string;
        };
        Update: {
          bookmark_id?: string;
          created_at?: string;
          id?: string;
          note?: string;
          seconds?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tutorial_timestamps_bookmark_id_fkey';
            columns: ['bookmark_id'];
            isOneToOne: false;
            referencedRelation: 'tutorial_bookmarks';
            referencedColumns: ['id'];
          },
        ];
      };
      user_tools: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          user_id: string;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          user_id: string;
          value: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          user_id?: string;
          value?: string;
        };
        Relationships: [];
      };
      work_sessions: {
        Row: {
          created_at: string;
          ended_at: string;
          id: string;
          owner_id: string;
          project_id: string;
          seconds: number;
          started_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          ended_at: string;
          id?: string;
          owner_id: string;
          project_id: string;
          seconds: number;
          started_at: string;
        };
        Update: {
          created_at?: string;
          ended_at?: string;
          id?: string;
          owner_id?: string;
          project_id?: string;
          seconds?: number;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'work_sessions_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
