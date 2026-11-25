// Settings of the "form" block: its fields, texts, consent and where its messages go. How it looks (colours,
// input styles, spacing, the button's place) is the site's CSS, on the form's stable classes.
import type { BlockDefinition } from "../types.ts";
import { FORM_FIELD_TYPES } from "./form-field-types.ts";

export const form: BlockDefinition = {
  type: "form",
  label: "Form",
  description: "A form whose messages the owner reads in the editor",
  schema: {
    fieldsets: [
      { id: "form_settings", title: "Settings", fields: ["formName", "infoText"] },
      { id: "form_fields", title: "Fields", fields: ["fields"] },
      { id: "form_button", title: "Button", fields: ["buttonText", "nextText", "backText"] },
      {
        id: "form_consent",
        title: "Consent",
        fields: ["showConsent", "consentText", "consentLinkText", "consentLinkUrl", "consentRequired"],
      },
      { id: "form_after", title: "After Submission", fields: ["successMessage"] },
      {
        id: "form_confirmation",
        title: "Confirmation Email",
        fields: [
          "confirmationEmail",
          "confirmationField",
          "confirmationSubject",
          "confirmationMessage",
          "confirmationAnswers",
        ],
      },
    ],
    properties: {
      fields: {
        title: "Form Fields",
        type: "array",
        widget: "form-fields",
        description:
          'Ordered form fields. An entry of type "step" starts a step: its label is the step\'s title, its help the line under it, and the fields after it are asked together.',
        items: {
          type: "object",
          required: ["id", "type", "name", "label"],
          properties: {
            id: {
              type: "string",
              description: "Stable unique field identifier used by layoutRows.",
            },
            type: {
              type: "string",
              enum: FORM_FIELD_TYPES,
              description: "Use date for a date picker, time for a time picker, and range for a numeric slider.",
            },
            name: {
              type: "string",
              description: "Unique submission payload key.",
            },
            label: { type: "string" },
            placeholder: { type: "string" },
            help: { type: "string", description: "A line under the question; for a step, the line under its title." },
            display: {
              type: "string",
              enum: ["list", "cards"],
              description:
                "For a radio or checkboxes field: cards shows the choices as boxes to click, with their image or icon.",
            },
            showWhen: {
              type: "object",
              description:
                'Ask this field only when another field has one of these answers: { field: "city", equals: ["Other"] }.',
              properties: {
                field: { type: "string" },
                equals: { type: ["string", "array"], items: { type: "string" } },
              },
            },
            width: {
              type: "string",
              enum: ["full", "half"],
              description: "half puts the field next to another half on a wide screen.",
            },
            placeholders: {
              type: "object",
              description: "Per-control placeholder text for compound name and address fields.",
              properties: {
                fullName: { type: "string" },
                firstName: { type: "string" },
                middleName: { type: "string" },
                lastName: { type: "string" },
                country: { type: "string" },
                state: { type: "string" },
                city: { type: "string" },
                postalCode: { type: "string" },
                streetAddress: { type: "string" },
                streetNumber: { type: "string" },
              },
            },
            required: { type: "boolean" },
            rows: { type: "number", minimum: 2 },
            options: {
              type: "array",
              items: {
                type: "object",
                required: ["label"],
                properties: {
                  value: { type: "string" },
                  label: { type: "string" },
                  icon: {
                    type: "string",
                    description:
                      "On a card choice: a picture's address (an SVG of the site, an upload) or a short text such as an emoji.",
                  },
                  description: { type: "string", description: "On a card choice: a line under its words." },
                  image: {
                    type: "string",
                    description: "On a card choice: a photo filling the card's top (an upload's address).",
                  },
                  width: { type: "number" },
                  imageScales: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        url: { type: "string" },
                        width: { type: "number" },
                        height: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
            nameFormat: {
              type: "string",
              enum: ["full", "first_last", "first_middle_last"],
            },
            accept: {
              type: ["string", "array"],
              description:
                'File fields: the kinds taken, out of pdf, jpg, png, webp, gif (e.g. "pdf, jpg"). Without it: pdf, jpg, png, webp. Files are recognised by content; nothing else can be allowed.',
            },
            multiple: { type: "boolean", description: "File fields: up to five files instead of one." },
            min: {
              type: ["number", "string"],
              description: "Number for range/number/currency; YYYY-MM-DD for date; HH:mm for time.",
            },
            max: {
              type: ["number", "string"],
              description: "Number for range/number/currency; YYYY-MM-DD for date; HH:mm for time.",
            },
            step: {
              type: "number",
              description: "Numeric increment. For time fields this value is measured in seconds.",
            },
            defaultValue: {
              type: ["number", "string"],
              description: "Initial value matching the field type and its min/max constraints.",
            },
            currencySymbol: { type: "string" },
            addressFields: {
              type: "array",
              items: {
                type: "string",
                enum: ["street", "city", "state", "zip", "country"],
              },
            },
            defaultCountry: { type: "string" },
            restrictCountry: { type: "boolean" },
            showStreetNumber: { type: "boolean" },
            displayContent: {},
          },
        },
      },
      formName: {
        title: "Form Name",
        type: "string",
        widget: "text",
        placeholder: "Contact Form",
        default: "",
        description: "Name to identify this form in submissions",
      },
      infoText: {
        title: "Description",
        type: "string",
        widget: "form-richtext",
        default: "",
        description: "Optional text displayed above the form fields",
      },
      buttonText: {
        title: "Button Text",
        type: "string",
        widget: "text",
        default: "Send message",
      },
      nextText: {
        title: "Continue Button",
        type: "string",
        widget: "text",
        default: "Continue",
        description: "In a form asked in steps: the button to the next step",
      },
      backText: {
        title: "Back Button",
        type: "string",
        widget: "text",
        default: "Back",
        description: "In a form asked in steps: the button to the step before",
      },
      showConsent: {
        title: "Show Consent",
        type: "boolean",
        widget: "checkbox",
        default: true,
      },
      consentText: {
        title: "Text Before Link",
        type: "string",
        widget: "text",
        default: "I agree to the",
        showWhen: { showConsent: true },
        description: "Text that appears before the link",
      },
      consentLinkText: {
        title: "Link Text",
        type: "string",
        widget: "text",
        default: "privacy policy",
        showWhen: { showConsent: true },
        description: "The clickable link text",
      },
      consentLinkUrl: {
        title: "Link URL",
        type: "string",
        widget: "url",
        default: "/privacy",
        showWhen: { showConsent: true },
        description: "URL for the consent link (e.g., /privacy)",
      },
      consentRequired: {
        title: "Consent Required",
        type: "boolean",
        widget: "checkbox",
        default: false,
        showWhen: { showConsent: true },
      },
      successMessage: {
        title: "Success Message",
        type: "string",
        widget: "form-richtext",
        default: "<p>Thank you! We will get back to you shortly.</p>",
        description: "Message shown after successful submission",
      },
      confirmationEmail: {
        title: "Email the visitor a confirmation",
        type: "boolean",
        widget: "checkbox",
        default: false,
        description:
          "After a message is received, the visitor gets one email at the address they wrote. The site must be able to send email (Site Settings).",
      },
      confirmationField: {
        title: "Send it to",
        type: "string",
        widget: "form-email-field",
        default: "",
        showWhen: { confirmationEmail: true },
        description: "The email field of this form that holds the visitor's address.",
      },
      confirmationSubject: {
        title: "Subject",
        type: "string",
        widget: "text",
        default: "We received your message",
        showWhen: { confirmationEmail: true },
      },
      confirmationMessage: {
        title: "Message",
        type: "string",
        widget: "textarea",
        default: "Thank you for writing to us. We received your message and will get back to you shortly.",
        showWhen: { confirmationEmail: true },
        description: "Plain text, 5,000 characters at most. How the email looks is the site's design.",
      },
      confirmationAnswers: {
        title: "Include the visitor's answers",
        type: "boolean",
        widget: "checkbox",
        default: false,
        showWhen: { confirmationEmail: true },
        description:
          "Off is safer: anyone can type someone else's address, and with this on the site would email that person whatever was typed in the form (shortened).",
      },
      notificationEmail: {
        title: "Notification Email",
        type: "string",
        widget: "text",
        // Whoever is in it gets every message: a role that may not read the messages may not put itself there.
        permission: "responses",
        placeholder: "hello@example.com",
        default: "",
        description:
          "Each message is emailed to the site's owners and to the addresses in Site Settings. Add more addresses for this form here, separated by commas.",
      },
    },
  },
  defaults: {
    "@type": "form",
    presetId: "default-theme",
    formName: "",
    buttonText: "Send message",
    nextText: "Continue",
    backText: "Back",
    infoText: "",
    fields: [
      {
        id: "name",
        type: "name",
        name: "name",
        label: "Name",
        nameFormat: "full",
        required: true,
      },
      {
        id: "email",
        type: "email",
        name: "email",
        label: "Email",
        placeholder: "jane@company.com",
        required: true,
      },
      {
        id: "message",
        type: "textarea",
        name: "message",
        label: "Message",
        placeholder: "Tell us about your goals...",
        required: true,
        rows: 5,
      },
    ],
    showConsent: true,
    consentText: "I agree to the",
    consentLinkText: "privacy policy",
    consentLinkUrl: "/privacy",
    consentRequired: false,
    successMessage: "<p>Thank you! We will get back to you shortly.</p>",
    notificationEmail: "",
    confirmationEmail: false,
    confirmationField: "",
    confirmationSubject: "We received your message",
    confirmationMessage: "Thank you for writing to us. We received your message and will get back to you shortly.",
    confirmationAnswers: false,
  },
};
