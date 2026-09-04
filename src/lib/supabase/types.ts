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
export type FollowUpStatus =
  | "pending"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed";
export type AppointmentStatus =
  | "scheduled"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "no_show";

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
          last_inbound_at: string | null;
          external_contact_id: string | null;
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
          last_inbound_at?: string | null;
          external_contact_id?: string | null;
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
          last_inbound_at?: string | null;
          external_contact_id?: string | null;
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
          channel: string;
          provider: string | null;
          provider_message_id: string | null;
          delivery_status: string | null;
          provider_metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          role: MessageRole;
          content: string;
          metadata?: Json;
          request_id?: string | null;
          channel?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          delivery_status?: string | null;
          provider_metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: MessageRole;
          content?: string;
          metadata?: Json;
          request_id?: string | null;
          channel?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          delivery_status?: string | null;
          provider_metadata?: Json | null;
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
          channel: string;
          creation_request_id: string | null;
          attempt_count: number;
          last_attempt_at: string | null;
          last_error: string | null;
          next_attempt_at: string | null;
          claimed_at: string | null;
          completed_at: string | null;
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
          channel?: string;
          creation_request_id?: string | null;
          attempt_count?: number;
          last_attempt_at?: string | null;
          last_error?: string | null;
          next_attempt_at?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
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
          channel?: string;
          creation_request_id?: string | null;
          attempt_count?: number;
          last_attempt_at?: string | null;
          last_error?: string | null;
          next_attempt_at?: string | null;
          claimed_at?: string | null;
          completed_at?: string | null;
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
      whatsapp_connections: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          phone_number_id: string;
          waba_id: string | null;
          display_phone_number: string | null;
          status: string;
          access_token_encrypted: string | null;
          last_error: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider?: string;
          phone_number_id: string;
          waba_id?: string | null;
          display_phone_number?: string | null;
          status?: string;
          access_token_encrypted?: string | null;
          last_error?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: string;
          phone_number_id?: string;
          waba_id?: string | null;
          display_phone_number?: string | null;
          status?: string;
          access_token_encrypted?: string | null;
          last_error?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_connections_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_inbound_events: {
        Row: {
          provider_message_id: string;
          organization_id: string;
          received_at: string;
        };
        Insert: {
          provider_message_id: string;
          organization_id: string;
          received_at?: string;
        };
        Update: {
          provider_message_id?: string;
          organization_id?: string;
          received_at?: string;
        };
        Relationships: [];
      };
      organization_calendar_connections: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          status: string;
          calendar_id: string | null;
          calendar_email: string | null;
          timezone: string;
          access_token_encrypted: string | null;
          refresh_token_encrypted: string | null;
          token_expires_at: string | null;
          last_error: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider?: string;
          status?: string;
          calendar_id?: string | null;
          calendar_email?: string | null;
          timezone?: string;
          access_token_encrypted?: string | null;
          refresh_token_encrypted?: string | null;
          token_expires_at?: string | null;
          last_error?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: string;
          status?: string;
          calendar_id?: string | null;
          calendar_email?: string | null;
          timezone?: string;
          access_token_encrypted?: string | null;
          refresh_token_encrypted?: string | null;
          token_expires_at?: string | null;
          last_error?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_calendar_connections_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      appointments: {
        Row: {
          id: string;
          organization_id: string;
          lead_id: string;
          conversation_id: string | null;
          calendar_connection_id: string | null;
          provider_event_id: string | null;
          starts_at: string;
          ends_at: string;
          timezone: string;
          status: string;
          source: string;
          notes: string | null;
          cancelled_reason: string | null;
          creation_request_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          lead_id: string;
          conversation_id?: string | null;
          calendar_connection_id?: string | null;
          provider_event_id?: string | null;
          starts_at: string;
          ends_at: string;
          timezone?: string;
          status?: string;
          source?: string;
          notes?: string | null;
          cancelled_reason?: string | null;
          creation_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          lead_id?: string;
          conversation_id?: string | null;
          calendar_connection_id?: string | null;
          provider_event_id?: string | null;
          starts_at?: string;
          ends_at?: string;
          timezone?: string;
          status?: string;
          source?: string;
          notes?: string | null;
          cancelled_reason?: string | null;
          creation_request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "appointments_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_lead_id_fkey";
            columns: ["lead_id"];
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_conversation_id_fkey";
            columns: ["conversation_id"];
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_calendar_connection_id_fkey";
            columns: ["calendar_connection_id"];
            referencedRelation: "organization_calendar_connections";
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
      /**
       * Follow-up scheduler claim (service-role only). Atomically moves a
       * bounded batch of due `pending` follow-ups (plus stuck `processing`
       * rows) to `processing` via `FOR UPDATE SKIP LOCKED` and returns them.
       * See `20260904160100_follow_up_scheduler.sql`.
       */
      claim_due_follow_ups: {
        Args: { p_limit: number; p_stuck_after: string };
        Returns: {
          id: string;
          organization_id: string;
          lead_id: string;
          conversation_id: string | null;
          note: string | null;
          source: string;
          channel: string;
          attempt_count: number;
          org_has_members: boolean;
          lead_name: string | null;
        }[];
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
