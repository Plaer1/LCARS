// LCARSv2 register columns (slice S03): the extra columns, the name favicon,
// the rating band, header resize and drag-reorder, and the column chooser.
// Everything goes through ops-api.js (registry, prefs, hooks) and the
// register's own markup; ops.js is never edited.

import { dateCode, hours, tagName, year } from './data.js';
import { esc } from './ops.js';
import { columnTemplate, columnTrack, on, prefs, registry, visibleColumns } from './ops-api.js';

const KEY = '__lcarsV2OpsColumnsV1';
const OPS = '__lcarsV2OpsV1';
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const MS = 180;
const MIN_DRAG = 4;     // px a header press must travel before it counts as a drag
const MAX_W = 720;
const SWALLOW = 350;    // ms after a drag or resize in which its click is cancelled

// Per-install state, reset by stop().
let chooser = null;     // { box, anchor, on, unsub }
let bound = null;       // header element the pointer and key handlers sit on
let boundRoot = null;
let boundScroll = null; // the rows' scroll box, which drives the header's scrollLeft
let rz = null;          // active resize
let cancelDrag = null;  // ends an active header or chooser drag
let lastEnd = 0;        // performance.now() when the last drag or resize ended
let iconsOn = true;

const reduce = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ops = () => window[OPS]?.api || null;
const rootOf = () => ops()?.root || null;
const dirNow = () => ops()?.state?.dir || -1;
const readIcons = () => prefs.get('icons', 'on') !== 'off';

/* ---------------------------------------------------------- record helpers */

// ops.js multiplies cmp by the live sort direction, so unknowns are sent to the
// end by reading that direction here: the result is +1 whichever way it sorts.
const nullsLast = (isNull, cmp) => (a, b) => {
	const na = isNull(a), nb = isNull(b);
	if (na || nb) return na === nb ? 0 : (na ? dirNow() : -dirNow());
	return cmp(a, b);
};

const ratio = r => r.ach.unlocked / r.ach.total;

const TYPE = { 1: ['Game', 1], 2: ['Tool', 2], 4: ['Tool', 2], 8: ['Demo', 3], 65536: ['Beta', 4], 1073741824: ['Non-Steam', 5] };
const typeLabel = t => (t ? TYPE[t]?.[0] || 'Other' : '—');
const typeRank = t => TYPE[t]?.[1] || 9;

// xbox_controller_support: 2 full, 1 partial, 0 none, -1 unknown. Steam's store
// categories (28 full, 18 partial) cover the apps that are still -1.
function controllerLevel(r) {
	if (r.controller >= 0) return r.controller;
	if (r.cats.includes(28)) return 2;
	if (r.cats.includes(18)) return 1;
	return -1;
}
const CTRL = { 2: ['Full', 'full'], 1: ['Partial', 'part'], 0: ['None', 'none'] };

// Deck: 0 unknown, 1 unsupported, 2 playable, 3 verified (low two bits, see data.js).
const DECK = { 3: ['Verified', 'v'], 2: ['Playable', 'p'], 1: ['Unsupported', 'u'], 0: ['Unknown', 'x'] };
const pill = r => { const [text, k] = DECK[r.deck] || DECK[0]; return `<b class="lc-pill k-${k}">${text}</b>`; };

const band = p => (p >= 80 ? 'gold' : p >= 70 ? 'peach' : p >= 40 ? 'coral' : 'off');

// The first tag's name is looked up once per record (records are rebuilt on load).
const tagCache = new WeakMap();
function firstTag(r) {
	if (tagCache.has(r)) return tagCache.get(r);
	const name = r.tags.length ? tagName(r.tags[0]) : '';
	if (name) tagCache.set(r, name);
	return name;
}

// The name cell's favicon. A missing icon (or a failed load) shows the first
// letter of the sort name on the surface colour.
function ico(r) {
	const url = r.iconURL;
	const letter = (r.sortAs || r.name || '?').charAt(0).toUpperCase();
	return `<i class="lc-ico${url ? '' : ' miss'}" data-l="${esc(letter)}">${url ? `<img src="${esc(url)}" alt="" width="20" height="20" loading="lazy" decoding="async">` : ''}</i>`;
}

