// Browser stand-ins for the DOM helpers Obsidian adds to elements, so the
// dashboard code can run in a plain page for previews.
type Info = { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean | null>; href?: string; value?: string };

function apply(el: Element, o?: Info | string): void {
	if (!o) return;
	if (typeof o === 'string') {
		el.className = o;
		return;
	}
	if (o.cls) el.classList.add(...(Array.isArray(o.cls) ? o.cls : o.cls.split(' ').filter(Boolean)));
	if (o.text !== undefined) el.textContent = o.text;
	if (o.href !== undefined) el.setAttribute('href', o.href);
	if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
	for (const [k, v] of Object.entries(o.attr ?? {})) if (v !== null && v !== false) el.setAttribute(k, String(v));
}

const P = Element.prototype as unknown as Record<string, unknown>;
P.createEl = function (this: Element, tag: string, o?: Info) {
	const el = document.createElement(tag);
	apply(el, o);
	this.appendChild(el);
	return el;
};
P.createDiv = function (this: Element, o?: Info) {
	return (this as unknown as { createEl: (t: string, o?: Info) => Element }).createEl('div', o);
};
P.createSpan = function (this: Element, o?: Info) {
	return (this as unknown as { createEl: (t: string, o?: Info) => Element }).createEl('span', o);
};
P.createSvg = function (this: Element, tag: string, o?: Info) {
	const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
	// Like Obsidian: a class string is one token (a space in it throws).
	if (o && typeof o === 'object' && typeof o.cls === 'string') {
		el.classList.add(o.cls);
		o = { ...o, cls: undefined };
	}
	apply(el, o);
	this.appendChild(el);
	return el;
};
P.empty = function (this: Element) {
	while (this.firstChild) this.removeChild(this.firstChild);
};
P.setText = function (this: Element, t: string) {
	this.textContent = t;
};
P.addClass = function (this: Element, ...c: string[]) {
	this.classList.add(...c);
};
P.removeClass = function (this: Element, ...c: string[]) {
	this.classList.remove(...c);
};
P.toggleClass = function (this: Element, c: string, on: boolean) {
	this.classList.toggle(c, on);
};
P.setAttr = function (this: Element, k: string, v: string) {
	this.setAttribute(k, v);
};
P.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
	for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
};

Object.defineProperty(Node.prototype, 'doc', {
	get(this: Node) {
		return this.ownerDocument ?? document;
	},
});

Object.defineProperty(Document.prototype, 'win', {
	get(this: Document) {
		return this.defaultView ?? window;
	},
});
(window as unknown as Record<string, unknown>).createDiv = (o?: Info) => {
	const el = document.createElement('div');
	apply(el, o);
	return el;
};
(window as unknown as Record<string, unknown>).createEl = (tag: string, o?: Info) => {
	const el = document.createElement(tag);
	apply(el, o);
	return el;
};

(window as unknown as Record<string, unknown>).activeDocument = document;
(window as unknown as Record<string, unknown>).activeWindow = window;

(Node.prototype as unknown as Record<string, unknown>).instanceOf = function (this: Node, type: new () => unknown) {
	return this instanceof type;
};
