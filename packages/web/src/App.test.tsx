import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  it("renders under happy-dom, proving the web Vitest project is wired", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /stone soup/i })).toBeInTheDocument();
  });
});