const EXTRA = {
	recent: { label: '2W Hrs', width: '76px', min: 60, cls: 'c-num', cell: r => (r.recent ? hours(r.recent) : '—'), cmp: (a, b) => a.recent - b.recent, dir: -1 },
	ach: {
		label: 'Achv', width: '72px', min: 60, cls: 'c-num',
		cell: r => (r.ach ? `<span title="${r.ach.unlocked} of ${r.ach.total} unlocked">${Math.round(100 * ratio(r))}%</span>` : '—'),
		cmp: nullsLast(r => !r.ach, (a, b) => ratio(a) - ratio(b)), dir: -1,
	},
	purchased: { label: 'Bought', width: '96px', min: 84, cls: 'c-num', cell: r => dateCode(r.purchased), cmp: nullsLast(r => !r.purchased, (a, b) => a.purchased - b.purchased), dir: -1 },
	released: { label: 'Year', width: '66px', min: 56, cls: 'c-num', cell: r => (r.released ? year(r.released) : '—'), cmp: nullsLast(r => !r.released, (a, b) => a.released - b.released), dir: -1 },
	deck: { label: 'Deck', width: '122px', min: 100, cls: 'c-txt', align: 'left', cell: pill, cmp: nullsLast(r => !r.deck, (a, b) => a.deck - b.deck), dir: -1 },
	ctrl: {
		label: 'Controller', width: '122px', min: 112, cls: 'c-txt', align: 'left',
		cell: r => { const k = controllerLevel(r); return CTRL[k] ? `<span class="lc-k-${CTRL[k][1]}">${CTRL[k][0]}</span>` : '—'; },
		cmp: nullsLast(r => controllerLevel(r) < 0, (a, b) => controllerLevel(a) - controllerLevel(b)), dir: -1,
	},
	copies: { label: 'Copies', width: '70px', min: 62, cls: 'c-num', cell: r => r.copies || '—', cmp: nullsLast(r => !r.copies, (a, b) => a.copies - b.copies), dir: -1 },
	type: { label: 'Type', width: '104px', min: 84, cls: 'c-txt', align: 'left', cell: r => typeLabel(r.type), cmp: nullsLast(r => !r.type, (a, b) => typeRank(a.type) - typeRank(b.type)), dir: 1 },
	tag: {
		label: 'First tag', width: '150px', min: 110, cls: 'c-txt', align: 'left',
		cell: r => { const t = firstTag(r); return t ? esc(t) : '—'; },
		cmp: nullsLast(r => !firstTag(r), (a, b) => firstTag(a).localeCompare(firstTag(b))), dir: 1,
	},
	updated: { label: 'Updated', width: '96px', min: 84, cls: 'c-num', cell: r => dateCode(r.updated), cmp: nullsLast(r => !r.updated, (a, b) => a.updated - b.updated), dir: -1 },
};

/* ---------------------------------------------------------- geometry and FLIP */

// Which index the dragged item would drop to, given the pointer's travel. Items
// are compared by their centres at rest.
function dropIndex(items, id, delta) {
	const d = items.find(i => i.id === id);
	const mid = d.pos + d.size / 2 + delta;
	return items.filter(i => i.id !== id && i.pos + i.size / 2 < mid).length;
}

// Where every item starts once `id` sits at index `to`. The others close the gap
// and the new slot opens, keeping the original gap between items.
function slidePlan(items, id, to) {
	const others = items.filter(i => i.id !== id);
	const next = [...others.slice(0, to), items.find(i => i.id === id), ...others.slice(to)];
	const gap = items.length > 1 ? items[1].pos - items[0].pos - items[0].size : 0;
	const starts = new Map();
	let at = items[0].pos;
	for (const it of next) { starts.set(it.id, at); at += it.size + gap; }
	return { next: next.map(i => i.id), starts };
}

