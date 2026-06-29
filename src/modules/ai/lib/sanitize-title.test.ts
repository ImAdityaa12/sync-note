import { describe, expect, it } from "vitest";

import { sanitizeTitle } from "./sanitize-title";

describe("sanitizeTitle", () => {
  it("passes a clean title through unchanged", () => {
    expect(sanitizeTitle("Project Roadmap")).toBe("Project Roadmap");
  });

  it("strips surrounding straight and smart quotes", () => {
    expect(sanitizeTitle('"Project Roadmap"')).toBe("Project Roadmap");
    expect(sanitizeTitle("“Project Roadmap”")).toBe("Project Roadmap");
    expect(sanitizeTitle("'Project Roadmap'")).toBe("Project Roadmap");
  });

  it("drops trailing sentence punctuation", () => {
    expect(sanitizeTitle("Project Roadmap.")).toBe("Project Roadmap");
    expect(sanitizeTitle("Is This A Title?")).toBe("Is This A Title");
  });

  it("takes only the first line and collapses whitespace", () => {
    expect(sanitizeTitle("Project   Roadmap\nSome rambling explanation")).toBe(
      "Project Roadmap"
    );
  });

  it("returns empty string when nothing usable remains", () => {
    expect(sanitizeTitle('   "".  ')).toBe("");
    expect(sanitizeTitle("")).toBe("");
  });
});
