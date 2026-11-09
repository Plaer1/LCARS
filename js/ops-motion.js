// LCARSv2 register motion (slice S05). In OPS mode the register shrinks to
// the 300 px compact dock while the game page slides in as a card; going back
// reverses it. Also mounts the compact hamburger: SORT BY, then every
// registry.tools entry. It runs on ops-api hooks and element.animate and never
// re-renders the register's own markup (ops.js owns that).
//
// shortcut: the card is Steam's right panel by class name, and Steam may reuse
// that node, so a game-to-game swap slides the new content out too.

import { currentPath, host, mainHistory, navigate, uiScale } from './data.js';
import { esc, opsMode, setOpsMode } from './ops.js';
import { on, registry } from './ops-api.js';

const KEY = '__lcarsV2OpsMotionV1';
const OPS = '__lcarsV2OpsV1';
// Swipes, not snaps (user, 2026-10-30): a long ease-out so each move reads as
// a deliberate console wipe, about twice the original speeds.
const EASE = 'cubic-bezier(.45,0,.2,1)'; // ease-in-out: the travel spreads over the whole swipe
const SHRINK_MS = 480;  // register width, full <-> 300 px
const CARD_MS = 600;    // game card swipe in/out
const SWAP_MS = 620;    // game to game: wipe out for 40%, wipe in for the rest
const ROW_MS = 120;     // open-row marker, stepped
const CARD_PX = 160;    // card travel on entry and exit: the content itself moves
const SWAP_PX = 64;     // card travel game to game
const LEAD_PX = 6;      // peach leading-edge bar
const TOOL_FIRST = ['columns', 'tabs', 'filter'];

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ops = () => window[OPS]?.api || null;
const el = (tag, cls) => { const e = document.createElement(tag); e.className = cls; return e; };

const toolIds = () => {
	const all = [...registry.tools.keys()];
	return [...TOOL_FIRST.filter(id => registry.tools.has(id)), ...all.filter(id => !TOOL_FIRST.includes(id))];
};

// Steam's right panel holds the game page. It is not the register's next
// sibling (the parked game list is), so ask for the panel by its class.
const CARD = '._3BFcmjAaMyP6GTPwc0VyWi';
const gameCard = root => {
	const c = root.parentElement?.querySelector(`:scope > ${CARD}`);
	return c && c.getBoundingClientRect().width > 0 ? c : null;
};

// Steam renders the game page ~0.5 s after the route changes and blocks the UI
// thread meanwhile. Swiping before that plays on an empty panel (only the lead
// bar seems to move, then the content pops in), so wait until the readout for
// this app exists and frames flow again; then the real content swipes in.
const whenRendered = (root, appid, fn) => {
	const t0 = performance.now();
	const tick = now => {
		if (!root.isConnected) return;
		const card = gameCard(root);
		// rAF can't run while Steam's render blocks the thread, so the first frame
		// that sees the new readout is already after the render.
		const ready = card && (!appid || card.querySelector(`.lc-readout[data-appid="${appid}"]`)); // home: shelves are already rendered
		if (ready || now - t0 > 1500) { if (card) fn(card); else release(); return; }
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
};

/* ---------------------------------------------- leaving the full OPS screen
 * One continuous move (user, 2026-10-30): the detail card slides off the right
 * edge, the new content (game page or shelves) slides in from the right under
 * it, and that content's leading edge is what pushes the register into the
 * sidebar. The full-width register has to stay on screen until the new content
 * arrives, so a frozen copy of it (the ghost) is taken before the switch; the
 * real register docks underneath and the ghost is torn down at the end. */

const LEAVE_MS = 720;
const SAMPLES = 24;

// cubic-bezier(.45,0,.2,1), the swipe ease, evaluated in JS: the register's
// edge must track the content's edge exactly, so both are baked into
// keyframes from the same curve.
const ease = (() => {
	const [x1, y1, x2, y2] = [0.45, 0, 0.2, 1];
	const bx = t => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
	const by = t => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
	return x => {
		let lo = 0, hi = 1;
		for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; (bx(m) < x ? (lo = m) : (hi = m)); }
		return by((lo + hi) / 2);
	};
})();

// Layout the copy keeps from its source: ops.css hangs .lc-ops's display and grid
// off <html> classes that change during the move.
const FROZEN = ['display', 'gridTemplateRows', 'gridTemplateColumns', 'gap', 'padding', 'boxSizing', 'backgroundColor', 'flexDirection'];

const fixedCopy = (node, rect, z) => {
	const c = node.cloneNode(true);
	c.removeAttribute('tabindex');
	const cs = getComputedStyle(node);
	for (const k of FROZEN) c.style[k] = cs[k];
	Object.assign(c.style, {
		position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
		width: `${rect.width}px`, height: `${rect.height}px`,
		margin: '0', zIndex: String(z), pointerEvents: 'none', animation: 'none',
	});
	return c;
};