const at = el => { const q = el.getBoundingClientRect(); return { x: q.left, y: q.top }; };

// Positions of the headers, the visible rows' cells and the chooser rows, keyed
// so that a re-render can be matched up again.
function measure() {
	const out = new Map();
	const r = rootOf();
	if (!r) return out;
	for (const b of r.querySelectorAll('.lc-reg-cols [data-col]')) out.set(`h:${b.dataset.col}`, { el: b, ...at(b) });
	for (const row of r.querySelectorAll('.lc-reg-rows > .lc-row')) {
		for (const c of row.children) if (c.dataset.col) out.set(`r:${row.dataset.i}:${c.dataset.col}`, { el: c, ...at(c) });
	}
	for (const li of r.querySelectorAll('.lc-cc-row')) out.set(`c:${li.dataset.col}`, { el: li, ...at(li) });
	return out;
}

// Runs a change that re-renders the register, then glides every element that
// moved from where it was to where it is now (Web Animations, so frame.css's
// zero-duration rule does not apply).
function flipAround(change) {
	const before = measure();
	change();
	if (reduce()) return;
	for (const [k, a] of measure()) {
		const b = before.get(k);
		if (!b) continue;
		const dx = b.x - a.x, dy = b.y - a.y;
		if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
		a.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: MS, easing: EASE });
	}
}

// One step of the sliding others during a drag.
function shift(el, from, to, horiz) {
	const t = v => (horiz ? `translateX(${v}px)` : `translateY(${v}px)`);
	if (from !== to && !reduce()) el.animate([{ transform: t(from) }, { transform: t(to) }], { duration: MS, easing: EASE });
	el.style.transform = to ? t(to) : '';
}

// Returns items that were lifted or slid back to rest, without re-rendering.
function settle(els) {
	for (const el of els) {
		if (!el.style.transform) continue;
		if (!reduce()) el.animate([{ transform: el.style.transform }, { transform: 'none' }], { duration: MS, easing: EASE });
		el.style.transform = '';
	}
}

/* ---------------------------------------------------------- reorder drag */

// One pointer drag that reorders the children of `el`'s parent along an axis.
// Under MIN_DRAG it is still a click. Past it the item lifts, the others slide
// aside, and the drop is a FLIP. `drop(next, to, id)` returns the new saved list,
// or null when nothing changed.
function reorder(e, el, axis, drop) {
	const horiz = axis === 'x';
	const container = el.parentElement;
	const id = el.dataset.col;
	const start = horiz ? e.clientX : e.clientY;
	const pid = e.pointerId;
	const place = v => (horiz ? `translate(${v}px, -3px)` : `translate(3px, ${v}px)`);
	const d = { active: false, items: [], to: -1, plan: null, offs: new Map(), cancelled: false };
	const regRoot = () => container.closest('.lc-ops');

	const move = ev => {
		if (ev.pointerId !== pid) return;
		const delta = (horiz ? ev.clientX : ev.clientY) - start;
		if (!d.active) {
			if (Math.abs(delta) < MIN_DRAG) return;
			d.active = true;
			d.items = [...container.children].map(n => {
				const q = n.getBoundingClientRect();
				return { id: n.dataset.col, el: n, pos: horiz ? q.left : q.top, size: horiz ? q.width : q.height };
			});
			el.classList.add('lift');
			regRoot()?.classList.add('lc-moving');
			window.addEventListener('keydown', onKey, true);
		}
		el.style.transform = place(delta);
		const to = dropIndex(d.items, id, delta);
		if (to === d.to) return;
		d.to = to;
		d.plan = slidePlan(d.items, id, to);
		for (const it of d.items) {
			if (it.id === id) continue;
			const off = d.plan.starts.get(it.id) - it.pos;
			shift(it.el, d.offs.get(it.id) || 0, off, horiz);
			d.offs.set(it.id, off);
		}
		if (horiz) showMark(container, d.plan.starts.get(id));
	};

	const stop = () => {
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', up);
		window.removeEventListener('pointercancel', cancel);
		window.removeEventListener('keydown', onKey, true);
		cancelDrag = null;
	};
	const end = commit => {
		stop();
		el.classList.remove('lift');
		regRoot()?.classList.remove('lc-moving');
		if (!d.active) return;
		lastEnd = performance.now();
		if (horiz) showMark(container, null);
		const cols = commit && !d.cancelled && d.plan ? drop(d.plan.next, d.to, id) : null;
		if (cols) flipAround(() => prefs.set('cols', cols));
		else settle(d.items.map(i => i.el));
	};
	const up = ev => { if (ev.pointerId === pid) end(true); };
	const cancel = ev => { if (ev.pointerId === pid) end(false); };
	const onKey = ev => {
		if (ev.key !== 'Escape') return;
		ev.preventDefault();
		ev.stopPropagation();
		d.cancelled = true;
		end(false);
	};

	window.addEventListener('pointermove', move);
	window.addEventListener('pointerup', up);
	window.addEventListener('pointercancel', cancel);
	cancelDrag = () => end(false);
}

