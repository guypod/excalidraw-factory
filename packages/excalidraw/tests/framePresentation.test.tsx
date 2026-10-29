import React from "react";

import { CODES, KEYS, reseed } from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import { Excalidraw } from "../index";
import { editorJotaiStore } from "../editor-jotai";
import {
  framePresentationAtom,
  getPresentationSlides,
  startFramePresentation,
} from "../components/FramePresentation";

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

const createFrame = (name: string, x: number, y: number) => ({
  ...API.createElement({ type: "frame", x, y, width: 400, height: 300 }),
  name,
});

const createChild = (frameId: string, x: number, y: number) =>
  API.createElement({
    type: "rectangle",
    x: x + 20,
    y: y + 20,
    width: 100,
    height: 80,
    frameId,
  });

/** frames inserted out of reading order, plus one with nothing in it */
const createScene = () => {
  const outro = createFrame("Outro", 0, 1000);
  const second = createFrame("Second", 600, 0);
  const intro = createFrame("Intro", 0, 0);
  const empty = createFrame("Empty", 0, 2000);
  API.updateScene({
    elements: [
      outro,
      createChild(outro.id, 0, 1000),
      second,
      createChild(second.id, 600, 0),
      intro,
      createChild(intro.id, 0, 0),
      empty,
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return { intro, second, outro, empty };
};

const isPresenting = () => !!editorJotaiStore.get(framePresentationAtom);

const getStatus = () =>
  document.querySelector("[data-testid='frame-presentation-status']")
    ?.textContent;

const start = async () => {
  act(() => startFramePresentation(h.app));
  await waitFor(() =>
    expect(document.querySelector(".FramePresentation")).not.toBeNull(),
  );
};

describe("getPresentationSlides", () => {
  it("orders frames top to bottom, then left to right, then by id", () => {
    const a = { ...createFrame("A", 500, 0), id: "b" };
    const b = { ...createFrame("B", 500, 0), id: "a" };
    const c = createFrame("C", 0, 0);
    const d = createFrame("D", 0, 500);
    const children = [a, b, c, d].map((frame) =>
      createChild(frame.id, frame.x, frame.y),
    );

    const titles = (elements: any[]) =>
      getPresentationSlides(elements).map((slide) => slide.title);

    expect(titles([d, a, b, c, ...children])).toEqual(["C", "B", "A", "D"]);
    // same order whatever the scene order
    expect(titles([...children, c, b, a, d])).toEqual(["C", "B", "A", "D"]);
  });

  it("skips deleted frames and frames with only deleted children", () => {
    const kept = createFrame("Kept", 0, 0);
    const deleted = { ...createFrame("Deleted", 0, 500), isDeleted: true };
    const emptied = createFrame("Emptied", 0, 1000);
    const elements = [
      kept,
      createChild(kept.id, 0, 0),
      deleted,
      createChild(deleted.id, 0, 500),
      emptied,
      { ...createChild(emptied.id, 0, 1000), isDeleted: true },
    ];
    expect(getPresentationSlides(elements as any).map((s) => s.title)).toEqual([
      "Kept",
    ]);
  });
});

describe("<FramePresentation/>", () => {
  beforeEach(async () => {
    unmountComponent();
    reseed(7);
    await render(<Excalidraw handleKeyboardGlobally={true} />);
  });

  afterEach(() => {
    act(() => editorJotaiStore.set(framePresentationAtom, null));
  });

  it("steps through non-empty frames in order with the keyboard", async () => {
    createScene();
    const before = h.elements.map((el) => [el.id, el.version]);
    await start();

    expect(getStatus()).toBe("Intro1 of 3");
    const introViewport = { scrollX: h.state.scrollX, zoom: h.state.zoom };

    Keyboard.keyPress(KEYS.ARROW_RIGHT);
    await waitFor(() => expect(getStatus()).toBe("Second2 of 3"));
    expect(h.state.scrollX).not.toBe(introViewport.scrollX);

    Keyboard.keyPress(KEYS.PAGE_DOWN);
    await waitFor(() => expect(getStatus()).toBe("Outro3 of 3"));

    // stays on the last frame
    Keyboard.keyPress(KEYS.SPACE);
    expect(getStatus()).toBe("Outro3 of 3");

    Keyboard.keyPress(KEYS.ARROW_LEFT);
    await waitFor(() => expect(getStatus()).toBe("Second2 of 3"));
    Keyboard.keyPress("Home");
    await waitFor(() => expect(getStatus()).toBe("Intro1 of 3"));
    // back on the first frame, the viewport is where it was the first time
    expect(h.state.scrollX).toBe(introViewport.scrollX);
    expect(h.state.zoom).toEqual(introViewport.zoom);
    Keyboard.keyPress("End");
    await waitFor(() => expect(getStatus()).toBe("Outro3 of 3"));

    // presenting never touches the scene
    expect(h.elements.map((el) => [el.id, el.version])).toEqual(before);
  });

  it("restores the previous viewport on Escape, and the editor keeps working", async () => {
    createScene();
    API.setAppState({
      scrollX: 123,
      scrollY: -45,
      zoom: { value: 0.7 as any },
      viewModeEnabled: false,
    });
    await start();
    Keyboard.keyPress(KEYS.ARROW_RIGHT);
    await waitFor(() => expect(getStatus()).toBe("Second2 of 3"));
    expect(h.state.scrollX).not.toBe(123);

    Keyboard.keyPress(KEYS.ESCAPE);

    await waitFor(() => expect(isPresenting()).toBe(false));
    expect(document.querySelector(".FramePresentation")).toBeNull();
    expect(h.state.scrollX).toBe(123);
    expect(h.state.scrollY).toBe(-45);
    expect(h.state.zoom.value).toBe(0.7);
    expect(h.state.viewModeEnabled).toBe(false);
    expect(
      document
        .querySelector(".excalidraw-container")
        ?.classList.contains("excalidraw--presenting"),
    ).toBe(false);

    // shortcuts reach the editor again once the presentation is gone
    Keyboard.keyPress(KEYS.R);
    expect(h.state.activeTool.type).toBe("rectangle");
  });

  it("restores the viewport from the Exit button", async () => {
    createScene();
    API.setAppState({ scrollX: 10, scrollY: 20, zoom: { value: 1.5 as any } });
    await start();

    fireEvent.click(
      document.querySelector(".FramePresentation__exit") as HTMLElement,
    );

    await waitFor(() => expect(isPresenting()).toBe(false));
    expect([h.state.scrollX, h.state.scrollY, h.state.zoom.value]).toEqual([
      10, 20, 1.5,
    ]);
  });

  it("keeps editing shortcuts away from the drawing while presenting", async () => {
    const { intro } = createScene();
    API.setSelectedElements([
      h.elements.find((el) => el.frameId === intro.id)!,
    ]);
    const before = h.elements.map((el) => ({ id: el.id, version: el.version }));
    const selectedBefore = h.state.selectedElementIds;
    const toolBefore = h.state.activeTool.type;
    await start();

    Keyboard.keyPress(KEYS.DELETE);
    Keyboard.keyPress(KEYS.BACKSPACE);
    Keyboard.keyPress(KEYS.R);
    Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress(KEYS.Z));
    Keyboard.withModifierKeys({ ctrl: true }, () => Keyboard.keyPress(KEYS.A));

    expect(
      h.elements.map((el) => ({ id: el.id, version: el.version })),
    ).toEqual(before);
    expect(h.elements.every((el) => !el.isDeleted)).toBe(true);
    expect(h.state.activeTool.type).toBe(toolBefore);

    Keyboard.keyPress(KEYS.ESCAPE);
    await waitFor(() => expect(isPresenting()).toBe(false));
    // selection survives the presentation
    expect(h.state.selectedElementIds).toEqual(selectedBefore);
  });

  it("drops frames deleted or emptied during the presentation", async () => {
    const { second, outro } = createScene();
    await start();
    Keyboard.keyPress(KEYS.ARROW_RIGHT);
    await waitFor(() => expect(getStatus()).toBe("Second2 of 3"));

    act(() => {
      API.updateElement(second, { isDeleted: true });
    });
    // the frame now at the same position takes its place
    await waitFor(() => expect(getStatus()).toBe("Outro2 of 2"));

    const outroChild = h.elements.find((el) => el.frameId === outro.id)!;
    act(() => {
      API.updateElement(outroChild, { isDeleted: true });
    });
    await waitFor(() => expect(getStatus()).toBe("Intro1 of 1"));
  });

  it("shows guidance and still exits when there are no frames to present", async () => {
    API.setElements([API.createElement({ type: "rectangle" })]);
    API.setAppState({ scrollX: 5, scrollY: 6 });
    await start();

    expect(
      document.querySelector("[data-testid='frame-presentation-empty']")
        ?.textContent,
    ).toContain("No frames to present");
    expect([h.state.scrollX, h.state.scrollY]).toEqual([5, 6]);

    Keyboard.keyPress(KEYS.ESCAPE);
    await waitFor(() => expect(isPresenting()).toBe(false));
    expect([h.state.scrollX, h.state.scrollY]).toEqual([5, 6]);
  });

  it("is a labelled dialog that takes focus and returns it to the editor", async () => {
    createScene();
    await start();

    const dialog = document.querySelector(".FramePresentation") as HTMLElement;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Present frames");
    expect(document.activeElement).toBe(dialog);
    expect(
      Array.from(dialog.querySelectorAll("button")).map(
        (button) => button.getAttribute("aria-label") || button.textContent,
      ),
    ).toEqual(["Previous frame", "Next frame", "Exit presentation"]);

    Keyboard.keyPress(KEYS.ESCAPE);
    await waitFor(() => expect(isPresenting()).toBe(false));
    expect(document.activeElement).toBe(
      document.querySelector(".excalidraw-container"),
    );
  });

  it("leaves browser zoom shortcuts to the browser", async () => {
    createScene();
    await start();
    const dialog = document.querySelector(".FramePresentation") as HTMLElement;
    expect(document.activeElement).toBe(dialog);

    for (const [key, code] of [
      ["=", CODES.EQUAL],
      ["-", CODES.MINUS],
      ["0", CODES.ZERO],
    ]) {
      // fireEvent returns false when the default action was prevented
      expect(fireEvent.keyDown(dialog, { key, code, ctrlKey: true })).toBe(
        true,
      );
    }
    // without a modifier, the same keys still never reach the editor
    expect(fireEvent.keyDown(dialog, { key: "-", code: CODES.MINUS })).toBe(
      false,
    );
    expect(isPresenting()).toBe(true);
  });

  it("presents only in the editor that started it", async () => {
    createScene();
    API.setAppState({ scrollX: 30, scrollY: 40 });
    act(() =>
      editorJotaiStore.set(framePresentationAtom, {
        editorId: "another-editor",
        savedViewport: {
          scrollX: 999,
          scrollY: 999,
          zoom: { value: 3 as any },
        },
      }),
    );
    // re-render this editor so it reads the atom
    act(() => API.setAppState({ scrollX: 30 }));

    expect(document.querySelector(".FramePresentation")).toBeNull();
    expect(
      document
        .querySelector(".excalidraw-container")
        ?.classList.contains("excalidraw--presenting"),
    ).toBe(false);
    Keyboard.keyPress(KEYS.R);
    expect(h.state.activeTool.type).toBe("rectangle");
    expect([h.state.scrollX, h.state.scrollY]).toEqual([30, 40]);
  });

  it("ends the presentation when its editor unmounts", async () => {
    createScene();
    await start();
    expect(isPresenting()).toBe(true);

    unmountComponent();
    expect(isPresenting()).toBe(false);

    // a new editor starts without a presentation
    await render(<Excalidraw handleKeyboardGlobally={true} />);
    expect(document.querySelector(".FramePresentation")).toBeNull();
  });
});