// Freeze the full OPS screen as two layers: the register and, above it, the card.
function makeGhost(root) {
	const rect = root.getBoundingClientRect();
	const reg = fixedCopy(root, rect, 60);
	reg.classList.add('lc-mo-ghost');
	const wellEl = root.querySelector('.lc-well');
	const wellRect = wellEl?.getBoundingClientRect();
	const well = wellEl && wellRect?.width ? fixedCopy(wellEl, wellRect, 62) : null;
	well?.classList.add('lc-mo-ghost'); // settle() clears stale copies by this class
	reg.querySelector('.lc-well')?.style.setProperty('visibility', 'hidden');
	document.body.append(reg);
	if (well) document.body.append(well);
	// ops.css pins the inner heights through <html> classes that flip during the move.
	for (const sel of ['.lc-ops-body', '.lc-reg', '.lc-reg-scroll']) {
		const a = root.querySelector(sel), b = reg.querySelector(sel);
		if (a && b) b.style.height = `${a.getBoundingClientRect().height}px`;
	}
	const from = root.querySelector('.lc-reg-scroll'), to = reg.querySelector('.lc-reg-scroll');
	if (from && to) to.scrollTop = from.scrollTop;
	const drop = () => { clearTimeout(timer); reg.remove(); well?.remove(); };
	const timer = setTimeout(drop, COPY_LIFE);
	return { reg, well, rect, wellRect, drop };
}

/* ---------------------------------------------- arriving at the full OPS screen
 * The reverse (user, 2026-10-30): the sidebar grows to fill most of the screen
 * while the old content (game page or shelves) slides off to the right ahead of
 * its edge; near the end of the grow the detail card slides in from the right
 * to meet the spreadsheet. Steam hides the content panel as soon as OPS is on,
 * so a frozen copy of it is taken first: at the history push for a game page
 * (before Steam re-renders it as home), else just before the mode switch. */

const GROW_MS = 720;
// A frozen copy never outlives this: a move cut short by another one must not
// strand it on screen (user, round 6: a stale game page sat over the library).
const COPY_LIFE = 3000;

// Land every move still in flight (only ours: Steam animates with CSS), so the
// page is settled before it is copied and old copies run their own clean-up.
const settle = () => {
	for (const a of document.getAnimations()) if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition) && a.playState !== 'finished') a.finish();
	document.querySelectorAll('.lc-mo-ghost').forEach(n => n.remove());
};
const BACK_MS = 560;   // and swiping back in on return

function contentGhost() {
	const card = document.querySelector(`._3xRRJfD2xy95i9NhJxLTp0 > ${CARD}`);
	const side = document.querySelector('._9sPoVBFyE_vE87mnZJ5aB')?.getBoundingClientRect();
	const rect = card?.getBoundingClientRect();
	if (!rect?.width || !side) return null;
	const copy = fixedCopy(card, rect, 61);
	copy.classList.remove(CARD.slice(1)); // ops.css hides that class while OPS is on
	document.body.append(copy);
	// cloneNode keeps no scroll positions.
	const from = [...card.querySelectorAll('*')].filter(n => n.scrollTop), to = copy.querySelectorAll('*');
	const all = [...card.querySelectorAll('*')];
	for (const n of from) to[all.indexOf(n)].scrollTop = n.scrollTop;
	const drop = () => { clearTimeout(timer); copy.remove(); };
	const timer = setTimeout(drop, COPY_LIFE);
	return { copy, side: side.right, drop };
}

function growChoreography(root, ghost, track) {
	const r = root.getBoundingClientRect();
	const start = Math.min(r.right, Math.max(r.left, ghost.side));
	const rootFrames = [], copyFrames = [];
	for (let i = 0; i <= SAMPLES; i++) {
		const t = i / SAMPLES, edge = start + (r.right - start) * ease(t);
		rootFrames.push({ offset: t, clipPath: `inset(0 ${r.right - edge}px 0 0)` });
		copyFrames.push({ offset: t, transform: `translateX(${edge - start}px)` }); // pushed ahead of the edge
	}
	const opts = { duration: GROW_MS, easing: 'linear', fill: 'both' };
	const anims = [root.animate(rootFrames, opts), ghost.copy.animate(copyFrames, opts)];
	const well = root.querySelector('.lc-well');
	const w = well?.getBoundingClientRect();
	if (w?.width) anims.push(well.animate([
		{ transform: `translateX(${innerWidth - w.left}px)` },
		{ transform: 'translateX(0px)' },
	], { duration: GROW_MS * 0.45, delay: GROW_MS * 0.7, easing: EASE, fill: 'backwards' }));
	anims.forEach(track);
	anims[1].onfinish = () => ghost.drop();
	Promise.all(anims.map(a => a.finished)).then(() => anims.forEach(a => a.cancel()), () => {});
}

// The page's sections trail its leading edge a little, so it lands as parts
// rather than one rigid slab; dir is the side it comes in from (1 = right).
const trail = (card, dir, duration) => {
	const body = card.querySelector('._1SvpjsckP9cPRxO6gCBHrw');
	if (!body || reduced()) return [];
	return [...body.children].slice(0, 8).map((c, i) => c.animate(
		[{ transform: `translateX(${dir * (i + 1) * 36}px)` }, { transform: 'none' }],
		{ duration, easing: EASE },
	));
};