/* ---------------------------------------------------------- header handles */

// The gold bar lives in the register, so it can sit over headers and rows alike.
function barOf(head) {
	const reg = head.closest('.lc-reg');
	let bar = reg.querySelector(':scope > .lc-rz-bar');
	if (!bar) {
		bar = document.createElement('i');
		bar.className = 'lc-rz-bar';
		reg.appendChild(bar);
	}
	return bar;
}

// x is a viewport coordinate; null hides the bar.
function showMark(head, x) {
	const bar = barOf(head);
	if (x == null) { bar.classList.remove('on', 'mark'); return; }
	bar.classList.add('on', 'mark');
	bar.style.left = `${x - head.closest('.lc-reg').getBoundingClientRect().left - 2}px`;
}

function showEdge(btn) {
	const bar = barOf(btn.parentElement);
	bar.classList.add('on');
	bar.classList.remove('mark');
	bar.style.left = `${btn.getBoundingClientRect().right - btn.closest('.lc-reg').getBoundingClientRect().left - 1}px`;
}

function addGrips(head) {
	for (const b of head.querySelectorAll('[data-col]')) {
		if (!b.querySelector(':scope > .lc-grip')) b.insertAdjacentHTML('beforeend', '<i class="lc-grip" aria-hidden="true"></i>');
	}
}

// The live template: the dragged column reads its --c-<id>-w var, so a move
// updates the root's variables and not each row. NAME's track is already a
// variable: ops.js fit() gives it the room the other columns leave.
function liveTemplate(id) {
	const widths = prefs.get('colw', {});
	return visibleColumns().map(c => {
		return c.id === id && id !== 'name' ? `var(--c-${id}-w)` : columnTrack(c, widths);
	}).join(' ');
}

function startResize(e, grip) {
	const btn = grip.parentElement;
	const r = btn.closest('.lc-ops');
	const id = btn.dataset.col;
	e.preventDefault();
	grip.setPointerCapture?.(e.pointerId);
	const w0 = btn.getBoundingClientRect().width;
	const min = registry.columns.get(id)?.min || 40;
	rz = {
		id, grip, pid: e.pointerId, x0: e.clientX, btn, root: r, moved: false,
		// A drag stops at the column's data, and only NAME may cut its text.
		w0, w: 0, min: id === 'name' ? min : Math.min(w0, Math.max(min, fitWidth(id) || 0)),
	};
	r.classList.add('lc-sizing');
	r.style.setProperty('--lc-cols', liveTemplate(id));
	r.style.setProperty(`--c-${id}-w`, `${rz.w0}px`);
	showEdge(btn);
	// On the window: a header re-render can replace the grip mid-drag, and the release must still land.
	window.addEventListener('pointermove', resizeMove);
	window.addEventListener('pointerup', resizeEnd);
	window.addEventListener('pointercancel', resizeEnd);
}

