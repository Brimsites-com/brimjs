import { describe, expect, it } from "vitest";
import { defineForm } from "../src/forms/define.ts";
import { formFields, formSteps } from "../src/forms/fields.ts";

const fields = [
  { name: "name", label: "Nume", type: "text" as const, required: true },
  { name: "email", label: "E-mail", type: "email" as const, required: true },
];

describe("defineForm", () => {
  it("names the form's node after its key and starts the Form from the declaration", () => {
    const contact = defineForm({ key: "contact", name: "Contact", fields, buttonText: "Trimite", showConsent: false });
    expect(contact.nodeId).toBe("form-contact");
    expect(contact.settings).toMatchObject({ formName: "Contact", responsesName: "Contact", buttonText: "Trimite" });
    expect(contact.settings.fields).toEqual(fields);
    // Without its heading on the page, the responses still carry its name.
    expect(defineForm({ key: "contact", name: "Contact", heading: false, fields }).settings).toMatchObject({
      formName: "",
      responsesName: "Contact",
    });
  });

  it("stops the site on a mistake in the declaration", () => {
    const declare = (change: object) => () => defineForm({ key: "contact", name: "Contact", fields, ...change });
    expect(declare({ key: "Contact Form" })).toThrow(/lowercase letters/);
    expect(declare({ name: " " })).toThrow(/needs a name/);
    expect(declare({ fields: [] })).toThrow(/at least one field/);
    expect(declare({ fields: [...fields, fields[0]] })).toThrow(/two fields named "name"/);
    expect(declare({ fields: [{ name: "x", label: "X", type: "signature" }] })).toThrow(/of type "signature"/);
    expect(declare({ fields: [{ name: "x", label: "X", type: "select" }] })).toThrow(/without options/);
    expect(declare({ fields: [{ name: "first name", label: "X", type: "text" }] })).toThrow(/letters, digits and _/);
  });
});

describe("a form asked in steps", () => {
  const entries = [
    { name: "intro", label: "Before the steps", type: "text" },
    { type: "step", label: "Your home", help: "Start with the place." },
    { name: "size", label: "Size", type: "number", width: "half" },
    { name: "city", label: "City", type: "text", width: "half", help: "Where it is." },
    { type: "step", label: "Nothing here yet" },
    { type: "step", label: "About you" },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "size", label: "Size again", type: "number" },
  ];

  it("groups the fields under the step written before them, leaving out steps with none", () => {
    expect(formSteps(entries).map((step) => [step.title, step.intro, step.fields.map((field) => field.name)])).toEqual([
      ["", undefined, ["intro"]],
      ["Your home", "Start with the place.", ["size", "city"]],
      ["About you", undefined, ["email"]],
    ]);
  });

  it("keeps a field's width and help, and asks the server about the questions only", () => {
    const fields = formFields(entries);
    expect(fields.map((field) => field.name)).toEqual(["intro", "size", "city", "email"]);
    expect(fields.find((field) => field.name === "city")).toMatchObject({ width: "half", help: "Where it is." });
    expect(fields.find((field) => field.name === "email")).not.toHaveProperty("width");
  });

  it("is declared with defineForm, which checks each step has a title", () => {
    const quote = defineForm({
      key: "quote",
      name: "Quote",
      fields: [{ type: "step", label: "Your home" }, ...fields],
      nextText: "Continuă",
    });
    expect(formSteps(quote.settings.fields).map((step) => step.title)).toEqual(["Your home"]);
    expect(quote.settings.nextText).toBe("Continuă");
    const declare = (list: object[]) => () => defineForm({ key: "quote", name: "Quote", fields: list as never });
    expect(declare([{ type: "step", label: " " }, ...fields])).toThrow(/step without a label/);
    expect(declare([{ type: "step", label: "Only a step" }])).toThrow(/at least one field/);
  });
});