// The sliding page's black wells go transparent while it moves (user, 2026-10-30).
let slides = 0;
const sliding = anim => {
	if (!anim) return;
	slides++;
	document.documentElement.classList.add('lc-card-sliding');
	const end = () => { if (--slides <= 0) { slides = 0; document.documentElement.classList.remove('lc-card-sliding'); } };
	anim.addEventListener('finish', end, { once: true });
	anim.addEventListener('cancel', end, { once: true });
};

// The frozen register squeezes into the sidebar rather than being cut off
// (user, round 6: it "should smush up and animate into the smaller one"): its
// width follows the content's edge, its record columns collapse to the
// sidebar's name | lamp, its type drops to the sidebar's size, and at the end it
// fades into Steam's list underneath, which is already in place. The ID column and
// the bank down its left side shrink to nothing on the way (the sidebar has neither),
// instead of vanishing at the end (user note 24).
const SIDE_FONT = 15, ID_W = 0, LAMP_W = 10;

function squeeze(ghost, widths, opts) {
	const reg = ghost.reg, d = opts.duration, anims = [];
	const body = reg.querySelector('.lc-ops-body');
	if (body) body.style.gridTemplateColumns = 'minmax(0, 1fr)'; // the card has its own copy
	reg.style.overflow = 'hidden';
	const last = widths[widths.length - 1].w;
	anims.push(reg.animate(widths.map(({ t, w }) => ({ offset: t, width: `${w}px` })), opts));
	const bank = reg.querySelector('.lc-reg') || reg; // the register proper carries the left bank
	anims.push(bank.animate([{ paddingLeft: getComputedStyle(bank).paddingLeft }, { paddingLeft: '0px' }], { ...opts, easing: EASE }));
	anims.push(bank.animate([{ width: getComputedStyle(bank, '::before').width }, { width: '0px' }], { ...opts, easing: EASE, pseudoElement: '::before' }));
	// The fade starts while it is still moving: left to the end it read as a jump (note 79).
	anims.push(reg.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], opts));
	const head = reg.querySelector('.lc-ops-head');
	if (head) anims.push(head.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, duration: d * 0.35 }));
	const rows = [...reg.querySelectorAll('.lc-reg-cols, .lc-reg-rows .lc-row')];
	const pad = row => { const cs = getComputedStyle(row); return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); };
	for (const row of rows) {
		const from = getComputedStyle(row).gridTemplateColumns;
		const n = from.split(' ').length;
		const kids = [...row.children];
		const nameW = Math.max(40, last - pad(row) - ID_W - LAMP_W); // the left bank is gone by the end
		const to = kids.slice(0, n).map(k => (k.classList.contains('c-id') ? ID_W : k.classList.contains('c-name') ? nameW : k.classList.contains('c-status') ? LAMP_W : 0));
		while (to.length < n) to.push(0);
		const isHead = row.classList.contains('lc-reg-cols');
		anims.push(row.animate([
			{ gridTemplateColumns: from, columnGap: getComputedStyle(row).columnGap },
			{ gridTemplateColumns: to.map(w => `${w}px`).join(' '), columnGap: '0px', ...(isHead ? { opacity: 0 } : { fontSize: `${SIDE_FONT * uiScale()}px` }) },
		], { ...opts, easing: EASE }));
		// Record columns the sidebar doesn't show fade out early.
		for (const k of kids) if (!k.matches('.c-name, .c-status')) anims.push(k.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, duration: d * (k.matches('.c-id') ? 0.8 : 0.45) }));
		for (const k of kids) if (k.matches('.c-id')) k.style.overflow = 'hidden'; // its digits go with its width
	}
	return anims;
}

// Run the move against the panel's settled position. done() after cleanup.
function leaveChoreography(ghost, panel, done) {
	const p = panel.getBoundingClientRect();
	const startDx = Math.max(0, innerWidth - p.left); // its left edge starts at the window's right edge
	const right0 = ghost.rect.right, left0 = ghost.rect.left;
	const side = document.querySelector('._9sPoVBFyE_vE87mnZJ5aB')?.getBoundingClientRect();
	const gap = side?.width ? Math.max(0, p.left - side.right) : 0;
	const panelFrames = [], widths = [];
	for (let i = 0; i <= SAMPLES; i++) {
		const t = i / SAMPLES, dx = startDx * (1 - ease(t));
		panelFrames.push({ offset: t, transform: `translateX(${dx}px)` });
		const edge = Math.min(right0, Math.max(p.left, p.left + dx)); // register ends where the content begins
		widths.push({ t, w: Math.max(0, edge - gap - left0) });
	}
	const opts = { duration: LEAVE_MS, easing: 'linear', fill: 'both' };
	const anims = [panel.animate(panelFrames, opts), ...squeeze(ghost, widths, opts)];
	sliding(anims[0]);
	trail(panel, 1, LEAVE_MS);
	if (ghost.well) anims.push(ghost.well.animate([
		{ transform: 'translateX(0px)' },
		{ transform: `translateX(${innerWidth - ghost.wellRect.left + 40}px)` },
	], { duration: LEAVE_MS * 0.6, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }));
	anims[0].onfinish = () => { for (const a of anims) a.cancel(); ghost.drop(); done?.(); };
	return anims;
}

