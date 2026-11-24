import { describe, expect, it } from "vitest";
import { blockSizes, layoutOf } from "../src/content/block-layout.ts";

describe("how a block sits in a blocks field", () => {
  it("reads the layout saved with the block, and refuses what it does not know", () => {
    expect(layoutOf("image", { width: "wide", align: "left", space: "large" })).toEqual({
      width: "wide",
      align: "left",
      space: "large",
    });
    expect(layoutOf("image", { width: "huge", align: "top", space: "lots" })).toEqual({
      width: "content",
      align: "center",
      space: "normal",
    });
  });

  it("keeps a block saved before layouts looking as it did, from its own size and alignment", () => {
    expect(layoutOf("image", undefined, { size: "sm" })).toEqual({ width: "narrow", align: "center", space: "normal" });
    expect(layoutOf("video", undefined, { size: "lg" })).toEqual({ width: "wide", align: "center", space: "normal" });
    expect(layoutOf("image", undefined, { size: "content", objectPosition: "right" })).toEqual({
      width: "content",
      align: "right",
      space: "normal",
    });
    expect(layoutOf("button", undefined, { inlineAlignment: "left" })).toEqual({
      width: "content",
      align: "left",
      space: "normal",
    });
    expect(layoutOf("richtext", undefined, {})).toEqual({ width: "content", align: "center", space: "normal" });
  });

  it("downloads a block's pictures at the width it is drawn at", () => {
    expect(blockSizes("full")).toBe("100vw");
    expect(blockSizes("narrow")).toBe("(max-width: 480px) 100vw, 480px");
  });
});
