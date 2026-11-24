import { describe, expect, it } from "vitest";
import { formFields } from "../src/forms/fields.ts";

describe("form choices", () => {
  it("keeps a card choice's icon and description next to its words", () => {
    const [field] = formFields([
      {
        name: "space",
        label: "Space",
        type: "radio",
        display: "cards",
        options: ["Flat", { label: "House", icon: "/icons/house.svg", description: "With a garden" }, { label: " " }],
      },
    ]);
    expect(field?.display).toBe("cards");
    expect(field?.options).toEqual(["Flat", "House"]);
    expect(field?.choices).toEqual([
      { label: "Flat" },
      { label: "House", icon: "/icons/house.svg", description: "With a garden" },
    ]);
  });

  it("shows cards only for a radio field", () => {
    const [field] = formFields([
      { name: "space", label: "Space", type: "select", display: "cards", options: ["Flat"] },
    ]);
    expect(field?.display).toBeUndefined();
  });

  it("keeps a condition on another field, and drops one on itself", () => {
    const [own, other] = formFields([
      { name: "town", label: "Town", type: "text", showWhen: { field: "town", equals: "x" } },
      { name: "town2", label: "Town", type: "text", showWhen: { field: "place", equals: "Other" } },
    ]);
    expect(own?.showWhen).toBeUndefined();
    expect(other?.showWhen).toEqual({ field: "place", equals: ["Other"] });
  });
});
