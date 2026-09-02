/**
 * The information LeadFlow AI is ultimately meant to collect from a prospect
 * during a qualification conversation.
 *
 * This module only describes the *shape* of a qualified lead and the questions
 * the assistant asks. No scoring or extraction logic lives here yet — that
 * arrives in a later phase together with the real AI backend.
 */

export type LeadFieldKey =
  | "name"
  | "intent"
  | "location"
  | "budget"
  | "propertyType"
  | "bedrooms"
  | "financing"
  | "timeline";

export interface LeadField {
  key: LeadFieldKey;
  label: string;
  /** The question the assistant uses to collect this field. */
  question: string;
}

export const LEAD_FIELDS: LeadField[] = [
  {
    key: "name",
    label: "Name",
    question: "Before we start, what's your name?",
  },
  {
    key: "intent",
    label: "Intent",
    question: "Are you looking to buy or to rent?",
  },
  {
    key: "location",
    label: "Location",
    question: "Great. Which area are you interested in?",
  },
  {
    key: "budget",
    label: "Budget",
    question: "Perfect. What's your approximate budget?",
  },
  {
    key: "propertyType",
    label: "Property type",
    question: "What type of property are you after — apartment, villa, or townhouse?",
  },
  {
    key: "bedrooms",
    label: "Bedrooms",
    question: "How many bedrooms do you need?",
  },
  {
    key: "financing",
    label: "Financing",
    question: "Will this be a cash purchase or will you need financing?",
  },
  {
    key: "timeline",
    label: "Timeline",
    question: "And what's your ideal timeline for moving in?",
  },
];

/** A partially- or fully-collected lead profile. */
export type LeadProfile = Partial<Record<LeadFieldKey, string>>;