function resizeMove(e) {
	if (!rz || e.pointerId !== rz.pid) return;
	const dx = e.clientX - rz.x0;
	rz.w = Math.round(Math.min(MAX_W, Math.max(rz.min, rz.w0 + dx)));
	rz.moved ||= Math.abs(dx) > 1;
	rz.root.style.setProperty(`--c-${rz.id}-w`, `${rz.w}px`);
	ops()?.fit();
	showEdge(rz.btn);
}

function resizeEnd(e) {
	if (!rz || e.pointerId !== rz.pid) return;
	const { id, root, moved, w } = rz;
	rz = null;
	window.removeEventListener('pointermove', resizeMove);
	window.removeEventListener('pointerup', resizeEnd);
	window.removeEventListener('pointercancel', resizeEnd);
	root.classList.remove('lc-sizing');
	const bar = root.querySelector('.lc-rz-bar');
	bar?.classList.remove('on', 'mark');
	lastEnd = performance.now();
	if (moved) prefs.set('colw', { ...prefs.get('colw', {}), [id]: w });
	root.style.removeProperty(`--c-${id}-w`);
	// Put back the literal template. A header re-render would swallow a
	// double-click that is still in progress, so this does not re-render.
	root.style.setProperty('--lc-cols', columnTemplate(visibleColumns()));
	ops()?.fit();
}

const textWidth = node => {
	if (!node) return 0;
	const rg = document.createRange();
	rg.selectNodeContents(node);
	return rg.getBoundingClientRect().width;
};

// Auto-fit: the widest of at most 40 cells (by text length), plus the label.
function fitWidth(id) {
	const c = registry.columns.get(id);
	const r = rootOf();
	if (!c || !r) return null;
	const btn = r.querySelector(`.lc-reg-cols [data-col="${id}"]`);
	const cells = [...r.querySelectorAll(`.lc-reg-rows [data-col="${id}"]`)]
		.sort((a, b) => b.textContent.length - a.textContent.length)
		.slice(0, 40);
	let w = textWidth(btn?.firstChild) + 34;
	for (const cell of cells) w = Math.max(w, textWidth(cell) + 16);
	return Math.round(Math.min(MAX_W, Math.max(c.min || 40, w)));
}

function onHeadDown(e) {
	if (e.button !== 0) return;
	const grip = e.target.closest('.lc-grip');
	if (grip) { startResize(e, grip); return; }
	const btn = e.target.closest('[data-col]');
	if (!btn) return;
	reorder(e, btn, 'x', next => {
		const cur = visibleColumns().map(c => c.id);
		return next.join() === cur.join() ? null : next;
	});
}

function onHeadClick(e) {
	if (e.target.closest('.lc-grip') || performance.now() - lastEnd < SWALLOW) e.preventDefault();
}

function onHeadDbl(e) {
	const grip = e.target.closest('.lc-grip');
	if (!grip) return;
	const id = grip.parentElement.dataset.col;
	const w = fitWidth(id);
	if (!w) return;
	lastEnd = performance.now();
	prefs.set('colw', { ...prefs.get('colw', {}), [id]: w });
}

// Alt+Left/Right moves the focused header one place; focus follows the column.
function onHeadKey(e) {
	if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
	const btn = e.target.closest('[data-col]');
	if (!btn) return;
	e.preventDefault();
	e.stopPropagation();
	const ids = visibleColumns().map(c => c.id);
	const id = btn.dataset.col;
	const i = ids.indexOf(id);
	const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
	if (i < 0 || j < 0 || j >= ids.length) return;
	[ids[i], ids[j]] = [ids[j], ids[i]];
	flipAround(() => prefs.set('cols', ids));
	e.currentTarget.querySelector(`[data-col="${id}"]`)?.focus({ preventScroll: true });
}

// An image that fails to load turns into its lettered block (no inline handler).
function onImgError(e) {
	const img = e.target;
	if (img.tagName === 'IMG' && img.parentElement?.classList.contains('lc-ico')) img.parentElement.classList.add('miss');
}

