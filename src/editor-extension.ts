import { Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { Tracker } from './tracker';

function filePath(view: EditorView): string | null {
	return view.state.field(editorInfoField, false)?.file?.path ?? null;
}

/**
 * Reports every editor change to the tracker, with whether CodeMirror tagged
 * it as the writer's own input (typing, deleting, undo, paste). Reloads after
 * sync and edits made by plugins carry no such tag.
 */
/**
 * The file shown in the editor a DOM event happened in, or null. Works for
 * events from any window (no instanceof checks across popout windows).
 */
export function editorPathForEvent(evt: Event): string | null {
	const target = evt.target as { nodeType?: number; parentElement?: Element | null; closest?: unknown } | null;
	if (!target || typeof target.nodeType !== 'number') return null;
	const el = target.nodeType === 1 ? (target as Element) : (target.parentElement ?? null);
	const dom = el?.closest('.cm-editor');
	if (!dom) return null;
	const view = EditorView.findFromDOM(dom as HTMLElement);
	return view ? filePath(view) : null;
}

export function trackerExtension(tracker: Tracker) {
	const reportChanges = ViewPlugin.fromClass(
		class {
			constructor(private view: EditorView) {
				tracker.trackView(view, filePath(view));
			}

			update(update: ViewUpdate): void {
				const path = filePath(update.view);
				if (!update.docChanged) {
					tracker.trackView(update.view, path);
					return;
				}
				const userInput = update.transactions.some(
					(tr) => tr.annotation(Transaction.userEvent) !== undefined,
				);
				tracker.onEditorUpdate(update.view, path, update.startState.doc, update.state.doc, userInput);
			}

			destroy(): void {
				tracker.onViewClosed(this.view);
			}
		},
	);
	return reportChanges;
}
