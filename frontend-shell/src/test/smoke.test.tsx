import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fc from "fast-check";
import Home from "@/app/page";

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

  it("React Testing Library renders components", () => {
    render(<Home />);
    expect(screen.getByText("CashTrace")).toBeInTheDocument();
  });
});
