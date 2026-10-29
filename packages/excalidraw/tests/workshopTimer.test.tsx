import React from "react";

import { KEYS, reseed } from "@excalidraw/common";

import { CommandPalette, Excalidraw } from "../index";
import { editorJotaiStore } from "../editor-jotai";
import {
  formatTimerDuration,
  openWorkshopTimer,
  parseTimerMinutes,
  workshopTimerAtom,
} from "../components/WorkshopTimer/WorkshopTimer";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

const getPanel = () =>
  document.querySelector<HTMLElement>("[data-testid='workshop-timer']");

const getTime = () =>
  document.querySelector("[data-testid='workshop-timer-time']")?.textContent;

const getAnnouncement = () =>
  document.querySelector("[data-testid='workshop-timer-announcement']")
    ?.textContent;

const getMinutesInput = () =>
  getPanel()!.querySelector<HTMLInputElement>("input")!;

const clickButton = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const open = async () => {
  act(() => openWorkshopTimer(h.app));
  await waitFor(() => expect(getPanel()).not.toBeNull());
};

describe("formatTimerDuration", () => {
  it("rounds up to whole seconds and shows hours only when needed", () => {
    expect(formatTimerDuration(5 * 60000)).toBe("5:00");
    expect(formatTimerDuration(61001)).toBe("1:02");
    expect(formatTimerDuration(999)).toBe("0:01");
    expect(formatTimerDuration(0)).toBe("0:00");
    expect(formatTimerDuration(-5)).toBe("0:00");
    expect(formatTimerDuration(90 * 60000)).toBe("1:30:00");
  });
});

describe("parseTimerMinutes", () => {
  it("accepts whole minutes from 1 to 180", () => {
    expect(parseTimerMinutes("1")).toBe(1);
    expect(parseTimerMinutes("180")).toBe(180);
    expect(parseTimerMinutes("0")).toBe(null);
    expect(parseTimerMinutes("181")).toBe(null);
    expect(parseTimerMinutes("2.5")).toBe(null);
    expect(parseTimerMinutes("")).toBe(null);
  });
});

describe("<WorkshopTimer/>", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => editorJotaiStore.set(workshopTimerAtom, null));
  });

  it("is listed in the command palette", async () => {
    unmountComponent();
    await render(
      <Excalidraw handleKeyboardGlobally={true}>
        <CommandPalette />
      </Excalidraw>,
    );
    Keyboard.withModifierKeys({ ctrl: true, shift: true }, () => {
      Keyboard.keyPress(KEYS.P);
    });
    await waitFor(() =>
      expect(document.querySelector(".command-palette-dialog")).not.toBeNull(),
    );
    const input = document.querySelector<HTMLInputElement>(
      ".command-palette-dialog input",
    )!;
    fireEvent.change(input, { target: { value: "workshop timer" } });
    await waitFor(() =>
      expect(
        document.querySelector(".command-palette-dialog")!.textContent,
      ).toContain("Workshop timer"),
    );
    Keyboard.keyPress(KEYS.ENTER);
    await waitFor(() => expect(getPanel()).not.toBeNull());
  });

  it("counts down, pauses, resumes, resets and marks expiry", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await open();

    fireEvent.change(getMinutesInput(), { target: { value: "1" } });
    expect(getTime()).toBe("1:00");

    clickButton("Start");
    expect(getAnnouncement()).toBe("Timer started for 1:00");
    advance(10000);
    expect(getTime()).toBe("0:50");

    clickButton("Pause");
    expect(getAnnouncement()).toBe("Timer paused");
    advance(30000);
    expect(getTime()).toBe("0:50");

    clickButton("Resume");
    expect(getAnnouncement()).toBe("Timer resumed");
    advance(20000);
    expect(getTime()).toBe("0:30");

    clickButton("Reset");
    expect(getAnnouncement()).toBe("Timer reset");
    expect(getTime()).toBe("1:00");

    clickButton("Start");
    advance(60000);
    expect(getTime()).toBe("0:00");
    expect(getPanel()!.classList).toContain("WorkshopTimer--expired");
    expect(getPanel()!.textContent).toContain("Time is up");
    expect(getAnnouncement()).toBe("Time is up");
    // nothing keeps ticking once expired
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not announce the ticking time", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await open();
    clickButton("Start");
    const announcement = getAnnouncement();
    advance(30000);
    expect(getTime()).toBe("4:30");
    expect(getAnnouncement()).toBe(announcement);
  });

  it("starts with Enter in the minutes field and rejects bad durations", async () => {
    await open();
    expect(document.activeElement).toBe(getMinutesInput());

    fireEvent.change(getMinutesInput(), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    fireEvent.keyDown(getMinutesInput(), { key: KEYS.ENTER });
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();

    fireEvent.change(getMinutesInput(), { target: { value: "2" } });
    fireEvent.keyDown(getMinutesInput(), { key: KEYS.ENTER });
    expect(screen.getByRole("button", { name: "Pause" })).not.toBeNull();
  });

  it("does not take focus when time runs out", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await open();
    fireEvent.change(getMinutesInput(), { target: { value: "1" } });
    clickButton("Start");

    // the user goes back to drawing while the timer runs
    act(() => h.app.focusContainer());
    const focused = document.activeElement;
    expect(getPanel()!.contains(focused)).toBe(false);

    advance(60000);
    expect(getPanel()!.classList).toContain("WorkshopTimer--expired");
    expect(document.activeElement).toBe(focused);
  });

  it("leaves typing in the minutes field out of editor shortcuts", async () => {
    const rect = API.createElement({ type: "rectangle" });
    API.setElements([rect]);
    API.setSelectedElements([rect]);
    await open();

    fireEvent.keyDown(getMinutesInput(), { key: KEYS.DELETE });
    fireEvent.keyDown(getMinutesInput(), { key: KEYS.BACKSPACE });
    expect(h.elements[0].isDeleted).toBe(false);
  });

  it("closes with Escape, returns focus to the editor and stops the timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await open();
    clickButton("Start");
    expect(vi.getTimerCount()).toBe(1);

    fireEvent.keyDown(screen.getByRole("button", { name: "Pause" }), {
      key: KEYS.ESCAPE,
    });
    expect(getPanel()).toBeNull();
    expect(editorJotaiStore.get(workshopTimerAtom)).toBe(null);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.activeElement).toBe(
      document.querySelector(".excalidraw-container"),
    );
  });

  it("stops the timer when the close button is used", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await open();
    clickButton("Start");
    clickButton("Close timer");
    expect(getPanel()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes and stops the timer when the editor unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await open();
    clickButton("Start");
    expect(vi.getTimerCount()).toBe(1);

    unmountComponent();
    expect(editorJotaiStore.get(workshopTimerAtom)).toBe(null);
    expect(vi.getTimerCount()).toBe(0);
  });
});
