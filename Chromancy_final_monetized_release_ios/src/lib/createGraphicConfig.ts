export type CreateUseType =
  | "Poster"
  | "Business Card"
  | "Email Signature"
  | "Presentation Cover"
  | "Wedding Invite"
  | "Party Invite"
  | "Birthday Card"
  | "Instagram Post"
  | "Facebook Post"
  | "LinkedIn Post"
  | "Facebook Cover";

export type CreateFieldType = "text" | "textarea" | "date" | "time" | "email" | "tel" | "url";

export type CreateFieldConfig = {
  id: string;
  label: string;
  placeholder: string;
  type?: CreateFieldType;
  required?: boolean;
  fullWidth?: boolean;
};

export type CreateFormatConfig = {
  value: string;
  label: string;
  mimeType: string;
  extension: string;
  transparent?: boolean;
};

export type CreateTypeConfig = {
  description: string;
  helper: string;
  fields: CreateFieldConfig[];
  formats: CreateFormatConfig[];
  allowImages: boolean;
  minImages?: number;
  maxImages: number;
  allowLogo?: boolean;
  canvasSize: { width: number; height: number };
  promptFormat: string;
  promptDirection: string;
  additionalTextPlaceholder: string;
  notesPlaceholder: string;
  imagesLabel?: string;
  imagesHelp?: string;
};

