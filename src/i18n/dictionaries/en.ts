/**
 * English dictionary — the source of truth for LeadFlow AI's UI copy.
 *
 * `Dictionary` (its `typeof`) is the shape every other locale must satisfy, so
 * a missing or misspelled key in `ar.ts` is a compile error. Keys are semantic,
 * never the English string itself.
 */

export const en = {
  common: {
    save: "Save",
    saveChanges: "Save changes",
    saving: "Saving…",
    cancel: "Cancel",
    clear: "Clear",
    retry: "Retry",
    loading: "Loading…",
    done: "Done.",
    back: "Back",
    next: "Next",
    previous: "Previous",
    yes: "Yes",
    no: "No",
    emptyValue: "—",
    optional: "optional",
    all: "All",
    viewAll: "View all",
    unnamedLead: "Unnamed lead",
    noContact: "no contact",
  },

  languageSwitcher: {
    label: "Language",
    english: "English",
    arabic: "العربية",
  },

  brand: {
    name: "LeadFlow AI",
    initials: "LF",
  },

  meta: {
    appTitle: "LeadFlow AI — AI-powered lead qualification and sales automation",
    appDescription: "AI-powered lead qualification and sales automation",
    overview: "Overview — LeadFlow AI",
    leads: "Leads — LeadFlow AI",
    lead: "Lead — LeadFlow AI",
    recovery: "Revenue Recovery — LeadFlow AI",
    aiAgent: "AI agent — LeadFlow AI",
    integrations: "Integrations — LeadFlow AI",
    signIn: "Sign in — LeadFlow AI",
    createAccount: "Create account — LeadFlow AI",
    onboarding: "Set up your organization — LeadFlow AI",
  },

  navigation: {
    overview: "Overview",
    dashboard: "Dashboard",
    leads: "Leads",
    recovery: "Recovery",
    aiAgent: "AI agent",
    integrations: "Integrations",
    settings: "Settings",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },

  auth: {
    emailLabel: "Email",
    passwordLabel: "Password",
    emailPlaceholder: "you@company.com",
    passwordPlaceholder: "••••••••",
    fixHighlighted: "Please fix the highlighted fields.",
    signOut: "Sign out",
    signingOut: "Signing out…",
    login: {
      title: "Welcome back",
      subtitle: "Sign in to your LeadFlow AI workspace.",
      footerText: "New to LeadFlow?",
      footerLink: "Create an account",
      submit: "Sign in",
      submitting: "Signing in…",
    },
    signup: {
      title: "Create your account",
      subtitle: "Start qualifying leads with AI in minutes.",
      footerText: "Already have an account?",
      footerLink: "Sign in",
      submit: "Create account",
      submitting: "Creating account…",
      passwordHint: "At least {min} characters.",
      checkEmail:
        "Check your email for a confirmation link, then sign in to continue.",
    },
    errors: {
      invalidCredentials: "Incorrect email or password.",
      emailExists:
        "An account with that email already exists. Try signing in.",
      emailNotConfirmed:
        "Please confirm your email address before signing in.",
      rateLimited: "Too many attempts. Please wait a moment and try again.",
      weakPassword: "That password is not allowed. Choose a stronger one.",
      generic: "Authentication failed. Please try again.",
    },
  },

  onboarding: {
    title: "Set up your organization",
    subtitle:
      "This picks the AI qualification template your workspace starts from. You can fine-tune it later.",
    signedInAs: "Signed in as {email}",
    orgNameLabel: "Organization name",
    orgNamePlaceholder: "Acme Realty",
    industryLabel: "Industry template",
    submit: "Create organization",
    submitting: "Creating organization…",
    errors: {
      alreadyMember: "You already have an organization.",
      createFailed:
        "That organization could not be created. Please try again.",
      sessionExpired: "Your session has expired. Please sign in again.",
      invalidDetails:
        "Please check the organization details and try again.",
      generic:
        "Something went wrong creating your organization. Please try again.",
    },
  },

  dashboard: {
    overviewEyebrow: "Overview",
    workspace: "{template} workspace",
    stats: {
      totalLeads: "Total leads",
      hot: "Hot",
      warm: "Warm",
      cold: "Cold",
      qualified: "Qualified",
      conversion: "Conversion",
    },
    workload: {
      pendingFollowUps: "Pending follow-ups",
      dueNow: "Due now",
      failedFollowUps: "Failed follow-ups",
      needsAttention: "Needs attention",
    },
    recentLeads: "Recent leads",
    noLeadsTitle: "No leads yet",
    noLeadsHint:
      "Leads created through your qualification chat will appear here.",
    openChat: "Open the chat",
    ariaLeadStatistics: "Lead statistics",
    ariaAgentWorkload: "Agent workload",
    ariaRecentLeads: "Recent leads",
    upcomingAppointments: "Upcoming appointments",
    ariaUpcomingAppointments: "Upcoming appointments",
    noAppointmentsTitle: "No upcoming appointments",
    noAppointmentsHint: "Booked appointments will appear here.",
    leadHealthTitle: "Lead health",
    ariaLeadHealth: "Lead health",
  },

  leads: {
    title: "Leads",
    noLeads: "No leads",
    range: "{from}–{to} of {total}",
    searchPlaceholder: "Search name, phone or email…",
    searchLabel: "Search leads",
    filterTemperature: "Filter by temperature",
    filterStatus: "Filter by status",
    allTemperatures: "All temperatures",
    allStatuses: "All statuses",
    noMatchTitle: "No leads match your filters",
    noMatchHint: "Try a different search term or clear the filters.",
    clearFilters: "Clear filters",
    columns: {
      name: "Name",
      contact: "Contact",
      intent: "Intent",
      score: "Score",
      temp: "Temp",
      status: "Status",
      source: "Source",
      created: "Created",
    },
    pageOf: "Page {page} of {pages}",
  },

  leadDetail: {
    allLeads: "All leads",
    scoreLabel: "Score",
    scoreWithValue: "Score {score}",
    sections: {
      leadData: "Lead data",
      nextBestAction: "Next best action",
      followUps: "Follow-ups",
      appointments: "Appointments",
      conversation: "Conversation",
      conversations: "Conversations",
      timeline: "Timeline",
      status: "Status",
      agentActions: "Agent actions",
    },
    followUps: {
      pendingBadge: "{count} pending",
      none: "No follow-ups scheduled.",
      sent: "Sent {date}",
      retry: "Retry {date}",
      attempts: "{count} attempts",
      oneAttempt: "1 attempt",
    },
    appointments: {
      none: "No appointments scheduled.",
      upcoming: "{date} – {time}",
      book: "Book an appointment",
      slotLabel: "Available time",
      noSlots: "No slots are available right now.",
      notConnected: "Connect a calendar in Integrations to book appointments.",
      notesOptional: "Note (optional)",
      bookAction: "Book appointment",
      reschedule: "Reschedule",
      rescheduleTitle: "Reschedule appointment",
      cancel: "Cancel appointment",
      cancelTitle: "Cancel appointment",
      cancelReasonOptional: "Reason (optional)",
      confirmCancel: "Confirm cancellation",
      keep: "Keep appointment",
    },
    conversation: {
      none: "No persisted conversation for this lead.",
      noMessages: "No messages.",
      assistant: "Assistant",
      you: "You",
      channelStatus: "{channel} · {status}",
    },
    timeline: {
      none: "No events recorded.",
    },
    status: {
      readonly: "Your role is read-only for leads.",
      update: "Update status",
      updating: "Saving…",
      updated: "Status updated.",
      selectLabel: "Lead status",
    },
    agentActions: {
      markQualified: "Mark qualified",
      qualComplete: "Qualification looks complete.",
      qualIncomplete:
        "Qualification is not complete yet — you can still mark it manually.",
      scheduleFollowUp: "Schedule a follow-up",
      followUpDateLabel: "Follow-up date and time",
      noteOptional: "Note (optional)",
      addFollowUp: "Add follow-up",
      requestHandoff: "Request human handoff",
      reasonOptional: "Reason (optional)",
      flagForHuman: "Flag for a human",
      complete: "Complete",
    },
    sidebar: {
      score: "Score",
      temperature: "Temperature",
      source: "Source",
      created: "Created",
      updated: "Updated",
    },
    notFound: {
      title: "Lead not found",
      text: "It may have been removed, or it belongs to another organization.",
      back: "Back to leads",
    },
  },

  followUps: {
    status: {
      pending: "Pending",
      processing: "Processing",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    },
    source: {
      manual: "manual",
      agent: "agent",
      system: "system",
      chat: "chat",
    },
  },

  appointmentStatuses: {
    scheduled: "Scheduled",
    rescheduled: "Rescheduled",
    cancelled: "Cancelled",
    completed: "Completed",
    no_show: "No-show",
  },

  calendar: {
    title: "Google Calendar",
    description:
      "Connect a calendar so the AI agent can see real availability and book, reschedule or cancel appointments — on web chat and WhatsApp alike.",
    readonly: "Read-only — an owner or admin can manage the calendar connection.",
    notConnected: "Not connected.",
    status: {
      connected: "Connected",
      disconnected: "Disconnected",
      error: "Error",
      pending: "Pending",
    },
    fields: {
      calendarEmail: "Connected account",
      timezone: "Time zone",
      updated: "Updated",
      lastError: "Last error",
    },
    connect: {
      connectButton: "Connect Google Calendar",
      updateButton: "Reconnect",
      disconnect: "Disconnect",
      disconnecting: "Disconnecting…",
    },
    settings: {
      title: "Booking settings",
      description:
        "Working hours, appointment length, and how far ahead the AI may book.",
      workingDays: "Working days",
      startTime: "Start time",
      endTime: "End time",
      slotMinutes: "Appointment length (minutes)",
      lookaheadDays: "Bookable up to (days ahead)",
      minNoticeMinutes: "Minimum notice (minutes)",
      save: "Save settings",
      saving: "Saving…",
    },
    days: {
      0: "Sun",
      1: "Mon",
      2: "Tue",
      3: "Wed",
      4: "Thu",
      5: "Fri",
      6: "Sat",
    },
    validation: {
      timezoneInvalid: "Choose a valid time zone.",
      workingDaysInvalid: "Choose at least one working day.",
      startTimeInvalid: "Choose a valid start time.",
      endTimeInvalid: "Choose a valid end time.",
      endBeforeStart: "End time must be after start time.",
      slotMinutesInvalid: "Appointment length must be between {min} and {max} minutes.",
      lookaheadInvalid: "Lookahead must be between {min} and {max} days.",
      minNoticeInvalid: "Minimum notice looks invalid.",
      slotRequired: "Choose a time.",
      slotInvalid: "That time isn't valid.",
      slotPast: "Choose a time in the future.",
    },
    errors: {
      onlyOwnerAdmin: "Only an owner or admin can manage the calendar connection.",
      fixDetails: "Please fix the highlighted settings.",
      noPermission: "You don't have permission to change this.",
      notConfigured: "Calendar integration isn't configured on the server yet.",
      consentDenied: "Google sign-in was cancelled.",
      invalidCallback: "That Google sign-in link is invalid or expired.",
      invalidState: "That Google sign-in link is invalid or expired.",
      exchangeFailed: "Could not complete Google sign-in. Please try again.",
      noRefreshToken:
        "Google didn't grant lasting access. Please try connecting again and accept all permissions.",
      saveFailed: "Could not save the calendar connection. Please try again.",
    },
    results: {
      connected: "Google Calendar connected.",
      disconnected: "Google Calendar disconnected.",
      settingsSaved: "Booking settings saved.",
    },
  },

  settings: {
    saved: "Saved.",
    readonly: "Read-only — an owner or admin can edit these settings.",
    invalid: "Those settings aren't valid.",
  },

  settingsAi: {
    title: "AI agent",
    subtitle:
      "Customize how the {template} qualification assistant behaves. Changes apply to new chat messages immediately.",
    readonly: "Read-only — an owner or admin can edit these settings.",
    noTemplate: "No industry template is configured for this workspace.",
    behavior: {
      title: "Assistant behavior",
      description:
        "How the AI agent introduces itself and talks. Blank fields fall back to the industry template.",
      persona: "Identity / persona",
      goal: "Goal",
      tone: "Tone",
      style: "Style",
      languages: "Languages (one per line)",
      languagesHint:
        "The assistant understands and mirrors these. Replaces the template list.",
      additionalRules: "Additional rules (one per line)",
      additionalRulesHint: "Appended after the template's built-in rules.",
      domainContext: "Domain context",
      templateHint: "Template: {value}",
    },
    qualification: {
      title: "Qualification",
      description:
        "Which details the assistant collects, in what order, and how it asks. Disabling a field removes it from the conversation and from lead extraction.",
      colOn: "On",
      colField: "Field",
      colOrder: "Order",
      colHint: "Question hint",
      notInFlow: "not in the flow",
      minOneField: "At least one field must stay enabled.",
      enableField: "Enable {field}",
      orderFor: "Order for {field}",
      hintFor: "Question hint for {field}",
    },
    scoring: {
      title: "Scoring thresholds",
      description:
        "Score is computed deterministically (max {max}). These cut-offs decide the temperature band.",
      hotAt: "HOT at score ≥",
      warmAt: "WARM at score ≥",
      template: "Template: {value}",
      note: "HOT must be ≥ WARM. Below WARM is COLD. Scoring rules themselves are set by the industry template.",
    },
    errors: {
      onlyOwnerAdmin:
        "Only an owner or admin can change the AI agent settings.",
      unknownTemplate: "Unknown industry template.",
      invalid: "Those settings aren't valid.",
      noPermission: "You don't have permission to change these settings.",
      malformed: "Malformed form data.",
    },
  },

  integrations: {
    title: "Integrations",
    subtitle:
      "Connect external channels. LeadFlow uses the same AI engine across every channel.",
    readonly: "Read-only — an owner or admin can manage integrations.",
  },

  whatsapp: {
    title: "WhatsApp",
    description:
      "Meta WhatsApp Business Cloud API. Inbound messages enter the same qualification flow; scheduled follow-ups on the WhatsApp channel are delivered here.",
    notConnected: "Not connected.",
    status: {
      connected: "Connected",
      disconnected: "Disconnected",
      error: "Error",
      pending: "Pending",
    },
    fields: {
      displayNumber: "Display number",
      phoneNumberId: "Phone number ID",
      wabaId: "WABA ID",
      updated: "Updated",
      lastError: "Last error",
    },
    connect: {
      title: "Connect",
      updateTitle: "Update credentials",
      phoneNumberId: "Phone number ID",
      phoneNumberIdHint: "From your Meta app → WhatsApp → API Setup.",
      accessToken: "Access token",
      accessTokenHint:
        "Stored encrypted, server-side only. Never shown again.",
      wabaIdOptional: "WABA ID (optional)",
      displayNumberOptional: "Display number (optional)",
      submit: "Connect WhatsApp",
      update: "Update",
      connecting: "Connecting…",
      test: "Test connection",
      testing: "Testing…",
      disconnect: "Disconnect",
    },
    template: {
      title: "Out-of-window follow-up template",
      description:
        "Meta only allows free-form messages within 24 hours of the customer's last message. Set an approved template name for follow-ups sent later. Leave blank to skip such follow-ups (they fail with a clear reason rather than sending an invalid message).",
      name: "Template name",
      language: "Language code",
      save: "Save template",
      saving: "Saving…",
    },
    results: {
      connected: "WhatsApp connected.",
      disconnected: "WhatsApp disconnected.",
      templateSaved: "Follow-up template saved.",
      templateCleared: "Follow-up template cleared.",
      checkOk: "Connection OK.",
      checkOkNamed: "Connection OK — {name}.",
      savedButCheckFailed:
        "Saved, but the connection check failed: {detail}",
      checkFailed: "Connection check failed: {detail}",
    },
    errors: {
      onlyOwnerAdmin: "Only an owner or admin can manage integrations.",
      fixDetails: "Please fix the connection details.",
      missingKey: "The server is missing WHATSAPP_TOKEN_ENCRYPTION_KEY.",
      duplicatePhone:
        "That phone number ID is already connected to another workspace.",
      noPermission: "You don't have permission to change this.",
      noConnectionToTest: "No WhatsApp connection to test.",
      cantReadCreds: "Could not read the stored credentials.",
      connectFirst: "Connect WhatsApp first.",
    },
    validation: {
      phoneNumberIdNumeric:
        "Phone number ID must be numeric (from the Meta dashboard).",
      accessTokenInvalid: "Access token looks invalid.",
      wabaIdNumeric: "WABA ID must be numeric.",
      displayNumberTooLong: "Display phone number is too long.",
      templateNameFormat:
        "Template name must be lowercase letters, digits and underscores.",
      languageCodeInvalid: "Language code looks invalid (e.g. en_US, ar).",
    },
  },

  insights: {
    sectionTitle: "Next Best Action",
    riskLevels: {
      needs_attention: "Needs Attention",
      at_risk: "At Risk",
      none: "No Action Needed",
    },
    actions: {
      call_now: "Call now",
      follow_up: "Follow up",
      reply_now: "Reply now",
      book_appointment: "Book appointment",
      human_handoff: "Human handoff",
      recover_lead: "Recover lead",
      none: "No action needed",
    },
    reasons: {
      closed: "This lead's lifecycle is complete.",
      unansweredInbound: "The lead messaged {minutes} minutes ago with no reply yet.",
      handoffPending: "A human handoff was requested and no one has replied since.",
      followUpOverdue: "A follow-up is {days} day(s) overdue.",
      appointmentMissed: "The scheduled appointment time has already passed.",
      appointmentUpcoming: "An appointment is already scheduled.",
      followUpScheduled: "A follow-up is already scheduled.",
      appointmentCancelled:
        "The appointment was cancelled {days} day(s) ago and hasn't been rebooked.",
      hotLeadStale: "This hot lead has had no activity for {hours} hours.",
      qualifiedInactive: "Qualified but inactive for {days} day(s) with nothing scheduled.",
      onTrack: "On track — no action needed.",
    },
    filter: {
      label: "Focus",
      all: "All leads",
      needsAttention: "Needs Attention",
      atRisk: "At Risk",
      noAction: "No Action Needed",
    },
  },

  recovery: {
    title: "Revenue Recovery",
    subtitle:
      "Lost and long-inactive leads worth another attempt, and how those attempts have gone.",
    resultsTitle: "Recovery results",
    opportunitiesTitle: "Recovery opportunities",
    recentAttemptsTitle: "Recent recovery attempts",
    noOpportunitiesTitle: "No recovery opportunities right now",
    noOpportunitiesHint: "Lost or long-inactive leads will show up here as they come up.",
    noAttemptsTitle: "No recovery attempts yet",
    noAttemptsHint: "Attempts you start from the list above will appear here.",
    ariaResults: "Recovery results",
    ariaOpportunities: "Recovery opportunities",
    ariaAttempts: "Recent recovery attempts",
    startButton: "Start recovery",
    started: "Recovery started.",
    priorities: {
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    outcomes: {
      pending: "Pending",
      contacted: "Contacted",
      recovered: "Recovered",
      converted: "Converted",
      no_response: "No response",
    },
    reasons: {
      lostHot: "Marked lost, but this was a hot lead — worth one more attempt.",
      lostGeneral: "Marked lost.",
      inactiveQualified: "Qualified but gone quiet for {days} day(s), nothing scheduled.",
      inactiveWarm: "Warm lead, silent for {days} day(s) with no progress.",
      inactiveCold: "Never progressed, silent for {days} day(s).",
    },
    errors: {
      alreadyInProgress: "A recovery attempt is already in progress for this lead.",
      notEligible: "This lead is no longer a recovery candidate.",
      startFailed: "Could not start recovery. Please try again.",
    },
  },

  chat: {
    headerTitle: "LeadFlow AI",
    headerSubtitle: "Lead qualification assistant",
    newChat: "New chat",
    composerPlaceholder: "Type your message…",
    composerLabel: "Message",
    sendMessage: "Send message",
    disclaimer: "LeadFlow AI is an automated assistant and can make mistakes.",
    greeting: "Hi! 👋 How can I help you today?",
    emptySubtitle:
      "Tell LeadFlow AI what you're looking for and it will help narrow down the right property for you.",
    seeExample: "See an example conversation",
    typing: "LeadFlow AI is typing",
    you: "You",
    errorGeneric: "Something went wrong. Please try sending that again.",
    errors: {
      generic: "Something went wrong. Please try sending that again.",
      timeout: "The assistant took too long to respond. Please try again.",
      interrupted: "The connection was interrupted. Please try sending that again.",
      misconfigured: "The assistant is misconfigured. Please contact support.",
      busy: "The assistant is busy right now. Please try again shortly.",
      unavailable: "The assistant is temporarily unavailable.",
      serverError: "Unexpected server error.",
      invalidRequest: "That message could not be sent. Please try again.",
      notConfigured: "The assistant is not configured yet.",
    },
    suggestedPrompts: [
      "I'm looking for an apartment in Riyadh.",
      "I want to buy a villa in Jeddah.",
      "Do you have offices for rent in Riyadh?",
    ],
    exampleConversation: [
      "I'm looking for an apartment in Riyadh.",
      "Great. Which area are you interested in?",
      "North Riyadh.",
      "Perfect. What's your approximate budget?",
      "Around 800,000 SAR.",
    ],
  },

  errors: {
    dashboard: {
      title: "We couldn't load this page.",
      reference: "Reference: {digest}",
      tryAgain: "Please try again.",
      retry: "Retry",
    },
    somethingWrong: "Something went wrong loading this data.",
    leads: {
      invalidLead: "Invalid lead.",
      invalidStatus: "Choose a valid status.",
      roleReadonly: "Your role is read-only for leads.",
      loadFailed: "Could not load the lead. Please retry.",
      leadNotFound: "Lead not found.",
      noPermissionLead: "You don't have permission to update this lead.",
      invalidFollowUp: "Invalid follow-up.",
      followUpNotPending: "That follow-up is no longer pending.",
      noPermissionChange: "You don't have permission to change this.",
      createFollowUpFailed: "Could not create the follow-up. Please retry.",
      handoffFailed: "Could not record the handoff. Please retry.",
      markQualifiedFailed: "Could not mark the lead qualified. Please retry.",
      dateMissing: "Pick a future date and time.",
      dateUnparseable: "That date and time could not be read.",
      datePast: "Pick a date and time in the future.",
      dateTooFarOut: "That date is more than {maxDays} days out.",
    },
    calendar: {
      notConnected: "No calendar is connected for this workspace.",
      invalidSlot: "That time slot isn't valid.",
      slotTaken: "That time is no longer available. Please pick another.",
      providerFailed: "Could not reach the calendar provider. Please try again.",
      bookingFailed: "Could not book the appointment. Please retry.",
      noActiveAppointment: "This lead has no upcoming appointment.",
      rescheduleFailed: "Could not reschedule the appointment. Please retry.",
      cancelFailed: "Could not cancel the appointment. Please retry.",
    },
  },

  validation: {
    fixHighlighted: "Please fix the highlighted fields.",
    email: {
      required: "Enter your email address.",
      invalid: "Enter a valid email address.",
    },
    password: {
      required: "Enter a password.",
      loginRequired: "Enter your password.",
      tooShort: "Password must be at least {min} characters.",
      tooLong: "Password must be at most {max} characters.",
    },
    orgName: {
      required: "Enter your organization name.",
      tooShort: "Organization name must be at least {min} characters.",
      tooLong: "Organization name must be at most {max} characters.",
    },
    industry: {
      required: "Choose an industry template.",
      invalid: "Choose a valid industry template.",
    },
  },

  statuses: {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    appointment: "Appointment",
    won: "Won",
    lost: "Lost",
    archived: "Archived",
  },

  temperatures: {
    hot: "Hot",
    warm: "Warm",
    cold: "Cold",
  },

  roles: {
    owner: "Owner",
    admin: "Admin",
    manager: "Manager",
    sales: "Sales",
    viewer: "Viewer",
  },

  events: {
    leadCreated: "Lead created",
    leadCreatedDetail: "Initial score {score} · {temperature}",
    messageReceived: "Message received",
    scoreChanged: "Score changed",
    temperatureChanged: "Temperature changed",
    statusChanged: "Status changed",
    transition: "{from} → {to}",
    leadQualified: "Lead qualified",
    leadQualifiedAuto: "Automatically — qualification complete",
    leadQualifiedManual: "Marked qualified",
    followUpCreated: "Follow-up scheduled",
    followUpCreatedDetail: "Due {date}",
    followUpCompleted: "Follow-up completed",
    followUpCancelled: "Follow-up cancelled",
    followUpExecuted: "Follow-up sent",
    followUpExecutedDetail: "via {channel}",
    followUpExecutedAttempt: "via {channel} (attempt {attempt})",
    followUpRetryScheduled: "Follow-up retry scheduled",
    followUpRetryDetail: "Next attempt {date}",
    followUpFailed: "Follow-up failed",
    humanHandoffRequested: "Human handoff requested",
    appointmentBooked: "Appointment booked",
    appointmentBookedDetail: "{date}",
    appointmentRescheduled: "Appointment rescheduled",
    appointmentCancelled: "Appointment cancelled",
    appointmentCompleted: "Appointment completed",
    appointmentNoShow: "Appointment marked no-show",
  },

  fields: {
    name: "Name",
    phone: "Phone",
    email: "Email",
    intent: "Intent",
    location: "Location",
    budget: "Budget",
    propertyType: "Property type",
    bedrooms: "Bedrooms",
    financing: "Financing",
    timeline: "Timeline",
    service: "Service",
    doctor: "Doctor",
    appointmentDate: "Appointment date",
    insurance: "Insurance",
    urgency: "Urgency",
  },

  fieldOptions: {
    buy: "Buy",
    rent: "Rent",
    apartment: "Apartment",
    villa: "Villa",
    townhouse: "Townhouse",
    office: "Office",
    land: "Land",
    high: "High",
    medium: "Medium",
    low: "Low",
  },

  industries: {
    "real-estate": {
      name: "Real Estate",
      description:
        "Qualify inbound property buyers and renters: intent, area, budget, property type, bedrooms, financing and timeline.",
    },
    clinic: {
      name: "Clinic",
      description:
        "Collect a patient's appointment inquiry: service, preferred doctor, date, insurance and urgency.",
    },
  },
} as const;

/** Widen the literal `as const` types to `string` / `string[]` for other locales. */
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { [K in keyof T]: Widen<T[K]> };

/** The shape every locale dictionary must satisfy. */
export type Dictionary = Widen<typeof en>;