// Hold the card's content off-screen (clipped) until its swipe starts. A class on
// <html>, not an inline style: Steam replaces the card's node while it renders.
const hold = () => {
	document.documentElement.classList.add('lc-card-hold');
	clearTimeout(hold.t);
	hold.t = setTimeout(release, 2000); // never leave the page hidden if a swipe fails to start
};
const release = () => document.documentElement.classList.remove('lc-card-hold');

const flyItem = (key, attrs, role, lit, label) =>
	`<button type="button" role="${role}" class="lc-mo-item" data-k="${esc(key)}" ${attrs}${role === 'menuitemradio' ? ` aria-checked="${lit}"` : ''}><i class="lc-mo-lamp${lit ? ' on' : ''}"></i>${esc(label)}</button>`;

// Steam's advanced-search (filter) button in its game list header.
const NATIVE_FILTER = '._1TxHdzOt3OD9ikR3xIseKe';
// The game list header row (Home, collections view); the hamburger joins it.
const NATIVE_HEAD = '._2TKEazUUS3TlniZfpc8OOe';

function flyHTML(api) {
	const st = api.state;
	// The sidebar is Steam's own list (round 6): its menu switches views and opens Steam's tools.
	if (st.mode === 'compact') {
		const view = opsMode();
		return `<div class="lc-mo-h">View</div>${
			flyItem('v:ops', 'data-act="ops"', 'menuitemradio', view === 'ops', 'Operations')}${
			flyItem('v:shelves', 'data-act="shelves"', 'menuitemradio', view === 'shelves', 'Shelves')
		}<div class="lc-mo-h">Tools</div>${
			flyItem('a:filter', 'data-act="filter"', 'menuitem', false, 'Library filters')}${
			flyItem('a:downloads', 'data-act="downloads"', 'menuitem', false, 'Downloads')}`;
	}
	const cols = [...registry.columns].map(([id, c]) => flyItem(`s:${id}`, `data-sort="${esc(id)}"`, 'menuitemradio', st.sort === id, c.label)).join('');
	const dirs = [[1, 'Asc'], [-1, 'Desc']].map(([d, t]) => flyItem(`d:${d}`, `data-dir="${d}"`, 'menuitemradio', st.dir === d, t)).join('');
	const tools = toolIds().map(id => flyItem(`t:${id}`, `data-tool="${esc(id)}"`, 'menuitem', false, registry.tools.get(id).label)).join('');
	return `<div class="lc-mo-h">Sort by</div>${cols}${dirs}<div class="lc-mo-h">Tools</div>${tools}`;
}

