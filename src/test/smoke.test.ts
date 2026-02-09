import { describe, it, expect } from "vitest";
import fc from "fast-check";

describe("Test framework smoke test", () => {
  it("vitest runs correctly", () => {
    expect(1 + 1).toBe(2);
  });

  it("fast-check runs property tests", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
      { numRuns: 100 },
    );
  });
});
