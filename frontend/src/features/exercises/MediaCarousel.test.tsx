// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import MediaCarousel from "./MediaCarousel";
import type { CatalogueMedia } from "../../types/catalogue";

const img = (id: number): CatalogueMedia => ({ id, kind: "image", content_type: "image/png", url: `/m/${id}` });
const vid = (id: number): CatalogueMedia => ({ id, kind: "video", content_type: "video/mp4", url: `/m/${id}` });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("MediaCarousel", () => {
  it("shows the animated icon when nothing is uploaded", () => {
    const { container } = render(<MediaCarousel media={[]} motion="press" alt="Bench Press" />);
    expect(container.querySelector(".cat-detail-icon svg")).toBeTruthy();
    expect(container.querySelector("img, video")).toBeNull();
  });

  it("slides through pictures by itself, ends on the video and waits there", () => {
    const { container } = render(<MediaCarousel media={[img(1), img(2), vid(3)]} motion="press" alt="Bench Press" intervalMs={1000} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/m/1");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/m/2");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/m/3");
    act(() => { vi.advanceTimersByTime(10_000); });                       // a video is never auto-advanced
    expect(container.querySelector("video")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("a single picture has no dots or arrows", () => {
    render(<MediaCarousel media={[img(1)]} motion="press" alt="Bench Press" />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});
