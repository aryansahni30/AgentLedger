import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge.js";

describe("StatusBadge", () => {
  it("renders status text with underscores replaced by spaces", () => {
    render(<StatusBadge status="awaiting_verification" />);
    expect(screen.getByText("awaiting verification")).toBeTruthy();
  });

  it("applies the correct CSS class for completed status", () => {
    const { container } = render(<StatusBadge status="completed" />);
    const badge = container.querySelector(".status-badge");
    expect(badge?.classList.contains("completed")).toBe(true);
  });

  it("applies the correct CSS class for failed status", () => {
    const { container } = render(<StatusBadge status="failed" />);
    const badge = container.querySelector(".status-badge");
    expect(badge?.classList.contains("failed")).toBe(true);
  });

  it("renders running status", () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText("running")).toBeTruthy();
  });

  it("renders pending status", () => {
    render(<StatusBadge status="pending" />);
    expect(screen.getByText("pending")).toBeTruthy();
  });
});
