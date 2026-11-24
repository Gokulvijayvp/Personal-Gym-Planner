// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageHeader from "./PageHeader";

afterEach(cleanup);

describe("PageHeader back arrow", () => {
  it("links back to the given page", () => {
    render(<MemoryRouter><PageHeader eyebrow="PLANNING" title="Calendar" back={{ to: "/workout", label: "Workout" }} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Back to Workout" }).getAttribute("href")).toBe("/workout");
  });
  it("shows no back link unless asked", () => {
    render(<MemoryRouter><PageHeader eyebrow="X" title="Home" /></MemoryRouter>);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
