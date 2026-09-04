/**
 * Database types for the LeadFlow AI Supabase schema.
 *
 * Hand-written to match `supabase/migrations/*.sql` and shaped like the output
 * of `supabase gen types typescript`, so it can be regenerated later without
 * touching call sites. Keep `snake_case` here — the app-facing `camelCase`
 * mapping lives in `mappers.ts`.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type OrganizationStatus = "active" | "suspended" | "archived";
export type OrganizationMemberRole =
  | "owner"
  | "admin"
  | "manager"
  | "sales"
  | "viewer";
export type LeadTemperatureRow = "hot" | "warm" | "cold";
export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "appointment"
  | "won"
  | "lost"
  | "archived";
export type ConversationStatus = "active" | "closed" | "archived";
export type MessageRole = "user" | "assistant" | "system";
export type FollowUpStatus = "pending" | "completed" | "cancelled";

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          industry_template_id: string;
          status: OrganizationStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          industry_template_id: string;
          status?: OrganizationStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          industry_template_id?: string;
          status?: OrganizationStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: OrganizationMemberRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: OrganizationMemberRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          role?: OrganizationMemberRole;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_configs: {
        Row: {
          id: string;
          organization_id: string;
          config: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          config?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          config?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_configs_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          id: string;
          organization_id: string;
          name: string | null;
          phone: string | null;
          email: string | null;
          intent: string | null;
          custom_data: Json;
          score: number;
          temperature: LeadTemperatureRow;
          status: LeadStatus;
          source: string | null;
          creation_request_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name?: string | null;
          phone?: string | null;
          email?: string | null;
          intent?: string | null;
          custom_data?: Json;
          score?: number;
          temperature?: LeadTemperatureRow;
          status?: LeadStatus;
          source?: string | null;
          creation_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string | null;
          phone?: string | null;
          email?: string | null;
          intent?: string | null;
          custom_data?: Json;
          score?: number;
          temperature?: LeadTemperatureRow;
          status?: LeadStatus;
          source?: string | null;
          creation_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          channel: string;
          status: ConversationStatus;
          started_at: string;
          last_message_at: string;
          creation_request_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          channel?: string;
          status?: ConversationStatus;
          started_at?: string;
          last_message_at?: string;
          creation_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          channel?: string;
          status?: ConversationStatus;
          started_at?: string;
          last_message_at?: string;
          creation_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_lead_id_fkey";
            columns: ["lead_id"];
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: MessageRole;
          content: string;
          metadata: Json;
          request_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: MessageRole;
          content: string;
          metadata?: Json;
          request_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: MessageRole;
          content?: string;
          metadata?: Json;
          request_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_events: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          event_type: string;
          metadata: Json;
          request_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          event_type: string;
          metadata?: Json;
          request_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          event_type?: string;
          metadata?: Json;
          request_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lead_events_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_events_lead_id_fkey";
            columns: ["lead_id"];
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_follow_ups: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          conversation_id: string | null;
          scheduled_at: string;
          status: FollowUpStatus;
          note: string | null;
          source: string;
          creation_request_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          conversation_id?: string | null;
          scheduled_at: string;
          status?: FollowUpStatus;
          note?: string | null;
          source?: string;
          creation_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          conversation_id?: string | null;
          scheduled_at?: string;
          status?: FollowUpStatus;
          note?: string | null;
          source?: string;
          creation_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lead_follow_ups_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_follow_ups_lead_id_fkey";
            columns: ["lead_id"];
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_follow_ups_conversation_id_fkey";
            columns: ["conversation_id"];
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      /**
       * Onboarding bootstrap: atomically create an organization, the calling
       * user's `owner` membership, and an empty `organization_configs` row.
       * The owner is always `auth.uid()`; refuses if the caller already
       * belongs to an organization. See
       * `20260904140000_auth_onboarding.sql`.
       */
      create_organization_with_owner: {
        Args: { p_name: string; p_industry_template_id: string };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
    };
    Enums: {
      organization_status: OrganizationStatus;
      organization_member_role: OrganizationMemberRole;
      lead_temperature: LeadTemperatureRow;
      lead_status: LeadStatus;
      conversation_status: ConversationStatus;
      message_role: MessageRole;
      follow_up_status: FollowUpStatus;
    };
    CompositeTypes: Record<never, never>;
  };
}

// Convenience aliases for call sites.
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
