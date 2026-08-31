import { describe, it, expect } from "vitest";
import routes from "~/routes";

describe("route table", () => {
  it("serves documents at /:id, not /docs/:id", () => {
    const flat = JSON.stringify(routes);
    expect(flat).toContain('":id"');
    expect(flat).not.toContain("docs/:id");
  });
});