// The header scrolls sideways with the rows when the register is wider than its host.
function bindHead(head) {
	if (bound === head) return;
	unbindHead();
	bound = head;
	boundRoot = head.closest('.lc-ops');
	boundScroll = head.parentElement.querySelector('.lc-reg-scroll');
	head.addEventListener('pointerdown', onHeadDown);
	head.addEventListener('click', onHeadClick, true);
	head.addEventListener('dblclick', onHeadDbl);
	head.addEventListener('keydown', onHeadKey);
	boundRoot?.addEventListener('error', onImgError, true);
	boundScroll?.addEventListener('scroll', syncHeadScroll, { passive: true });
	syncHeadScroll();
}

function syncHeadScroll() {
	if (bound && boundScroll) bound.scrollLeft = boundScroll.scrollLeft;
}

function unbindHead() {
	if (!bound) return;
	bound.removeEventListener('pointerdown', onHeadDown);
	bound.removeEventListener('click', onHeadClick, true);
	bound.removeEventListener('dblclick', onHeadDbl);
	bound.removeEventListener('keydown', onHeadKey);
	boundRoot?.removeEventListener('error', onImgError, true);
	boundScroll?.removeEventListener('scroll', syncHeadScroll);
	bound = null;
	boundRoot = null;
	boundScroll = null;
}

/* ---------------------------------------------------------- column chooser */

function place(box, anchor) {
	const r = anchor?.isConnected ? anchor.getBoundingClientRect() : rootOf()?.querySelector('.lc-reg-cols')?.getBoundingClientRect();
	const w = box.offsetWidth;
	const left = r ? Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w)) : 8;
	box.style.left = `${left}px`;
	box.style.top = `${r ? r.bottom + 6 : 80}px`;
}

// The chooser lists visible columns in their order, then the hidden ones.
function renderList() {
	if (!chooser) return;
	const vis = visibleColumns().map(c => c.id);
	const rest = [...registry.columns.keys()].filter(id => !vis.includes(id));
	chooser.on = new Set(vis);
	chooser.box.querySelector('.lc-cc-list').innerHTML = [...vis, ...rest].map(id => {
		const on = chooser.on.has(id);
		const label = esc(registry.columns.get(id)?.label || id);
		return `<li class="lc-cc-row${on ? ' on' : ''}" data-col="${esc(id)}"><button type="button" class="lc-cc-lamp" aria-pressed="${on}" aria-label="${on ? 'Hide' : 'Show'} ${label}"></button><span class="lc-cc-name">${label}</span><i class="lc-cc-grab" aria-hidden="true"></i></li>`;
	}).join('');
	chooser.box.querySelector('.lc-cc-icons').textContent = `Favicons ${readIcons() ? 'on' : 'off'}`;
}

function toggleColumn(id) {
	const vis = visibleColumns().map(c => c.id);
	if (vis.includes(id) && vis.length === 1) return;
	const next = vis.includes(id) ? vis.filter(x => x !== id) : [...vis, id];
	flipAround(() => prefs.set('cols', next));
}

// Dropping a row inside the visible block shows it; dropping it below turns it off.
function chooserDrop(next, to, id) {
	const was = chooser?.on;
	if (!was) return null;
	const othersOn = next.filter(x => x !== id && was.has(x)).length;
	const vis = next.filter(x => (x === id ? to <= othersOn : was.has(x)));
	const cur = [...was];
	return vis.length && vis.join() !== cur.join() ? vis : null;
}

function onChooserClick(e) {
	const t = e.target;
	if (t.closest('.lc-cc-lamp')) { toggleColumn(t.closest('[data-col]').dataset.col); return; }
	if (t.closest('.lc-cc-reset')) {
		flipAround(() => { prefs.set('cols', null); prefs.set('colw', null); });
		return;
	}
	if (t.closest('.lc-cc-icons')) prefs.set('icons', iconsOn ? 'off' : 'on');
}

function onChooserDown(e) {
	if (e.button !== 0 || !e.target.closest('.lc-cc-grab')) return;
	e.preventDefault();
	reorder(e, e.target.closest('[data-col]'), 'y', chooserDrop);
}

