import { niceMax } from '../series';

/*
 * Small hand-drawn SVG charts. Colors come from CSS classes that use the
 * active Obsidian theme's variables, so light and dark themes both work.
 * Each mark carries a <title> so hovering shows its value.
 */

const WIDE = 640;
const PAD = { top: 14, right: 12, bottom: 26, left: 52 };

function fmt(n: number): string {
	return Math.round(n).toLocaleString();
}

function svgRoot(parent: HTMLElement, width: number, height: number, label: string): SVGSVGElement {
	const svg = parent.createSvg('svg', {
		cls: 'ngt-chart',
		attr: { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' },
	});
	return svg;
}

function titled(el: SVGElement, text: string): void {
	el.createSvg('title').textContent = text;
}

function svgText(parent: SVGElement, cls: string, text: string, attr: Record<string, string | number>): void {
	parent.createSvg('text', { cls, attr }).textContent = text;
}

export interface ChartSeries {
	name: string;
	values: (number | null)[];
	kind: 'line' | 'bar';
	/** CSS class giving the series its color. */
	cls: string;
	dashed?: boolean;
}

export interface XYOptions {
	ariaLabel: string;
	/** Drawing width in SVG units; smaller suits narrow cards (default 640). */
	width?: number;
	height?: number;
	/** Full labels for tooltips, one per x position. */
	labels: string[];
	/** Short labels shown under the axis; '' to skip a position. */
	ticks: string[];
	/** Unit for tooltips, e.g. "words". */
	unit: string;
	/** Index to mark as "today". */
	highlight?: number;
}

/** A line and/or bar chart over evenly spaced x positions. */
export function xyChart(parent: HTMLElement, series: ChartSeries[], o: XYOptions): void {
	const W = o.width ?? WIDE;
	const H = o.height ?? 220;
	const n = Math.max(1, o.labels.length);
	const plotW = W - PAD.left - PAD.right;
	const plotH = H - PAD.top - PAD.bottom;
	let maxVal = 0;
	for (const s of series) for (const v of s.values) if (v !== null && v > maxVal) maxVal = v;
	const yMax = niceMax(maxVal);
	const step = plotW / n;
	const x = (i: number): number => PAD.left + step * (i + 0.5);
	const y = (v: number): number => PAD.top + plotH - (Math.max(0, v) / yMax) * plotH;

	const svg = svgRoot(parent, W, H, o.ariaLabel);

	// Grid and y axis labels.
	const grid = svg.createSvg('g', { cls: 'ngt-chart-grid' });
	for (let i = 0; i <= 4; i++) {
		const v = (yMax / 4) * i;
		grid.createSvg('line', { attr: { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v) } });
		svgText(grid, 'ngt-chart-label', fmt(v), { x: PAD.left - 6, y: y(v) + 4, 'text-anchor': 'end' });
	}
	o.ticks.forEach((t, i) => {
		if (!t) return;
		svgText(grid, 'ngt-chart-label', t, { x: x(i), y: H - 8, 'text-anchor': 'middle' });
	});
	if (o.highlight !== undefined && o.highlight >= 0 && o.highlight < n) {
		svg.createSvg('rect', {
			cls: 'ngt-chart-today',
			attr: { x: x(o.highlight) - step / 2, y: PAD.top, width: step, height: plotH },
		});
	}

	// Bars first, lines on top.
	const bars = series.filter((s) => s.kind === 'bar');
	const barW = (step * 0.7) / Math.max(1, bars.length);
	bars.forEach((s, bi) => {
		// SVG classes must be a list: Obsidian's createSvg doesn't split on spaces.
		const g = svg.createSvg('g', { cls: ['ngt-series', ...s.cls.split(' ')] });
		s.values.forEach((v, i) => {
			if (v === null) return;
			const top = y(v);
			const rect = g.createSvg('rect', {
				attr: {
					x: x(i) - (step * 0.7) / 2 + bi * barW,
					y: top,
					width: Math.max(1, barW - 1),
					height: Math.max(0, PAD.top + plotH - top),
					rx: 1.5,
				},
			});
			titled(rect, `${o.labels[i] ?? ''}: ${fmt(v)} ${o.unit} (${s.name})`);
		});
	});
	for (const s of series.filter((t) => t.kind === 'line')) {
		const g = svg.createSvg('g', {
			cls: ['ngt-series', ...s.cls.split(' '), ...(s.dashed ? ['ngt-dashed'] : [])],
		});
		let d = '';
		s.values.forEach((v, i) => {
			if (v === null) return;
			d += `${d ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
		});
		if (d) g.createSvg('path', { attr: { d, fill: 'none' } });
		if (!s.dashed) {
			s.values.forEach((v, i) => {
				if (v === null) return;
				const dot = g.createSvg('circle', { attr: { cx: x(i), cy: y(v), r: 3 } });
				titled(dot, `${o.labels[i] ?? ''}: ${fmt(v)} ${o.unit} (${s.name})`);
			});
		}
	}
}

/** A ring showing a fraction, with a big number in the middle. */
export function ringGauge(
	parent: HTMLElement,
	fraction: number,
	value: string,
	caption: string,
	ariaLabel: string,
): void {
	const size = 132;
	const r = 54;
	const c = 2 * Math.PI * r;
	const f = Math.max(0, Math.min(1, fraction));
	const svg = svgRoot(parent, size, size, ariaLabel);
	svg.addClass('ngt-ring');
	svg.createSvg('circle', { cls: 'ngt-ring-track', attr: { cx: size / 2, cy: size / 2, r } });
	if (f > 0) {
		svg.createSvg('circle', {
			cls: 'ngt-ring-fill',
			attr: {
				cx: size / 2,
				cy: size / 2,
				r,
				'stroke-dasharray': `${(c * f).toFixed(2)} ${c.toFixed(2)}`,
				transform: `rotate(-90 ${size / 2} ${size / 2})`,
			},
		});
	}
	svgText(svg, 'ngt-ring-value', value, { x: size / 2, y: size / 2 + 2, 'text-anchor': 'middle' });
	svgText(svg, 'ngt-ring-caption', caption, { x: size / 2, y: size / 2 + 22, 'text-anchor': 'middle' });
}

/** A plain table, used as the accessible "table" view of a chart. */
export function dataTable(parent: HTMLElement, headers: string[], rows: string[][]): HTMLTableElement {
	const table = parent.createEl('table', { cls: 'ngt-table' });
	const head = table.createEl('thead').createEl('tr');
	for (const h of headers) head.createEl('th', { text: h });
	const body = table.createEl('tbody');
	for (const r of rows) {
		const tr = body.createEl('tr');
		for (const cell of r) tr.createEl('td', { text: cell });
	}
	return table;
}

export type ChartMode = 'line' | 'bar' | 'table';

/** Line / Bar / Table switch. */
export function modeSwitch(
	parent: HTMLElement,
	chart: string,
	current: ChartMode,
	modes: ChartMode[],
	onChange: (mode: ChartMode) => void,
): void {
	const names: Record<ChartMode, string> = { line: 'Line', bar: 'Bar', table: 'Table' };
	const group = parent.createDiv({ cls: 'ngt-mode', attr: { role: 'group', 'aria-label': 'Chart view' } });
	for (const m of modes) {
		const b = group.createEl('button', {
			text: names[m],
			attr: { 'aria-pressed': String(m === current), 'data-ngt-key': `mode-${chart}-${m}` },
		});
		if (m === current) b.addClass('is-active');
		b.addEventListener('click', () => onChange(m));
	}
}
