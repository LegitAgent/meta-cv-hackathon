// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WikiHelp } from "../src/panel/components/WikiHelp";

afterEach(() => cleanup());

it("focuses the dialog, traps Tab, and closes on Escape", () => {
  const onClose = vi.fn();
  render(<WikiHelp open onClose={onClose} />);
  const dialog = screen.getByRole("dialog");
  expect(document.activeElement).toBe(dialog);
  const links = screen.getAllByRole("link");
  const close = screen.getByRole("button", { name: "Close guide" });
  links[links.length - 1].focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  close.focus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(links[links.length - 1]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
