// Stand-in for @codemirror/state and @codemirror/view in browser previews.
export const Transaction = { userEvent: {} };
export const EditorView = { domEventHandlers: () => ({}) };
export const ViewPlugin = { fromClass: () => ({}) };
