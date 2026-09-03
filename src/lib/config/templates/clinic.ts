import type { IndustryTemplate } from "../types.ts";

/**
 * Clinic — a proof-of-architecture industry template.
 *
 * It exists to demonstrate that the same AI / extraction / normalization /
 * scoring engine handles a completely different industry with zero engine
 * changes: only this data file and a registry entry.
 *
 * This is a **lead-intake** assistant, not a medical product — it collects
 * inquiry details and never diagnoses or gives medical advice.
 */
export const clinicTemplate: IndustryTemplate = {
  id: "template_clinic",
  name: "Clinic",
  slug: "clinic",
  description:
    "Collect a patient's appointment inquiry: service, preferred doctor, date, insurance and urgency.",

  leadFields: [
    {
      key: "name",
      label: "Name",
      type: "text",
      required: true,
      enabled: true,
      order: 10,
      description: "The patient's name.",
      extractionHint: "The patient's name, as they gave it. Keep the original script.",
    },
    {
      key: "phone",
      label: "Phone",
      type: "text",
      required: false,
      enabled: true,
      order: 20,
      description: "A contact phone number, digits only where possible.",
      extractionHint:
        "Phone number as digits (keep a leading + for country code). null if not given.",
    },
    {
      key: "service",
      label: "Service",
      type: "text",
      required: true,
      enabled: true,
      order: 30,
      description: "The treatment or service the patient is asking about.",
      extractionHint:
        'The service / treatment requested, e.g. "Dental Cleaning", "Physiotherapy", "Dermatology consultation". Keep the patient\'s wording, capitalized.',
    },
    {
      key: "doctor",
      label: "Doctor",
      type: "text",
      required: false,
      enabled: true,
      order: 40,
      description: "A specific doctor the patient wants to see, if any.",
      extractionHint:
        'The name of a specific doctor the patient asked for, e.g. "Dr. Ahmed". null if they have no preference.',
    },
    {
      key: "appointment_date",
      label: "Appointment date",
      type: "date",
      required: true,
      enabled: true,
      order: 50,
      description: "The patient's preferred appointment date or timeframe.",
      extractionHint:
        'Preferred date or timeframe, as an ISO date ("2026-09-10") when a specific day is given, otherwise a short phrase ("tomorrow", "next week"). null if not given.',
    },
    {
      key: "insurance",
      label: "Insurance",
      type: "boolean",
      required: false,
      enabled: true,
      order: 60,
      description: "Whether the patient has medical insurance.",
      extractionHint:
        "true if the patient says they have insurance, false if they will pay out of pocket. null if not mentioned.",
    },
    {
      key: "urgency",
      label: "Urgency",
      type: "select",
      required: false,
      enabled: true,
      order: 70,
      description: "How urgent the patient's need is.",
      options: [
        { value: "high", label: "High", aliases: ["urgent", "emergency", "asap", "عاجل", "طارئ"] },
        { value: "medium", label: "Medium", aliases: ["soon", "moderate"] },
        { value: "low", label: "Low", aliases: ["routine", "whenever", "not urgent", "روتيني"] },
      ],
      extractionHint:
        'One of "high", "medium" or "low" based on how the patient describes their need. null if unclear.',
    },
  ],

  qualificationFlow: [
    { fieldKey: "name", order: 10, required: true, questionHint: "the patient's name" },
    { fieldKey: "service", order: 20, required: true, questionHint: "which service or treatment they need" },
    { fieldKey: "doctor", order: 30, required: false, questionHint: "whether they want a specific doctor" },
    { fieldKey: "appointment_date", order: 40, required: true, questionHint: "their preferred appointment date or timeframe" },
    { fieldKey: "insurance", order: 50, required: false, questionHint: "whether they have medical insurance" },
    { fieldKey: "urgency", order: 60, required: false, questionHint: "how urgent their need is" },
  ],

  // Deterministic. Total max = 100.
  scoring: {
    rules: [
      { kind: "presence", fieldKey: "service", maxPoints: 20, points: 20, whenMissing: 0 },
      { kind: "presence", fieldKey: "doctor", maxPoints: 15, points: 15, whenMissing: 0 },
      {
        kind: "presence",
        fieldKey: "appointment_date",
        maxPoints: 25,
        points: 25,
        whenMissing: 0,
      },
      {
        kind: "boolean",
        fieldKey: "insurance",
        maxPoints: 15,
        whenTrue: 15,
        whenFalse: 5,
        whenMissing: 0,
      },
      {
        kind: "match",
        fieldKey: "urgency",
        maxPoints: 25,
        cases: { high: 25, medium: 15, low: 5 },
        whenMissing: 0,
      },
    ],
    thresholds: { hot: 80, warm: 50 },
  },

  aiBehavior: {
    persona: "a professional, friendly clinic intake assistant",
    goal: "collect a patient's appointment inquiry details and qualify the request",
    tone: "professional, warm and reassuring; no exclamation overload and no emoji",
    style: "talk like a helpful receptionist, one question at a time — not a form",
    languages: [
      "Arabic (Modern Standard and Gulf dialect)",
      "English",
    ],
    rules: [
      "Ask about exactly ONE missing detail per message — never bundle two questions together.",
      "Briefly acknowledge what the patient said before asking the next thing.",
      "Keep every message short: one or two sentences.",
      "Detect the patient's language and reply in that same language.",
      "You are an intake assistant, NOT a medical professional. Never diagnose a condition and never give medical advice.",
      "Never invent doctor names, specialties, prices, or availability.",
      "Never confirm or promise an appointment slot — the clinic team confirms all bookings.",
      "If the patient describes a medical emergency or severe symptoms, tell them to call emergency services or go to the nearest emergency room, and stop the qualification.",
      "Once you have a reasonable picture, thank the patient and let them know the clinic team will follow up to confirm.",
    ],
    domainContext:
      "This is a lead-intake conversation for a medical clinic, not a medical consultation.",
  },
};
