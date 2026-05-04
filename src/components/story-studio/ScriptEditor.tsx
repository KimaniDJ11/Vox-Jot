import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

const scriptTitle = "Script";
const scriptDescription =
  "Use one line per spoken part in Character: dialogue format.";

export interface ScriptTextSelection {
  start: number;
  end: number;
  lineNumber: number;
}

export interface ScriptEditorHandle {
  focus: () => void;
  insertText: (text: string) => void;
}

interface ScriptEditorProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onCursorChange?: (selection: ScriptTextSelection) => void;
}

export const ScriptEditor = forwardRef<ScriptEditorHandle, ScriptEditorProps>(({
  value,
  disabled = false,
  onChange,
  onCursorChange,
}, ref) => {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const latestValueRef = useRef(value);
  const draggedTokenRef = useRef<{ token: string; sourceOffset: number } | null>(
    null,
  );
  const pointerDragRef = useRef<{
    token: string;
    sourceOffset: number;
    pointerId: number;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const lastSelectionRef = useRef<ScriptTextSelection>({
    start: value.length,
    end: value.length,
    lineNumber: lineNumberAtOffset(value, value.length),
  });

  latestValueRef.current = value;

  const insertText = (text: string) => {
    const editor = editorRef.current;
    if (!editor || disabled) return;

    const source = latestValueRef.current;
    const selection = clampSelection(lastSelectionRef.current, source);
    const next =
      source.slice(0, selection.start) + text + source.slice(selection.end);
    const nextOffset = selection.start + text.length;
    const nextSelection = {
      start: nextOffset,
      end: nextOffset,
      lineNumber: lineNumberAtOffset(next, nextOffset),
    };

    lastSelectionRef.current = nextSelection;
    onChange(next);
    renderDecoratedText(editor, next);
    editor.focus();
    restoreSelection(editor, nextSelection);
    onCursorChange?.(nextSelection);
  };

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || plainText(editor) === value) {
      return;
    }
    renderDecoratedText(editor, value);
    restoreSelection(editor, lastSelectionRef.current);
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.focus(),
      insertText,
    }),
    [insertText],
  );

  const updateSelection = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextSelection = currentSelection(editor);
    lastSelectionRef.current = nextSelection;
    onCursorChange?.(nextSelection);
  };

  const handleInput = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = plainText(editor);
    const nextSelection = currentSelection(editor);
    lastSelectionRef.current = nextSelection;
    onChange(next);
    renderDecoratedText(editor, next);
    restoreSelection(editor, nextSelection);
    onCursorChange?.(nextSelection);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    insertText("\n");
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text) {
      return;
    }

    event.preventDefault();
    insertText(text);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor || disabled) return;

    const draggedToken = draggedTokenRef.current;
    const token = draggedToken?.token ?? event.dataTransfer.getData("text/plain");
    const sourceOffset =
      draggedToken?.sourceOffset ??
      Number.parseInt(
        event.dataTransfer.getData("application/x-vox-jot-tag-offset"),
        10,
      );
    if (!token) return;

    event.preventDefault();
    const dropOffset = offsetFromPoint(editor, event.clientX, event.clientY);

    moveToken(token, sourceOffset, dropOffset);
    draggedTokenRef.current = null;
  };

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-expression-token]")
      : null;
    if (!editor || !target || !editor.contains(target)) {
      return;
    }

    const token = target.dataset.expressionToken ?? target.textContent ?? "";
    if (!token) {
      return;
    }

    const sourceOffset = offsetForElement(editor, target);
    draggedTokenRef.current = { token, sourceOffset };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", token);
    event.dataTransfer.setData(
      "application/x-vox-jot-tag-offset",
      String(sourceOffset),
    );
    event.dataTransfer.setDragImage(target, 8, 8);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-expression-token]")
      : null;
    if (!editor || !target || !editor.contains(target) || event.button !== 0) {
      return;
    }

    const token = target.dataset.expressionToken ?? target.textContent ?? "";
    if (!token) {
      return;
    }

    event.preventDefault();
    editor.focus();
    pointerDragRef.current = {
      token,
      sourceOffset: offsetForElement(editor, target),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
    };
    editor.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    );
    if (distance > 3) {
      drag.isDragging = true;
      event.preventDefault();
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const drag = pointerDragRef.current;
    if (!editor || !drag || drag.pointerId !== event.pointerId) {
      return;
    }

    pointerDragRef.current = null;
    if (editor.hasPointerCapture(event.pointerId)) {
      editor.releasePointerCapture(event.pointerId);
    }

    if (!drag.isDragging) {
      return;
    }

    event.preventDefault();
    moveToken(
      drag.token,
      drag.sourceOffset,
      offsetFromPoint(editor, event.clientX, event.clientY),
    );
  };

  const moveToken = (token: string, sourceOffset: number, dropOffset: number) => {
    const editor = editorRef.current;
    if (!editor || disabled) return;

    const current = latestValueRef.current;
    if (
      !Number.isFinite(sourceOffset) ||
      sourceOffset < 0 ||
      current.slice(sourceOffset, sourceOffset + token.length) !== token
    ) {
      return;
    }

    if (dropOffset >= sourceOffset && dropOffset <= sourceOffset + token.length) {
      return;
    }

    let next =
      current.slice(0, sourceOffset) +
      current.slice(sourceOffset + token.length);
    if (sourceOffset < dropOffset) {
      dropOffset = Math.max(0, dropOffset - token.length);
    }

    dropOffset = Math.min(Math.max(dropOffset, 0), next.length);
    next = next.slice(0, dropOffset) + token + next.slice(dropOffset);
    const nextOffset = dropOffset + token.length;
    const nextSelection = {
      start: nextOffset,
      end: nextOffset,
      lineNumber: lineNumberAtOffset(next, nextOffset),
    };

    lastSelectionRef.current = nextSelection;
    onChange(next);
    renderDecoratedText(editor, next);
    editor.focus();
    restoreSelection(editor, nextSelection);
    onCursorChange?.(nextSelection);
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">
          {scriptTitle}
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">{scriptDescription}</p>
      </div>
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label={scriptTitle}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={true}
        data-script-editor-root="true"
        className={`min-h-[180px] w-full resize-y overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-start font-mono text-[13px] font-medium leading-6 text-[var(--text)] outline-none transition-[background-color,border-color,box-shadow] duration-150 empty:before:pointer-events-none empty:before:text-[var(--muted)] empty:before:content-[attr(data-placeholder)] hover:border-[var(--accent)] hover:bg-[var(--bg)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-glow)] lg:min-h-[220px] ${
          disabled ? "cursor-not-allowed opacity-60" : ""
        }`}
        data-placeholder={t("storyStudio.script.placeholder")}
        onBeforeInput={(event) => {
          const inputEvent = event.nativeEvent as InputEvent;
          if (
            inputEvent.inputType !== "insertParagraph" &&
            inputEvent.inputType !== "insertLineBreak"
          ) {
            return;
          }
          event.preventDefault();
          insertText("\n");
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={updateSelection}
        onMouseUp={updateSelection}
        onFocus={updateSelection}
        onPaste={handlePaste}
        onDragStart={handleDragStart}
        onDragEnd={() => {
          draggedTokenRef.current = null;
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pointerDragRef.current = null;
        }}
        onDrop={handleDrop}
        onDragOver={(event) => {
          if (!disabled) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
      />
    </section>
  );
});

ScriptEditor.displayName = "ScriptEditor";

const EXPRESSION_TOKEN_PATTERN = /(\[[^\]\n]{1,80}\]|\([^()\n]{1,80}\))/g;

function renderDecoratedText(editor: HTMLDivElement, text: string) {
  editor.replaceChildren();
  const lines = text.split("\n");
  lines.forEach((lineText) => {
    const line = document.createElement("div");
    line.dataset.scriptLine = "true";
    line.style.minHeight = "1.5rem";
    appendDecoratedLine(line, lineText);
    if (line.childNodes.length === 0) {
      line.append(document.createElement("br"));
    }
    editor.append(line);
  });
}

function appendDecoratedLine(line: HTMLDivElement, text: string) {
  let cursor = 0;
  for (const match of text.matchAll(EXPRESSION_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      line.append(document.createTextNode(text.slice(cursor, index)));
    }
    const token = match[0];
    const span = document.createElement("span");
    span.textContent = token;
    span.draggable = false;
    span.contentEditable = "false";
    span.dataset.expressionToken = token;
    span.dataset.offset = String(index);
    span.className =
      "mx-0.5 inline-flex touch-none cursor-grab select-none items-center rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 font-sans text-[12px] font-semibold text-[var(--accent)] active:cursor-grabbing";
    line.append(span);
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    line.append(document.createTextNode(text.slice(cursor)));
  }
}

function plainText(node: Node): string {
  if (isEditorRoot(node)) {
    const lines = lineElements(node);
    if (lines.length > 0) {
      return lines.map(lineText).join("\n");
    }
  }

  if (isLineElement(node)) {
    return lineText(node);
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node instanceof HTMLBRElement) {
    return "\n";
  }

  return Array.from(node.childNodes).map(plainText).join("");
}

function lineText(line: Element): string {
  return Array.from(line.childNodes)
    .map((child) => {
      if (child instanceof HTMLBRElement) {
        return "";
      }
      return plainText(child);
    })
    .join("");
}

function currentSelection(editor: HTMLDivElement): ScriptTextSelection {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    const end = plainText(editor).length;
    return { start: end, end, lineNumber: lineNumberAtOffset(plainText(editor), end) };
  }
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    const end = plainText(editor).length;
    return { start: end, end, lineNumber: lineNumberAtOffset(plainText(editor), end) };
  }

  const start = offsetForNodePosition(editor, range.startContainer, range.startOffset);
  const end = offsetForNodePosition(editor, range.endContainer, range.endOffset);
  const text = plainText(editor);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    lineNumber: lineNumberAtOffset(text, Math.min(start, end)),
  };
}

