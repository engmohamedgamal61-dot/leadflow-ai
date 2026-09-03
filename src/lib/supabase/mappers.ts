/**
 * Boundary between the database's `snake_case` rows and the app's `camelCase`
 * domain objects. Nothing outside this file needs to know a column name.
 *
 * Only the `leads` table is mapped here — it is the one that carries app domain
 * data (`custom_data` ↔ `customData`, the generic `LeadData` core, the score
 * and temperature). Pure functions, no side effects.
 */

import type { LeadData } from "@/types/chat";
import type { LeadTemperature } from "@/lib/lead-scoring";
import type {
  LeadStatus,
  LeadTemperatureRow,
  Tables,
  TablesInsert,
} from "@/lib/supabase/types";

/** App-facing shape of a persisted lead. */
export interface LeadRecord {
  id: string;
  organizationId: string;
  lead: LeadData;
  score: number;
  temperature: LeadTemperature;
  status: LeadStatus;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

const TEMPERATURE_TO_APP: Record<LeadTemperatureRow, LeadTemperature> = {
  hot: "HOT",
  warm: "WARM",
  cold: "COLD",
};

const TEMPERATURE_TO_ROW: Record<LeadTemperature, LeadTemperatureRow> = {
  HOT: "hot",
  WARM: "warm",
  COLD: "cold",
};

export function dbTemperatureToApp(value: LeadTemperatureRow): LeadTemperature {
  return TEMPERATURE_TO_APP[value] ?? "COLD";
}

export function appTemperatureToDb(value: LeadTemperature): LeadTemperatureRow {
  return TEMPERATURE_TO_ROW[value] ?? "cold";
}

function toCustomData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `leads` row → app `LeadRecord`. */
export function leadRowToRecord(row: Tables<"leads">): LeadRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    lead: {
      name: row.name ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
      intent: row.intent ?? null,
      customData: toCustomData(row.custom_data),
    },
    score: typeof row.score === "number" ? row.score : 0,
    temperature: dbTemperatureToApp(row.temperature),
    status: row.status,
    source: row.source ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface LeadWrite {
  organizationId: string;
  lead: LeadData;
  score: number;
  temperature: LeadTemperature;
  status?: LeadStatus;
  source?: string | null;
}

/** App lead → `leads` insert payload (`camelCase` → `snake_case`). */
export function leadWriteToInsert(write: LeadWrite): TablesInsert<"leads"> {
  return {
    organization_id: write.organizationId,
    name: toNullableText(write.lead.name),
    phone: toNullableText(write.lead.phone),
    email: toNullableText(write.lead.email),
    intent: toNullableText(write.lead.intent),
    custom_data: (write.lead.customData ?? {}) as TablesInsert<"leads">["custom_data"],
    score: write.score,
    temperature: appTemperatureToDb(write.temperature),
    ...(write.status ? { status: write.status } : {}),
    ...(write.source !== undefined ? { source: write.source } : {}),
  };
}