export const CREATE_TYPE_CONFIG: Record<CreateUseType, CreateTypeConfig> = {
  Poster: {
    description: "Campaign-ready poster",
    helper: "Build a premium poster with strong hierarchy, event clarity, and polished spacing.",
    fields: [
      { id: "heading", label: "Heading", placeholder: "Main headline", required: true },
      { id: "subheading", label: "Subheading", placeholder: "Short supporting line" },
      { id: "date", label: "Date", placeholder: "Date", type: "date" },
      { id: "time", label: "Time", placeholder: "Time", type: "time" },
      { id: "venue", label: "Venue", placeholder: "Venue", fullWidth: true },
      { id: "callToAction", label: "Call to action", placeholder: "Book now / RSVP / Learn more", fullWidth: true },
    ],
    formats: [
      { value: "pdf", label: "PDF", mimeType: "application/pdf", extension: "pdf" },
      { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" },
    ],
    allowImages: true,
    maxImages: 4,
    allowLogo: true,
    canvasSize: { width: 1200, height: 1800 },
    promptFormat: "1200x1800 portrait poster",
    promptDirection: "Use bold hierarchy, premium poster pacing, and clean event communication.",
    additionalTextPlaceholder: "Any extra text to place on the poster",
    notesPlaceholder: "Notes or design direction",
    imagesLabel: "Upload supporting images",
    imagesHelp: "Optional photos or references to art-direct the poster.",
  },
  "Business Card": {
    description: "Professional business card",
    helper: "Create a sharp, premium business card front that looks print-ready and intentional.",
    fields: [
      { id: "businessName", label: "Business / brand", placeholder: "Business name", required: true },
      { id: "personName", label: "Name", placeholder: "Full name", required: true },
      { id: "jobTitle", label: "Job title", placeholder: "Founder / Designer / Director" },
      { id: "phone", label: "Phone", placeholder: "Phone number", type: "tel" },
      { id: "email", label: "Email", placeholder: "Email address", type: "email" },
      { id: "website", label: "Website", placeholder: "Website", type: "url" },
      { id: "address", label: "Address", placeholder: "Address", fullWidth: true },
      { id: "tagline", label: "Tagline", placeholder: "Short brand line", fullWidth: true },
    ],
    formats: [
      { value: "pdf", label: "PDF", mimeType: "application/pdf", extension: "pdf" },
      { value: "png", label: "PNG", mimeType: "image/png", extension: "png" },
    ],
    allowImages: true,
    maxImages: 2,
    allowLogo: true,
    canvasSize: { width: 1050, height: 600 },
    promptFormat: "1050x600 landscape business card",
    promptDirection: "Use crisp alignment, refined typography, and premium brand polish.",
    additionalTextPlaceholder: "Extra brand text, services, or offer",
    notesPlaceholder: "Notes or design direction",
    imagesLabel: "Upload supporting images",
    imagesHelp: "Optional brand visuals or textures.",
  },
  "Email Signature": {
    description: "Email-ready signature graphic",
    helper: "Create a clean premium email signature with clear contact details and balanced brand presence.",
    fields: [
      { id: "fullName", label: "Name", placeholder: "Full name", required: true },
      { id: "jobTitle", label: "Job title", placeholder: "Job title" },
      { id: "company", label: "Company", placeholder: "Company / brand", required: true },
      { id: "phone", label: "Phone", placeholder: "Phone number", type: "tel" },
      { id: "email", label: "Email", placeholder: "Email address", type: "email", required: true },
      { id: "website", label: "Website", placeholder: "Website", type: "url" },
      { id: "address", label: "Address", placeholder: "Address", fullWidth: true },
    ],
    formats: [{ value: "png", label: "PNG", mimeType: "image/png", extension: "png" }],
    allowImages: true,
    maxImages: 2,
    allowLogo: true,
    canvasSize: { width: 1200, height: 450 },
    promptFormat: "1200x450 email signature layout",
    promptDirection: "Keep the signature compact, premium, readable, and polished for email use.",
    additionalTextPlaceholder: "Optional extra signature line or disclaimer",
    notesPlaceholder: "Notes or styling direction",
    imagesLabel: "Upload supporting images",
    imagesHelp: "Optional headshot or supporting brand image.",
  },
  "Presentation Cover": {
    description: "Presentation title slide",
    helper: "Design a premium presentation cover with clean structure, clarity, and executive polish.",
    fields: [
      { id: "heading", label: "Heading", placeholder: "Presentation title", required: true },
      { id: "subheading", label: "Subheading", placeholder: "Supporting line" },
      { id: "speaker", label: "Speaker", placeholder: "Speaker / presenter" },
      { id: "company", label: "Company", placeholder: "Company / brand" },
      { id: "event", label: "Event", placeholder: "Event / meeting" },
      { id: "date", label: "Date", placeholder: "Date", type: "date" },
    ],
    formats: [
      { value: "pdf", label: "PDF", mimeType: "application/pdf", extension: "pdf" },
      { value: "png", label: "PNG", mimeType: "image/png", extension: "png" },
      { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" },
    ],
    allowImages: true,
    maxImages: 2,
    allowLogo: true,
    canvasSize: { width: 1920, height: 1080 },
    promptFormat: "1920x1080 widescreen presentation cover",
    promptDirection: "Keep the layout clean, executive, high-end, and presentation-ready.",
    additionalTextPlaceholder: "Extra presentation text or subtitle",
    notesPlaceholder: "Notes or presentation direction",
    imagesLabel: "Upload supporting images",
    imagesHelp: "Optional brand visuals or cover imagery.",
  },
  "Wedding Invite": { description: "Wedding invitation", helper: "Create an elegant premium wedding invitation.", fields: [{ id: "heading", label: "Heading", placeholder: "Wedding invitation / Save the date", required: true }, { id: "coupleNames", label: "Couple names", placeholder: "Couple names", required: true }, { id: "date", label: "Date", placeholder: "Date", type: "date", required: true }, { id: "time", label: "Time", placeholder: "Time", type: "time" }, { id: "venue", label: "Venue", placeholder: "Venue", fullWidth: true, required: true }, { id: "rsvp", label: "RSVP", placeholder: "RSVP details", fullWidth: true }], formats: [{ value: "pdf", label: "PDF", mimeType: "application/pdf", extension: "pdf" }, { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" }], allowImages: true, maxImages: 2, canvasSize: { width: 1500, height: 2100 }, promptFormat: "1500x2100 portrait wedding invitation", promptDirection: "Make the invitation elegant, romantic, polished, and premium without clutter.", additionalTextPlaceholder: "Extra wording for the invitation", notesPlaceholder: "Notes or style direction", imagesLabel: "Upload supporting images", imagesHelp: "Optional couple images or floral references." },
  "Party Invite": { description: "Party invitation", helper: "Create a fun but premium invite with strong event clarity.", fields: [{ id: "heading", label: "Heading", placeholder: "Party title", required: true }, { id: "hostName", label: "Host", placeholder: "Host name" }, { id: "theme", label: "Theme", placeholder: "Theme / vibe" }, { id: "date", label: "Date", placeholder: "Date", type: "date", required: true }, { id: "time", label: "Time", placeholder: "Time", type: "time" }, { id: "venue", label: "Venue", placeholder: "Venue", fullWidth: true, required: true }, { id: "rsvp", label: "RSVP", placeholder: "RSVP details", fullWidth: true }], formats: [{ value: "pdf", label: "PDF", mimeType: "application/pdf", extension: "pdf" }, { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" }], allowImages: true, maxImages: 2, canvasSize: { width: 1500, height: 2100 }, promptFormat: "1500x2100 portrait party invitation", promptDirection: "Keep the energy high but premium, with clean typography and strong layout control.", additionalTextPlaceholder: "Extra party text or dress code", notesPlaceholder: "Notes or style direction", imagesLabel: "Upload supporting images", imagesHelp: "Optional photos or style references." },
  "Birthday Card": { description: "Birthday greeting card", helper: "Create a premium birthday greeting card that feels warm, thoughtful, polished, and ready to send to friends or family.", fields: [{ id: "heading", label: "Heading", placeholder: "Happy Birthday / Warm wishes", required: true }, { id: "recipientName", label: "Recipient name", placeholder: "Recipient name", required: true }, { id: "milestone", label: "Milestone", placeholder: "Age / milestone / short theme" }, { id: "message", label: "Message", placeholder: "Your birthday message", type: "textarea", required: true, fullWidth: true }, { id: "senderName", label: "From", placeholder: "Your name or sign-off" }], formats: [{ value: "pdf", label: "PDF", mimeType: "application/pdf", extension: "pdf" }, { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" }], allowImages: true, maxImages: 2, canvasSize: { width: 1500, height: 2100 }, promptFormat: "1500x2100 portrait birthday greeting card", promptDirection: "Keep the card premium, balanced, heartfelt, celebratory, and beautifully polished for sending to loved ones.", additionalTextPlaceholder: "Extra birthday wording or short caption", notesPlaceholder: "Notes or style direction", imagesLabel: "Upload supporting images", imagesHelp: "Optional photos or reference imagery." },
  "Instagram Post": { description: "Instagram-ready post", helper: "Create a premium social post that feels polished and high-performing.", fields: [{ id: "heading", label: "Heading", placeholder: "Main headline", required: true }, { id: "subheading", label: "Subheading", placeholder: "Supporting line" }, { id: "callToAction", label: "Call to action", placeholder: "Call to action" }, { id: "handle", label: "Handle", placeholder: "@handle" }], formats: [{ value: "png", label: "PNG", mimeType: "image/png", extension: "png" }, { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" }], allowImages: true, maxImages: 4, allowLogo: true, canvasSize: { width: 1080, height: 1350 }, promptFormat: "1080x1350 Instagram post", promptDirection: "Keep the composition premium, social-ready, and visually strong without looking templated.", additionalTextPlaceholder: "Extra post text", notesPlaceholder: "Notes or creative direction", imagesLabel: "Upload supporting images", imagesHelp: "Optional product, portrait, or reference images." },
  "Facebook Post": { description: "Facebook post graphic", helper: "Create a polished Facebook post with premium hierarchy and readability.", fields: [{ id: "heading", label: "Heading", placeholder: "Main headline", required: true }, { id: "subheading", label: "Subheading", placeholder: "Supporting line" }, { id: "callToAction", label: "Call to action", placeholder: "Call to action" }, { id: "brandLine", label: "Brand line", placeholder: "Brand / company name" }], formats: [{ value: "png", label: "PNG", mimeType: "image/png", extension: "png" }, { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" }], allowImages: true, maxImages: 4, allowLogo: true, canvasSize: { width: 1200, height: 630 }, promptFormat: "1200x630 Facebook post graphic", promptDirection: "Make the layout premium, polished, and immediately legible in-feed.", additionalTextPlaceholder: "Extra post text", notesPlaceholder: "Notes or creative direction", imagesLabel: "Upload supporting images", imagesHelp: "Optional product, portrait, or reference images." },
  "LinkedIn Post": { description: "LinkedIn-ready post", helper: "Create a polished professional LinkedIn post with a premium editorial look.", fields: [{ id: "heading", label: "Heading", placeholder: "Main headline", required: true }, { id: "subheading", label: "Subheading", placeholder: "Supporting line" }, { id: "company", label: "Company", placeholder: "Company / brand" }, { id: "callToAction", label: "Call to action", placeholder: "Call to action" }], formats: [{ value: "png", label: "PNG", mimeType: "image/png", extension: "png" }, { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" }], allowImages: true, maxImages: 4, allowLogo: true, canvasSize: { width: 1200, height: 627 }, promptFormat: "1200x627 LinkedIn post graphic", promptDirection: "Keep the design premium, professional, clean, and executive-facing.", additionalTextPlaceholder: "Extra post text", notesPlaceholder: "Notes or creative direction", imagesLabel: "Upload supporting images", imagesHelp: "Optional brand, portrait, or supporting images." },
  "Facebook Cover": { description: "Facebook cover image", helper: "Create a polished cover image with strong brand hierarchy in a wide format.", fields: [{ id: "heading", label: "Heading", placeholder: "Main headline", required: true }, { id: "tagline", label: "Tagline", placeholder: "Short supporting line" }, { id: "website", label: "Website", placeholder: "Website", type: "url" }, { id: "callToAction", label: "Call to action", placeholder: "Call to action" }], formats: [{ value: "png", label: "PNG", mimeType: "image/png", extension: "png" }, { value: "jpeg", label: "JPEG", mimeType: "image/jpeg", extension: "jpg" }], allowImages: true, maxImages: 2, allowLogo: true, canvasSize: { width: 1640, height: 624 }, promptFormat: "1640x624 Facebook cover graphic", promptDirection: "Make the wide-format composition premium, balanced, and cover-ready without crowding safe areas.", additionalTextPlaceholder: "Extra cover text", notesPlaceholder: "Notes or creative direction", imagesLabel: "Upload supporting images", imagesHelp: "Optional lifestyle or brand images." },
};

export const CREATE_TYPE_ORDER = Object.keys(CREATE_TYPE_CONFIG) as CreateUseType[];

export function getCreateDefaultValues(type: CreateUseType | null) {
  if (!type) return {};
  return CREATE_TYPE_CONFIG[type].fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.id] = "";
    return acc;
  }, {});
}

export function getCreateFormat(type: CreateUseType | null, value: string | null | undefined) {
  if (!type) return null;
  const formats = CREATE_TYPE_CONFIG[type].formats;
  return formats.find((format) => format.value === value) || formats[0] || null;
}
