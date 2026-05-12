import { describe, expect, it } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach } from "vitest";
import { App } from "../../src/App";

afterEach(cleanup);

describe("App shell", () => {
  it("renders the four pane placeholders", () => {
    render(<App />);
    expect(screen.getByTestId("tree-panel")).toBeInTheDocument();
    expect(screen.getByTestId("render-panel")).toBeInTheDocument();
    expect(screen.getByTestId("detail-panel")).toBeInTheDocument();
    // BottomDrawer is hidden by default; toolbar exposes the toggle.
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
  });

  it("toggles the bottom drawer through the toolbar", () => {
    render(<App />);
    const toggle = screen.getByRole("button", { name: /show drawer/i });
    expect(screen.queryByTestId("bottom-drawer")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByTestId("bottom-drawer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide drawer/i })).toBeInTheDocument();
  });
});
