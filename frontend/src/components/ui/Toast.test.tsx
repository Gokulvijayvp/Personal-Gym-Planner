// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./Toast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Buttons({ onUndo }: { onUndo?: () => void }) {
  const t = useToast();
  return (
    <>
      <button onClick={() => t.success("Plain")}>plain</button>
      <button onClick={() => t.success("Removed A", { label: "Undo", onClick: () => onUndo?.() })}>a</button>
      <button onClick={() => t.success("Removed B", { label: "Undo", onClick: () => onUndo?.() })}>b</button>
    </>
  );
}

describe("toast with an action", () => {
  it("shows an Undo button that runs its action and dismisses the toast", async () => {
    const undo = vi.fn();
    render(<ToastProvider><Buttons onUndo={undo} /></ToastProvider>);
    await userEvent.click(screen.getByText("a"));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Removed A")).toBeNull();
  });

  it("a newer Undo replaces older Undo toasts but keeps plain ones", async () => {
    render(<ToastProvider><Buttons /></ToastProvider>);
    await userEvent.click(screen.getByText("plain"));
    await userEvent.click(screen.getByText("a"));
    await userEvent.click(screen.getByText("b"));
    expect(screen.queryByText("Removed A")).toBeNull();
    expect(screen.getByText("Removed B")).toBeTruthy();
    expect(screen.getByText("Plain")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("stays longer than a plain toast", async () => {
    vi.useFakeTimers();
    render(<ToastProvider><Buttons /></ToastProvider>);
    await act(async () => { screen.getByText("plain").click(); screen.getByText("a").click(); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByText("Plain")).toBeNull();           // plain: gone after 4 s
    expect(screen.getByText("Removed A")).toBeTruthy();        // undo: still there at 5 s
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText("Removed A")).toBeNull();
  });
});