export function install() {
	window[KEY]?.stop();
	const api0 = ops();
	const S = {
		prev: { mode: api0?.state.mode || 'full', appid: api0?.state.openApp || 0 },
		back: false,  // last history move was back or forward
		away: !currentPath().startsWith('/library'), // on a web page (store, community)
		path: currentPath(), // last history location, to tell moves from re-writes
		anims: new Set(),
		bars: new Set(),
		btn: null,
		fly: null,
		unsubs: [],
	};

	// Animations run unless reduced motion is on; then `done` runs at once.
	const run = (node, frames, opts, done) => {
		const a = reduced() || !node?.animate ? null : node.animate(frames, { easing: EASE, ...opts });
		if (!a) { done?.(); return null; }
		S.anims.add(a);
		a.onfinish = () => { S.anims.delete(a); done?.(); };
		a.oncancel = () => S.anims.delete(a);
		return a;
	};

	// Register width change. Animating flex-basis matters: ops.css sets 300px as the basis.
	const resize = (root, from, to) => run(root, [
		{ flexBasis: `${from}px`, width: `${from}px` },
		{ flexBasis: `${to}px`, width: `${to}px` },
	], { duration: SHRINK_MS });

	const cardIn = card => {
		release(card);
		const r = card.getBoundingClientRect();
		sliding(run(card, [
			{ transform: `translateX(${CARD_PX}px)`, clipPath: 'inset(0 0 0 100%)' },
			{ transform: 'translateX(0px)', clipPath: 'inset(0 0 0 0%)' },
		], { duration: CARD_MS }));
		trail(card, 1, CARD_MS);
		const bar = el('div', 'lc-mo-lead');
		bar.style.left = `${r.left}px`;
		bar.style.top = `${r.top}px`;
		bar.style.height = `${r.height}px`;
		document.body.append(bar);
		S.bars.add(bar);
		const drop = () => { bar.remove(); S.bars.delete(bar); };
		run(bar, [
			{ transform: 'translateX(0px)' },
			{ transform: `translateX(${r.width - LEAD_PX}px)` },
		], { duration: CARD_MS }, drop);
	};

	const enter = (root, fromW) => {
		const appid = Number(/^\/library\/app\/(\d+)/.exec(currentPath())?.[1] || 0);
		if (S.ghost) {
			const ghost = S.ghost;
			S.ghost = null;
			hold();
			whenRendered(root, appid, card => { release(); leaveChoreography(ghost, card); });
			setTimeout(() => ghost.reg.isConnected && !ghost.reg.getAnimations().length && ghost.drop(), 2500); // never strand it
			return;
		}
		if (!reduced()) hold();
		requestAnimationFrame(() => {
			if (!root.isConnected) return;
			const toW = root.getBoundingClientRect().width;
			if (fromW > 1 && Math.abs(toW - fromW) > 1) resize(root, fromW, toW);
			whenRendered(root, appid, cardIn);
		});
	};

	const exit = (root, fromW) => {
		const scroll = root.querySelector('.lc-reg-scroll');
		const top = scroll ? scroll.scrollTop : 0;
		const card = gameCard(root);
		if (card) run(card, [
			{ transform: 'translateX(0px)', clipPath: 'inset(0 0 0 0%)' },
			{ transform: `translateX(${CARD_PX}px)`, clipPath: 'inset(0 0 0 100%)' },
		], { duration: CARD_MS });
		requestAnimationFrame(() => {
			if (!root.isConnected) return;
			const toW = root.getBoundingClientRect().width;
			if (fromW > 1 && toW - fromW > 1) resize(root, fromW, toW);
			if (scroll && scroll.scrollTop !== top) scroll.scrollTop = top;
		});
	};

	// Sidebar to sidebar (a game, another game, or the SHELVES home): Steam's list
	// stays put and only the content changes. The old content is frozen at the
	// history push and stays up while Steam renders the new page (~0.5 s, the
	// blank gap the user saw); then the new page pushes it out sideways: from the
	// right for a game page, from the left for the home. Both are clipped to
	// the content area, so the sidebar is never crossed.
	const swap = (root, appid) => {
		const g = S.push;
		S.push = null;
		if (!g) return;
		hold();
		whenRendered(root, appid, card => {
			release();
			const W = card.getBoundingClientRect().width, dir = g.dir;
			for (const a of card.getAnimations()) a.cancel();
			sliding(run(card, [
				{ transform: `translateX(${dir * W}px)`, clipPath: dir > 0 ? `inset(0 ${W}px 0 0)` : `inset(0 0 0 ${W}px)` },
				{ transform: 'translateX(0px)', clipPath: 'inset(0 0 0 0)' },
			], { duration: SWAP_MS }));
			trail(card, dir, SWAP_MS);
			run(g.copy, [
				{ transform: 'translateX(0px)', clipPath: 'inset(0 0 0 0)' },
				{ transform: `translateX(${-dir * W}px)`, clipPath: dir > 0 ? `inset(0 0 0 ${W}px)` : `inset(0 ${W}px 0 0)` },
			], { duration: SWAP_MS, fill: 'forwards' }, () => g.drop());
		});
		setTimeout(() => g.copy.isConnected && !g.copy.getAnimations().length && g.drop(), 2500); // never strand it
	};

	/* ------------------------------------------------------- hamburger */

	const closeFly = refocus => {
		if (!S.fly) return;
		S.fly.remove();
		S.fly = null;
		S.btn?.setAttribute('aria-expanded', 'false');
		document.removeEventListener('pointerdown', onPointer, true);
		document.removeEventListener('keydown', onEsc, true);
		if (refocus && S.btn?.isConnected) S.btn.focus({ preventScroll: true });
	};

	const items = () => (S.fly ? [...S.fly.querySelectorAll('button')] : []);

	const redraw = key => {
		const api = ops();
		if (!S.fly || !api) return;
		S.fly.innerHTML = flyHTML(api);
		items().find(b => b.dataset.k === key)?.focus({ preventScroll: true });
	};

	const onFlyClick = e => {
		const b = e.target.closest('button');
		const api = ops();
		if (!b || !api) return;
		if (b.dataset.act) {
			const act = b.dataset.act;
			closeFly(false);
			if (act === 'ops' || act === 'shelves') { setOpsMode(act); navigate('/library/home'); }
			else if (act === 'filter') document.querySelector(NATIVE_FILTER)?.click();
			else navigate('/library/downloads');
			return;
		}
		if (b.dataset.tool) {
			const tool = registry.tools.get(b.dataset.tool);
			closeFly(false);
			tool?.run(S.btn);
			return;
		}
		const st = api.state;
		if (b.dataset.sort) {
			const id = b.dataset.sort;
			api.sortBy(id, id === st.sort ? st.dir : (registry.columns.get(id)?.dir || -1));
		} else if (b.dataset.dir) {
			api.sortBy(st.sort, Number(b.dataset.dir));
		}
		redraw(b.dataset.k);
	};

	const onFlyKey = e => {
		e.stopPropagation(); // the register's keys must not act behind the menu
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const list = items();
			if (!list.length) return;
			const step = e.key === 'ArrowDown' ? 1 : -1;
			const i = list.indexOf(document.activeElement);
			const n = i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length;
			list[n].focus({ preventScroll: true });
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeFly(true);
		} else if (e.key === 'Tab') {
			closeFly(false);
		}
	};

	const onPointer = e => {
		if (S.fly && !S.fly.contains(e.target) && !S.btn?.contains(e.target)) closeFly(false);
	};

	const onEsc = e => {
		if (e.key !== 'Escape' || !S.fly) return;
		e.preventDefault();
		e.stopPropagation();
		closeFly(true);
	};

	const openFly = () => {
		const api = ops();
		if (!api || !S.btn?.isConnected || S.fly) return;
		const fly = el('div', 'lc-mo-fly');
		fly.setAttribute('role', 'menu');
		fly.tabIndex = -1;
		fly.innerHTML = flyHTML(api);
		// On the page itself: the button now lives in Steam's list header, not the register.
		document.body.append(fly);
		const hb = S.btn.getBoundingClientRect();
		fly.style.left = `${hb.left}px`;
		fly.style.top = `${hb.bottom + 6}px`;
		fly.addEventListener('click', onFlyClick);
		fly.addEventListener('keydown', onFlyKey);
		S.fly = fly;
		S.btn.setAttribute('aria-expanded', 'true');
		document.addEventListener('pointerdown', onPointer, true);
		document.addEventListener('keydown', onEsc, true);
		items()[0]?.focus({ preventScroll: true });
	};

	const makeButton = () => {
		const b = el('button', 'lc-mo-menu');
		b.type = 'button';
		b.textContent = '☰';
		b.title = 'Register menu';
		b.setAttribute('aria-label', 'Register menu');
		b.setAttribute('aria-haspopup', 'menu');
		b.setAttribute('aria-expanded', 'false');
		b.addEventListener('click', () => (S.fly ? closeFly(true) : openFly()));
		b.addEventListener('keydown', e => {
			e.stopPropagation(); // Enter on the register opens a game; not from here
			if (e.key === 'ArrowDown') { e.preventDefault(); openFly(); }
		});
		return b;
	};

	// Sidebar only: the button joins Steam's list header, beside Home.
	const syncMenu = mode => {
		const slot = document.querySelector(NATIVE_HEAD);
		if (mode !== 'compact' || !slot) { closeFly(false); S.btn?.remove(); return; }
		if (!S.btn) S.btn = makeButton();
		if (S.btn.parentElement !== slot) slot.append(S.btn);
	};

	/* ------------------------------------------------------ hooks */

	/* ------------------------------------------- library <-> store / community
	 * Steam shows web pages in a native view that covers the window's DOM, so
	 * the view itself is what moves (webSlide below): the store or community
	 * page slides in over the library and off it again. arrive() is the
	 * fallback library swipe-in for when the view can't be wrapped. */

	const libraryParts = () => {
		const lib = document.querySelector('._3xRRJfD2xy95i9NhJxLTp0');
		if (!lib) return null;
		const full = document.documentElement.classList.contains('lc-ops-full');
		const side = full ? ops()?.root : lib.querySelector('._9sPoVBFyE_vE87mnZJ5aB');
		const card = lib.querySelector(`:scope > ${CARD}`);
		return { side, card: card && card.getBoundingClientRect().width ? card : null, full };
	};

	/* The web view itself slides (user, round 6: "still just a hard black wipe").
	 * It is a native layer over the window that only moves through its own
	 * SetBounds, so its calls are wrapped (they are own properties of the
	 * instance: restore by assignment, never delete):
	 * - shown: kept off the right edge until the page has loaded, then slid in;
	 * - leaving (Steam blanks it with a data: URL, hides it, zeroes its bounds):
	 *   those calls are held while the live page slides off to the right over
	 *   the library, which Steam has already drawn underneath, then replayed. */
	const WEB_IN_MS = 520, WEB_OUT_MS = 440;
	const webSlide = (() => {
		const mgr = host().MainWindowBrowserManager, b = mgr?.m_browser;
		// The view outlives this window's scripts (it belongs to SharedJSContext): unwrap a previous install first.
		try { b?.SetBounds?.__lcStop?.(); } catch (_) { /* its window is gone; the restore below is all that matters */ }
		if (!b || typeof b.SetBounds !== 'function' || b.SetBounds.__lcWeb) return null;
		const orig = { SetVisible: b.SetVisible, SetBounds: b.SetBounds, LoadURL: b.LoadURL };
		let shown = false, target = null, phase = null, pending = [], frame = 0;
		const put = x => target && orig.SetBounds.call(b, Math.round(x), target[1], target[2], target[3]);
		const slide = (from, to, ms, curve, done) => {
			cancelAnimationFrame(frame);
			const t0 = performance.now();
			const step = now => {
				const t = Math.min(1, (now - t0) / ms);
				put(from + (to - from) * curve(t));
				if (t < 1) frame = requestAnimationFrame(step); else done();
			};
			frame = requestAnimationFrame(step);
		};
		// Steam's store navigation takes ~2 s to commit; until then the view only has
		// its blank page. So the library stays on screen (html.lc-web-wait) and the
		// view slides in over it once the new page commits and gets a first paint.
		// The page says when its own frame is painted (js/web/transitions.js). Pages
		// without that script land 1.5 s after they commit.
		let committed = 0, framed = 0;
		const onLoading = url => { if (!/^data:/.test(String(url))) committed = performance.now(); };
		const onMessage = name => { if (name === 'lcars-page-ready') framed = performance.now(); };
		try { b.on('start-loading', onLoading); b.on('message', onMessage); } catch (_) { /* no events: the cap below still lands it */ }
		const loaded = () => new Promise(res => {
			const t0 = performance.now();
			const poll = () => {
				const now = performance.now();
				if (framed > t0 || (committed > t0 && now - committed > 1500) || now - t0 > 4000) res();
				else setTimeout(poll, 30);
			};
			poll();
		});
		const waiting = on => document.documentElement.classList.toggle('lc-web-wait', on);

		// The frame arrives first (user, round 6: "frame it"): the page's bottom rail
		// (css/web-frame.css markup; the top rail is Steam's URL bar, css/frame.css)
		// slides in over the library at once, and the page drops in behind it when it is ready.
		let curtain = null;
		const curtainIn = () => {
			curtain?.remove();
			const c = el('div', 'lc-web-curtain');
			// The top rail is Steam's URL bar above it (css/frame.css), not part of the curtain.
			c.innerHTML = `<div id="lc-web-frame"><div class="lc-web-rail lc-web-bottom"></div></div>`;
			Object.assign(c.style, { left: `${target[0]}px`, top: `${target[1]}px`, width: `${target[2]}px`, height: `${target[3]}px` });
			document.body.append(c);
			curtain = c;
			return c.animate([{ transform: `translateX(${innerWidth - target[0]}px)` }, { transform: 'translateX(0px)' }],
				{ duration: WEB_IN_MS, easing: EASE, fill: 'backwards' }).finished.catch(() => {});
		};
		const curtainOut = (now = false) => {
			const c = curtain;
			curtain = null;
			if (c) setTimeout(() => c.remove(), now ? 0 : 250); // the page is on top of it by then
		};
		const wrap = (k, fn) => { fn.__lcWeb = true; b[k] = fn; };
		wrap('SetBounds', function (...a) {
			if (a[2] > 0) target = a;
			if (phase === 'out') { pending.push(['SetBounds', a]); return undefined; }
			if (phase === 'in') return undefined; // the slide reads `target` every frame
			return orig.SetBounds.apply(b, a);
		});
		wrap('SetVisible', function (v) {
			if (phase === 'out') { pending.push(['SetVisible', [v]]); return undefined; }
			if (v && !shown && target && !reduced()) {
				shown = true;
				phase = 'in';
				waiting(true);
				put(innerWidth); // off the right edge while it loads
				const r = orig.SetVisible.call(b, true);
				Promise.all([loaded(), curtainIn()]).then(() => {
					if (phase !== 'in') return;
					phase = null;
					waiting(false);
					orig.SetBounds.apply(b, target); // into the frame, which it draws itself
					curtainOut();
				});
				return r;
			}
			if (!v && phase === 'in') { cancelAnimationFrame(frame); phase = null; waiting(false); curtainOut(true); }
			shown = !!v;
			return orig.SetVisible.call(b, v);
		});
		wrap('LoadURL', function (url, ...rest) {
			if (shown && phase === null && target && !reduced() && /^data:/.test(String(url))) {
				phase = 'out';
				pending = [['LoadURL', [url, ...rest]]];
				const keep = target;
				slide(keep[0], innerWidth, WEB_OUT_MS, t => t * t * t, () => {
					phase = null;
					shown = false;
					for (const [k, a] of pending) b[k](...a); // through the wrappers, so state follows
					pending = [];
				});
				return undefined;
			}
			if (phase === 'in' && /^data:/.test(String(url))) { cancelAnimationFrame(frame); phase = null; waiting(false); curtainOut(true); }
			return orig.LoadURL.call(b, url, ...rest);
		});
		const stop = () => {
			cancelAnimationFrame(frame);
			waiting(false);
			curtainOut(true);
			try { b.off('start-loading', onLoading); b.off('message', onMessage); } catch (_) { /* nothing to remove */ }
			for (const k of Object.keys(orig)) b[k] = orig[k];
			for (const [k, a] of pending) orig[k].apply(b, a);
			pending = [];
			if (target && shown) orig.SetBounds.apply(b, target);
		};
		b.SetBounds.__lcStop = stop;
		return { stop };
	})();

	const arrive = () => {
		if (reduced() || webSlide) return; // the web view slides off the library instead
		// After Steam's commit for the new route, before it paints.
		setTimeout(() => requestAnimationFrame(() => {
			const parts = libraryParts();
			if (!parts) return;
			if (parts.side) run(parts.side, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: BACK_MS });
			if (parts.full) {
				const well = parts.side?.querySelector('.lc-well');
				const w = well?.getBoundingClientRect();
				if (w?.width) run(well, [{ transform: `translateX(${innerWidth - w.left}px)` }, { transform: 'translateX(0px)' }],
					{ duration: BACK_MS * 0.5, delay: BACK_MS * 0.6, fill: 'backwards' });
			} else if (parts.card) cardIn(parts.card);
		}), 0);
	};

	const takeGrow = () => { S.grow?.drop(); S.grow = reduced() ? null : contentGhost(); };

	const onModeWill = mode => {
		const root = ops()?.root;
		if (mode === 'compact' && S.prev.mode !== 'compact' && root?.isConnected && !reduced()) {
			S.ghost?.drop();
			settle();
			S.ghost = makeGhost(root);
		} else if (mode === 'full' && S.prev.mode === 'compact' && !S.grow) takeGrow();
	};

	const grow = root => {
		const g = S.grow;
		S.grow = null;
		// The full layout lands at the end of this task; measure it before it paints.
		requestAnimationFrame(() => {
			if (!root.isConnected) { g.drop(); return; }
			growChoreography(root, g, a => { S.anims.add(a); a.addEventListener('finish', () => S.anims.delete(a)); a.addEventListener('cancel', () => S.anims.delete(a)); });
		});
	};

	const onMode = (mode, appid) => {
		const prev = S.prev;
		S.prev = { mode, appid };
		const root = ops()?.root;
		if (!root) return;
		// Measure before the dock class and html class change below.
		const fromW = root.getBoundingClientRect().width;
		root.classList.toggle('lc-mo-dock', mode === 'compact');
		syncMenu(mode);
		if (mode === 'compact' && prev.mode !== 'compact') enter(root, fromW);
		else if (mode === 'compact' && prev.appid !== appid) swap(root, appid);
		else if (mode !== 'compact' && prev.mode === 'compact') { if (S.grow) grow(root); else exit(root, fromW); }
		if (S.push) { S.push.drop(); S.push = null; } // swap() takes it at once; anything left is unused
	};

	const stop = () => {
		release();
		S.ghost?.drop();
		S.ghost = null;
		S.grow?.drop();
		S.grow = null;
		S.push?.drop();
		S.push = null;
		webSlide?.stop();
		for (const off of S.unsubs) off();
		closeFly(false);
		S.btn?.remove();
		S.btn = null;
		for (const a of S.anims) a.cancel();
		S.anims.clear();
		for (const n of S.bars) n.remove();
		S.bars.clear();
		document.querySelectorAll('.lc-mo-marker').forEach(n => n.remove());
		ops()?.root.classList.remove('lc-mo-dock');
		if (window[KEY]?.stop === stop) delete window[KEY];
	};

	window[KEY] = { stop };

	S.unsubs.push(on('modeWillChange', onModeWill), on('modeChange', onMode));

	// Freeze the content before Steam re-renders it. History listeners can run
	// after the router has already drawn the new page (going home did), so the
	// copy is taken inside the history's own methods, before the move; the
	// listener below then keeps it for a push or a grow, or drops it.
	let preCopy = null;
	// Hooked whenever the main window's history changes: this module can load before the
	// window has one, and the window-params plugin's rebuild swaps it for a new one; either
	// way the old hooks saw no moves and the record page just appeared, no slide.
	let hooked = null;
	const hook = () => {
		const hist = mainHistory();
		if (!hist || hist === hooked) return;
		hooked = hist;
		for (const k of ['push', 'replace', 'go', 'goBack', 'goForward']) {
			const orig = hist?.[k];
			if (typeof orig !== 'function' || orig.__lcOrig) continue;
			const own = Object.prototype.hasOwnProperty.call(hist, k);
			const fn = function (...args) {
				// Steam re-writes the entry it is on after a game page loads; that is no
				// move, and settling here would cut a running squeeze short.
				const to = typeof args[0] === 'string' ? args[0] : args[0]?.pathname;
				const same = (k === 'push' || k === 'replace') && typeof to === 'string' && to.split(/[?#]/)[0] === currentPath();
				if (!same && !reduced() && !S.away && ops()?.state.mode === 'compact' && currentPath().startsWith('/library')) {
					preCopy?.drop();
					S.push?.drop(); S.push = null;
					S.grow?.drop(); S.grow = null;
					settle();
					preCopy = contentGhost();
				}
				return orig.apply(this, args);
			};
			fn.__lcOrig = orig;
			hist[k] = fn;
			S.unsubs.push(() => { if (own) hist[k] = orig; else delete hist[k]; });
		}
		S.unsubs.push(() => { preCopy?.drop(); preCopy = null; });

		try {
			const off = hist.listen?.((loc, action) => {
				S.back = /pop/i.test(String(action ?? ''));
				const lib = String(loc?.pathname || '').startsWith('/library'), wasAway = S.away;
				if (lib && wasAway) arrive();
				S.away = !lib;
				const p = String(loc?.pathname || ''), compact = ops()?.state.mode === 'compact';
				let copy = preCopy;
				preCopy = null;
				// Steam re-writes the entry it is on (a replace after a game page loads):
				// not a move, and a copy kept here would freeze the live page under it.
				if (p === S.path) { copy?.drop(); copy = null; }
				S.path = p;
				// Leaving a game page for the OPS home: the old page is what the register pushes away.
				if (copy && p === '/library/home' && opsMode() === 'ops' && compact) { S.grow?.drop(); S.grow = copy; }
				// Staying in the sidebar layout (game, game, SHELVES home): the old page gets pushed out.
				else if (copy && compact && !wasAway && (/^\/library\/app\/\d+/.test(p) || (p === '/library/home' && opsMode() === 'shelves'))) {
					S.push?.drop();
					S.push = copy;
					// A game page always arrives from the right, the home from the left. Not from the
					// history action: browser forward is a pop too, so it read as going back.
					copy.dir = p === '/library/home' ? -1 : 1;
				} else copy?.drop();
			});
			if (typeof off === 'function') S.unsubs.push(off);
		} catch (_) { /* no listener: moves count as forward */ }
	};
	hook();
	const rehook = setInterval(hook, 500);
	S.unsubs.push(() => clearInterval(rehook));

	// Install may run after the register already shows a mode.
	const root0 = api0?.root;
	if (root0) {
		root0.classList.toggle('lc-mo-dock', S.prev.mode === 'compact');
		syncMenu(S.prev.mode);
	}
}
