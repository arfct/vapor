import { describe, it, expect } from "vitest";
import { imageLayoutStyle } from "~/shared/image-layout";

describe("imageLayoutStyle (#109)", () => {
  it("caps a floated image at a third of the column so text still has a measure", () => {
    expect(imageLayoutStyle({ width: "50%", align: "left" })).toContain("max-width: 33.333%");
    expect(imageLayoutStyle({ width: "50%", align: "right" })).toContain("max-width: 33.333%");
  });

  it("leaves an unfloated image uncapped", () => {
    expect(imageLayoutStyle({ width: "50%", align: "center" })).not.toContain("max-width");
    expect(imageLayoutStyle({ width: "full" })).not.toContain("max-width");
  });
});