// Outside clicks close the chooser. The anchor's own click toggles it instead.
function onOutside(e) {
	if (!chooser || chooser.box.contains(e.target) || chooser.anchor?.contains?.(e.target)) return;
	closeChooser();
}

function onEscape(e) {
	if (!chooser || e.key !== 'Escape') return;
	e.preventDefault();
	e.stopPropagation();
	closeChooser();
}

function closeChooser() {
	if (!chooser) return;
	chooser.unsub();
	chooser.box.remove();
	document.removeEventListener('pointerdown', onOutside, true);
	document.removeEventListener('keydown', onEscape, true);
	chooser = null;
}

// Registered as the 'columns' menu command; the anchor is the menu button.
export function openColumnChooser(anchorEl) {
	if (chooser) { closeChooser(); return; }
	const r = rootOf();
	if (!r) return;
	const box = document.createElement('div');
	box.className = 'lc-cc';
	box.tabIndex = -1;
	box.setAttribute('role', 'dialog');
	box.setAttribute('aria-label', 'Columns');
	box.innerHTML = `
		<div class="lc-cc-head"><b>Columns</b><button type="button" class="lc-cc-reset">Reset columns</button></div>
		<ol class="lc-cc-list"></ol>
		<div class="lc-cc-foot"><button type="button" class="lc-cc-icons"></button></div>`;
	r.appendChild(box);
	chooser = { box, anchor: anchorEl || null, on: new Set(), unsub: prefs.on('cols', () => renderList()) };
	box.addEventListener('click', onChooserClick);
	box.addEventListener('pointerdown', onChooserDown);
	box.addEventListener('keydown', e => e.stopPropagation());
	document.addEventListener('pointerdown', onOutside, true);
	document.addEventListener('keydown', onEscape, true);
	renderList();
	place(box, anchorEl);
	box.focus({ preventScroll: true });
}

/* ---------------------------------------------------------- install */

export function install() {
	window[KEY]?.stop();
	const origName = registry.columns.get('name');
	const origReview = registry.columns.get('review');
	iconsOn = readIcons();

	for (const [id, def] of Object.entries(EXTRA)) registry.columns.set(id, def);
	if (origName) {
		registry.columns.set('name', {
			...origName,
			width: '340px',
			cell: r => (iconsOn ? `${ico(r)}<span class="lc-nm">${esc(r.name)}</span>` : origName.cell(r)),
		});
	}
	if (origReview) {
		registry.columns.set('review', {
			...origReview,
			cell: r => (r.review ? `<b class="lc-band b-${band(r.review)}">${r.review}%</b>` : '—'),
			cmp: nullsLast(r => !r.review, origReview.cmp),
		});
	}
	registry.tools.set('columns', { label: 'Columns', run: openColumnChooser });

	const unsubs = [
		on('headerRender', head => { addGrips(head); bindHead(head); }),
		prefs.on('icons', () => {
			iconsOn = readIcons();
			ops()?.paint();
			if (chooser) renderList();
		}),
	];

	const stop = () => {
		cancelDrag?.();
		closeChooser();
		unbindHead();
		for (const off of unsubs) off();
		if (rz) {
			window.removeEventListener('pointermove', resizeMove);
			window.removeEventListener('pointerup', resizeEnd);
			window.removeEventListener('pointercancel', resizeEnd);
			rz = null;
		}
		const r = rootOf();
		r?.querySelectorAll('.lc-grip, .lc-rz-bar').forEach(n => n.remove());
		r?.classList.remove('lc-sizing', 'lc-moving');
		registry.tools.delete('columns');
		for (const id of Object.keys(EXTRA)) registry.columns.delete(id);
		if (origName) registry.columns.set('name', origName);
		if (origReview) registry.columns.set('review', origReview);
		if (window[KEY]?.stop === stop) delete window[KEY];
		ops()?.renderHeader();
		ops()?.paint();
	};

	window[KEY] = { stop };
	// Rows painted before this install still carry the plain name and rating cells.
	ops()?.renderHeader();
	ops()?.paint();
}
