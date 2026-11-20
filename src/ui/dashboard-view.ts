import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { Novel } from '../types';
import { isNarrow } from './dashboard-block';

export const DASHBOARD_VIEW = 'novel-goal-tracker-dashboard';

export interface DashboardViewHost {
	novels(): Novel[];
	/** The novel whose chapter or dashboard is open, if any. */
	activeNovel(): Novel | undefined;
	/** Draw a novel's dashboard into an element; redraw() re-draws this view. */
	drawDashboard(el: HTMLElement, novel: Novel, redraw: () => void): void;
}

/** The dashboard in a side pane, for keeping an eye on it while writing. */
export class DashboardView extends ItemView {
	private novelId: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private host: DashboardViewHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return DASHBOARD_VIEW;
	}

	getDisplayText(): string {
		return 'Novel dashboard';
	}

	getIcon(): string {
		return 'book-open';
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), novelId: this.novelId };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === 'object' && 'novelId' in state) {
			const id = state.novelId;
			this.novelId = typeof id === 'string' ? id : null;
		}
		await super.setState(state, result);
		this.draw();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('ngt-view');
		this.draw();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private wasNarrow: boolean | null = null;

	onResize(): void {
		const now = isNarrow(this.contentEl);
		if (now !== this.wasNarrow) {
			this.wasNarrow = now;
			this.draw();
		}
	}

	private pickerEl: HTMLSelectElement | null = null;
	private bodyEl: HTMLElement | null = null;

	/** Show a particular novel. */
	showNovel(id: string): void {
		this.novelId = id;
		this.draw();
		this.app.workspace.requestSaveLayout();
	}

	/** Redraw in place, so scroll position and focus survive live updates. */
	draw(): void {
		const el = this.contentEl;
		const novels = this.host.novels();
		if (novels.length === 0) {
			el.empty();
			this.pickerEl = null;
			this.bodyEl = null;
			el.createDiv({ cls: 'ngt-note', text: 'No novels yet. Run "Create new novel" to start one.' });
			return;
		}
		if (!this.bodyEl || !this.bodyEl.isConnected) {
			el.empty();
			this.pickerEl = null;
			this.bodyEl = el.createDiv();
		}
		let novel = novels.find((n) => n.id === this.novelId);
		if (!novel) {
			novel = this.host.activeNovel() ?? novels[0];
			this.novelId = novel?.id ?? null;
		}
		if (!novel) return;
		if (novels.length > 1) {
			if (!this.pickerEl) {
				const select = createEl('select', { cls: 'dropdown ngt-view-picker', attr: { 'aria-label': 'Novel' } });
				el.insertBefore(select, this.bodyEl);
				select.addEventListener('change', () => this.showNovel(select.value));
				this.pickerEl = select;
			}
			const picker = this.pickerEl;
			picker.empty();
			for (const n of novels) picker.createEl('option', { text: n.title, value: n.id });
			picker.value = novel.id;
		} else if (this.pickerEl) {
			this.pickerEl.remove();
			this.pickerEl = null;
		}
		this.host.drawDashboard(this.bodyEl, novel, () => this.draw());
	}
}
