import React, { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScriptEditor, type ScriptEditorHandle } from "./ScriptEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const render = async (node: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(node);
  });

  return container;
};

const editorElement = () => {
  const editor = container?.querySelector(
    "[data-script-editor-root='true']",
  ) as HTMLDivElement | null;
  if (!editor) {
    throw new Error("Script editor was not rendered.");
  }
  return editor;
};

const setCaretOffset = (editor: HTMLDivElement, offset: number) => {
  const point = nodePositionForTest(editor, offset);
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const setEditorText = async (
  editor: HTMLDivElement,
  text: string,
  data = text.slice(-1),
) => {
  await act(async () => {
    editor.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data,
        inputType: "insertText",
      }),
    );
    editor.textContent = text;
    setCaretOffset(editor, text.length);
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data,
        inputType: "insertText",
      }),
    );
  });
};

const pressUndo = async (editor: HTMLDivElement) => {
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
      }),
    );
  });
};

const pressRedo = async (editor: HTMLDivElement) => {
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "z",
        metaKey: true,
        shiftKey: true,
      }),
    );
  });
};

const nodePositionForTest = (rootNode: HTMLElement, targetOffset: number) => {
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let node = walker.nextNode();

  while (node) {
    const length = node.textContent?.length ?? 0;
    if (currentOffset + length >= targetOffset) {
      return { node, offset: targetOffset - currentOffset };
    }
    currentOffset += length;
    node = walker.nextNode();
  }

  return { node: rootNode, offset: rootNode.childNodes.length };
};

describe("ScriptEditor custom history", () => {
  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    window.getSelection()?.removeAllRanges();
  });

  it("undoes and redoes a committed typing chunk", async () => {
    await render(<ScriptEditor value="" onChange={() => {}} />);
    const editor = editorElement();

    await setEditorText(editor, "hello ", " ");
    expect(editor.textContent).toBe("hello ");

    await pressUndo(editor);
    expect(editor.textContent).toBe("");

    await pressRedo(editor);
    expect(editor.textContent).toBe("hello ");
  });

  it("undoes expression pill insertions as plain-text snapshots", async () => {
    const ref = createRef<ScriptEditorHandle>();
    const Harness = () => {
      const [value, setValue] = useState("");
      return <ScriptEditor ref={ref} value={value} onChange={setValue} />;
    };

    await render(<Harness />);
    const editor = editorElement();

    await act(async () => {
      ref.current?.insertText("[clears throat]");
    });

    expect(editor.textContent).toBe("[clears throat]");
    expect(editor.querySelector("[data-expression-token]")).not.toBeNull();

    await pressUndo(editor);
    expect(editor.textContent).toBe("");

    await pressRedo(editor);
    expect(editor.textContent).toBe("[clears throat]");
    expect(editor.querySelector("[data-expression-token]")).not.toBeNull();
  });

  it("clears stale history when the controlled value changes externally", async () => {
    let setExternalValue: React.Dispatch<
      React.SetStateAction<string>
    > = () => {};
    const Harness = () => {
      const [value, setValue] = useState("");
      setExternalValue = setValue;
      return <ScriptEditor value={value} onChange={setValue} />;
    };

    await render(<Harness />);
    const editor = editorElement();
    await setEditorText(editor, "draft ", " ");

    await act(async () => {
      setExternalValue("External: reset");
    });
    expect(editor.textContent).toBe("External: reset");

    await pressUndo(editor);
    expect(editor.textContent).toBe("External: reset");
  });
});