function offsetForNodePosition(root: HTMLElement, node: Node, offset: number): number {
  const line = closestLineElement(root, node);
  if (line) {
    let lineOffset = 0;
    for (const candidate of lineElements(root)) {
      if (candidate === line) {
        return lineOffset + offsetWithinLine(line, node, offset);
      }
      lineOffset += lineText(candidate).length + 1;
    }
  }

  let currentOffset = 0;
  let found = false;

  const walk = (current: Node): boolean => {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        currentOffset += Math.min(offset, current.textContent?.length ?? 0);
      } else {
        const children = Array.from(current.childNodes);
        for (const child of children.slice(0, offset)) {
          currentOffset += textLength(child);
        }
      }
      found = true;
      return true;
    }

    if (current.nodeType === Node.TEXT_NODE || current instanceof HTMLBRElement) {
      currentOffset += textLength(current);
      return false;
    }

    for (const child of Array.from(current.childNodes)) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  };

  walk(root);
  if (found) {
    return currentOffset;
  }
  return plainText(root).length;
}

function offsetForElement(root: HTMLElement, element: HTMLElement): number {
  const parent = element.parentNode;
  if (!parent) {
    return 0;
  }
  return offsetForNodePosition(root, parent, childIndex(element));
}

function restoreSelection(editor: HTMLDivElement, selection: ScriptTextSelection) {
  const start = Math.min(selection.start, plainText(editor).length);
  const end = Math.min(selection.end, plainText(editor).length);
  const startPoint = nodePositionAtOffset(editor, start);
  const endPoint = nodePositionAtOffset(editor, end);
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  const windowSelection = window.getSelection();
  windowSelection?.removeAllRanges();
  windowSelection?.addRange(range);
}

