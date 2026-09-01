import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import type { DocumentContextValue } from "~/lib/DocumentContext";
import { vi } from "vitest";

// Re-export the context internals for testing — we need to wrap with the raw
// React context (not DocumentProvider, which brings real hooks).
// We reach into the module to get the context object itself.
// Instead, we build a lightweight wrapper that provides the value directly.

import { createElement } from "react";

// We can't import the raw context object (it's not exported), so we create
// a test-only provider that renders DocumentContext.Provider via a small trick:
// we render a component that calls useDocument() — but for testing we actually
// want to provide a mock value without running real hooks.
//
// The cleanest approach: export a TestDocumentProvider from the context module,
// or just re-create the context here. Since we don't want to pollute the prod
// module, we'll import and re-use the context by exporting it.
//
// Actually, the simplest approach: we'll add a named export for the context
// from DocumentContext.tsx. But to keep prod clean, we instead just render
// the children inside a context provider created from the same createContext.
//
// Final approach: We'll use a wrapper component that provides the value
// through React context. We need the same context object. Let's just export
// it from DocumentContext.tsx as _DocumentContext for testing.

// For now, we use a different approach: render with a wrapper that provides
// the context value. We import the internal context via a test-only export.
import { _DocumentContext } from "~/lib/DocumentContext";

export function createMockDocumentContext(
  overrides: Partial<DocumentContextValue> = {},
): DocumentContextValue {
  return {
    docId: "test-doc",
    createdAt: Date.now(),
    yjs: {
      doc: {} as DocumentContextValue["yjs"]["doc"],
      awareness: {} as DocumentContextValue["yjs"]["awareness"],
      socket: null as DocumentContextValue["yjs"]["socket"],
      synced: true,
      asleep: false,
      user: { name: "Test User", color: "#000", colorLight: "#ccc" },
      mode: "edit" as const,
      setMode: vi.fn(),
      docState: {} as DocumentContextValue["yjs"]["docState"],
    },
    editorInstance: null,
    markdown: "",
    mode: "edit",
    setMode: vi.fn(),
    toggleMode: vi.fn(),
    showPreview: false,
    togglePreview: vi.fn(),
    setPreviewHeld: vi.fn(),
    commentActive: false,
    commentSelection: null,
    commentHighlight: null,
    openCommentInput: vi.fn(),
    handleCommentActiveChange: vi.fn(),
    activateComment: vi.fn(),
    handleResolveAtCursor: vi.fn(),
    handleDeleteAtCursor: vi.fn(),
    threads: [],
    activeThreadId: null,
    setActiveThreadId: vi.fn(),
    activeCommentRange: null,
    addReply: vi.fn(),
    resolveThread: vi.fn(),
    deleteThread: vi.fn(),
    handleEditorReady: vi.fn(),
    handleCommentClick: vi.fn(),
    ...overrides,
  };
}

export function renderWithDocument(
  ui: ReactElement,
  {
    context: contextOverrides,
    ...renderOptions
  }: RenderOptions & { context?: Partial<DocumentContextValue> } = {},
) {
  const contextValue = createMockDocumentContext(contextOverrides);

  function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(
      _DocumentContext.Provider,
      { value: contextValue },
      children,
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    contextValue,
  };
}
