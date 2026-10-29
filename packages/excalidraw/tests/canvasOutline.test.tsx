import React from "react";

import {
  CANVAS_OUTLINE_TAB,
  DEFAULT_SIDEBAR,
  reseed,
} from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import {
  act,
  fireEvent,
  render,
  unmountComponent,
  waitFor,
} from "./test-utils";

const { h } = window;

const openOutline = async () => {
  act(() => {
    API.setAppState({
      openSidebar: { name: DEFAULT_SIDEBAR.name, tab: CANVAS_OUTLINE_TAB },
    });
  });
  await waitFor(() =>
    expect(document.querySelector(".CanvasOutline")).not.toBeNull(),
  );
};

const getItems = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-testid='canvas-outline-item']",
    ),
  );

const getItemNames = () =>
  getItems().map((el) => el.getAttribute("aria-label"));

const createScene = () => {
  const frame = {
    ...API.createElement({
      type: "frame",
      x: 0,
      y: 400,
      width: 300,
      height: 200,
    }),
    name: "Release plan",
  };
  const freeText = API.createElement({
    type: "text",
    x: 500,
    y: -100,
    text: "Kickoff notes\nsecond line",
  });
  const [box, boxLabel] = API.createTextContainer({
    label: { text: "Decision" },
  });
  const unlabelled = API.createElement({ type: "ellipse", x: 900, y: 900 });
  // captured, so undo in the tests below stops at this starting scene
  API.updateScene({
    elements: [frame, freeText, box, boxLabel, unlabelled],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { frame, freeText, box, boxLabel, unlabelled };
};

describe("<CanvasOutline/>", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  it("shows empty-state guidance when nothing can be outlined", async () => {
    API.setElements([API.createElement({ type: "rectangle" })]);
    await openOutline();

    expect(getItems()).toHaveLength(0);
    const status = document.querySelector(".CanvasOutline [role='status']");
    expect(status?.textContent).toContain("Nothing to outline yet");
  });

  it("lists frames, free text and labelled containers with accessible names", async () => {
    const { box, boxLabel, unlabelled } = createScene();
    await openOutline();

    expect(getItemNames()).toEqual([
      "Frame: Release plan",
      "Labelled element: Kickoff notes second line",
      "Labelled element: Decision",
    ]);
    const ids = getItems().map((el) => el.dataset.outlineId);
    // bound text is reached through its container, unlabelled shapes are skipped
    expect(ids).toContain(box.id);
    expect(ids).not.toContain(boxLabel.id);
    expect(ids).not.toContain(unlabelled.id);

    expect(
      document
        .querySelector(".CanvasOutline [role='listbox']")
        ?.getAttribute("aria-label"),
    ).toBe("Canvas outline");
    // single roving tab stop
    expect(getItems().map((el) => el.tabIndex)).toEqual([0, -1, -1]);
  });

  it("selects and zooms to an item from the keyboard without mutating elements", async () => {
    const { box } = createScene();
    const before = h.elements.map((el) => ({ ...el }));
    API.setAppState({ scrollX: 0, scrollY: 0 });
    await openOutline();

    const [first] = getItems();
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(getItems()[2]);
    expect(getItems()[2].tabIndex).toBe(0);

    fireEvent.keyDown(document.activeElement!, { key: "Enter" });

    await waitFor(() => {
      expect(h.state.selectedElementIds).toEqual({ [box.id]: true });
    });
    expect(getItems()[2].getAttribute("aria-selected")).toBe("true");
    // the viewport moved to the element
    await waitFor(() =>
      expect([h.state.scrollX, h.state.scrollY]).not.toEqual([0, 0]),
    );

    // arrows inside the outline must not nudge the selected element
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(h.elements).toEqual(before);
  });

  it("updates after edits, deletion, undo and redo", async () => {
    const { frame, freeText } = createScene();
    await openOutline();
    expect(getItems()).toHaveLength(3);

    act(() => {
      API.updateElement(frame, { name: "Renamed frame" });
    });
    await waitFor(() => expect(getItemNames()[0]).toBe("Frame: Renamed frame"));

    API.setSelectedElements([freeText]);
    act(() => {
      Keyboard.keyPress("Delete");
    });
    await waitFor(() => expect(getItems()).toHaveLength(2));
    expect(getItemNames()).not.toContain(
      "Labelled element: Kickoff notes second line",
    );

    act(() => {
      Keyboard.undo();
    });
    await waitFor(() => expect(getItems()).toHaveLength(3));

    act(() => {
      Keyboard.redo();
    });
    await waitFor(() => expect(getItems()).toHaveLength(2));
  });

  it("opens from its sidebar tab", async () => {
    createScene();
    act(() => {
      API.setAppState({
        openSidebar: { name: DEFAULT_SIDEBAR.name, tab: "search" },
      });
    });
    const tab = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(
        "[data-testid='canvas-outline-tab']",
      );
      expect(el).not.toBeNull();
      return el!;
    });
    expect(tab.getAttribute("aria-label")).toBe("Canvas outline");
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    await waitFor(() =>
      expect(h.state.openSidebar?.tab).toBe(CANVAS_OUTLINE_TAB),
    );
  });
});