function nodePositionAtOffset(root: HTMLElement, targetOffset: number) {
  const lines = lineElements(root);
  if (lines.length > 0) {
    let currentOffset = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const length = lineText(line).length;
      if (targetOffset <= currentOffset + length) {
        return nodePositionWithinLine(line, targetOffset - currentOffset);
      }
      currentOffset += length;
      if (index < lines.length - 1) {
        if (targetOffset <= currentOffset + 1) {
          return nodePositionWithinLine(lines[index + 1], 0);
        }
        currentOffset += 1;
      }
    }
    return nodePositionWithinLine(lines[lines.length - 1], lineText(lines[lines.length - 1]).length);
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE || node instanceof HTMLBRElement) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    },
  );
  let currentOffset = 0;
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLBRElement) {
      if (currentOffset + 1 >= targetOffset) {
        const parent = node.parentNode ?? root;
        return { node: parent, offset: childIndex(node) + 1 };
      }
      currentOffset += 1;
      node = walker.nextNode();
      continue;
    }

    const length = node.textContent?.length ?? 0;
    if (currentOffset + length >= targetOffset) {
      return { node, offset: targetOffset - currentOffset };
    }
    currentOffset += length;
    node = walker.nextNode();
  }
  const fallback = root.lastChild ?? root;
  return { node: fallback, offset: fallback.textContent?.length ?? 0 };
}

function offsetWithinLine(line: HTMLElement, node: Node, offset: number): number {
  let currentOffset = 0;
  let found = false;

  const walk = (current: Node): boolean => {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        currentOffset += Math.min(offset, current.textContent?.length ?? 0);
      } else {
        const children = Array.from(current.childNodes);
        for (const child of children.slice(0, offset)) {
          currentOffset += textLengthWithinLine(child);
        }
      }
      found = true;
      return true;
    }

    if (current.nodeType === Node.TEXT_NODE || current instanceof HTMLBRElement) {
      currentOffset += textLengthWithinLine(current);
      return false;
    }

    for (const child of Array.from(current.childNodes)) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  };

  walk(line);
  return found ? currentOffset : lineText(line).length;
}

function nodePositionWithinLine(line: HTMLElement, targetOffset: number) {
  if (targetOffset <= 0 || lineText(line).length === 0) {
    return { node: line, offset: 0 };
  }

  let currentOffset = 0;
  for (const child of Array.from(line.childNodes)) {
    const length = textLengthWithinLine(child);
    if (targetOffset < currentOffset + length) {
      return nodePositionInsideNode(child, targetOffset - currentOffset);
    }
    if (targetOffset === currentOffset + length) {
      if (child.nodeType === Node.TEXT_NODE) {
        return { node: child, offset: child.textContent?.length ?? 0 };
      }
      return { node: line, offset: childIndex(child) + 1 };
    }
    currentOffset += length;
  }

  return { node: line, offset: line.childNodes.length };
}

function nodePositionInsideNode(node: Node, targetOffset: number) {
  if (node.nodeType === Node.TEXT_NODE) {
    return { node, offset: Math.min(targetOffset, node.textContent?.length ?? 0) };
  }

  let currentOffset = 0;
  for (const child of Array.from(node.childNodes)) {
    const length = textLengthWithinLine(child);
    if (targetOffset < currentOffset + length) {
      return nodePositionInsideNode(child, targetOffset - currentOffset);
    }
    if (targetOffset === currentOffset + length) {
      return { node, offset: childIndex(child) + 1 };
    }
    currentOffset += length;
  }

  return { node, offset: node.childNodes.length };
}

function textLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (node instanceof HTMLBRElement) {
    return 1;
  }
  return Array.from(node.childNodes).reduce((sum, child) => sum + textLength(child), 0);
}

function textLengthWithinLine(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (node instanceof HTMLBRElement) {
    return 0;
  }
  return Array.from(node.childNodes).reduce(
    (sum, child) => sum + textLengthWithinLine(child),
    0,
  );
}

function childIndex(node: Node): number {
  if (!node.parentNode) {
    return 0;
  }
  return Array.prototype.indexOf.call(node.parentNode.childNodes, node) as number;
}

function offsetFromPoint(editor: HTMLDivElement, x: number, y: number): number {
  const lines = lineElements(editor);
  if (lines.length === 0) {
    return caretOffsetFromPoint(editor, x, y);
  }

  let baseOffset = 0;
  let closestLine = lines[0];
  let closestBaseOffset = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const rect = line.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom) {
      return baseOffset + offsetWithinLineFromPoint(line, x);
    }

    const distance = Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestLine = line;
      closestBaseOffset = baseOffset;
    }

    baseOffset += lineText(line).length;
    if (index < lines.length - 1) {
      baseOffset += 1;
    }
  }

  return closestBaseOffset + offsetWithinLineFromPoint(closestLine, x);
}

function offsetWithinLineFromPoint(line: HTMLElement, x: number): number {
  let offset = 0;

  for (const child of Array.from(line.childNodes)) {
    const length = textLengthWithinLine(child);
    if (length === 0) {
      continue;
    }

    const rect = rectForNode(child);
    if (!rect) {
      offset += length;
      continue;
    }

    if (x < rect.left) {
      return offset;
    }

    if (x <= rect.right) {
      if (child.nodeType === Node.TEXT_NODE) {
        return offset + textNodeOffsetFromPoint(child, x);
      }
      return offset + (x < rect.left + rect.width / 2 ? 0 : length);
    }

    offset += length;
  }

  return lineText(line).length;
}

function rectForNode(node: Node): DOMRect | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  }

  if (node instanceof Element) {
    return node.getBoundingClientRect();
  }

  return null;
}

function textNodeOffsetFromPoint(node: Node, x: number): number {
  const text = node.textContent ?? "";
  for (let index = 0; index < text.length; index += 1) {
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    if (x < rect.left + rect.width / 2) {
      return index;
    }
  }
  return text.length;
}

function isEditorRoot(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.scriptEditorRoot === "true";
}

function isLineElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.scriptLine === "true";
}

function lineElements(root: Node): HTMLElement[] {
  return Array.from(root.childNodes).filter(isLineElement);
}

function closestLineElement(root: HTMLElement, node: Node): HTMLElement | null {
  if (isLineElement(node)) {
    return node;
  }
  if (node instanceof Element) {
    const line = node.closest<HTMLElement>("[data-script-line='true']");
    return line && root.contains(line) ? line : null;
  }
  const parent = node.parentElement;
  const line = parent?.closest<HTMLElement>("[data-script-line='true']") ?? null;
  return line && root.contains(line) ? line : null;
}

function caretOffsetFromPoint(editor: HTMLDivElement, x: number, y: number): number {
  const documentWithCaret = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  const range = documentWithCaret.caretRangeFromPoint?.(x, y);
  if (range && editor.contains(range.startContainer)) {
    return offsetForNodePosition(editor, range.startContainer, range.startOffset);
  }
  const position = documentWithCaret.caretPositionFromPoint?.(x, y);
  if (position && editor.contains(position.offsetNode)) {
    return offsetForNodePosition(editor, position.offsetNode, position.offset);
  }
  return currentSelection(editor).end;
}

function lineNumberAtOffset(text: string, offset: number): number {
  return text.slice(0, Math.max(0, offset)).split("\n").length;
}

function clampSelection(selection: ScriptTextSelection, text: string): ScriptTextSelection {
  return {
    start: Math.min(Math.max(selection.start, 0), text.length),
    end: Math.min(Math.max(selection.end, 0), text.length),
    lineNumber: lineNumberAtOffset(text, selection.start),
  };
}
