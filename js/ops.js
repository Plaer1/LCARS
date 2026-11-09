// LCARSv2 operations screen: replaces the library home with a console of
// the actual library. A dense register (virtualised; every column is live
// Steam data) with status tabs, a collection selector and search, and a
// bracketed detail well for the selected record with working commands.
// Steam's own shelves stay one click away (SHELVES / OPS toggle).
//
// This file is the core. Columns, tabs and filters are registered through
// ops-api.js, which is also where other modules (column tools, filter
// drawer, motion) hook in; see .clanker/futures/lcarsv2-round5/s02-*.md.

import {
	beep, bytes, capsuleURLs, collections, countUp, currentPath, dateCode, ago,
	gameMenu, host, hours, navigate, pad, record, rowHeight, statusOf, year,
} from './data.js';
import {
	registry, prefs, emit, on, visibleColumns, columnTemplate, nameWidth, visibleTabs,
} from './ops-api.js';

const KEY = '__lcarsV2OpsV1';
const HOST = '._3xRRJfD2xy95i9NhJxLTp0'; // library columns: [game list][main panel]
const PREF = 'lcarsv2-ops-off';
const COMPACT_COLUMNS = ['appid', 'name', 'status'];

const h = (tag, cls, html = '') => {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html) e.innerHTML = html;
	return e;
};

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function getPref() { try { return localStorage.getItem(PREF) === '1'; } catch (_) { return false; } }
function setPref(off) { try { off ? localStorage.setItem(PREF, '1') : localStorage.removeItem(PREF); } catch (_) {} }

/* ------------------------------------------------- built-in registrations */

const num = (a, b) => a - b;

function registerBuiltins() {
	const C = registry.columns;
	// 80 px holds a full 8-digit ID at the cell's type and padding.
	C.set('appid', { label: 'ID', width: '80px', min: 80, cls: 'c-id', cell: r => r.appid, cmp: (a, b) => a.appid - b.appid, dir: 1 });
	C.set('name', { label: 'Name', width: 'minmax(0, 1fr)', min: 160, cls: 'c-name', cell: r => esc(r.name), cmp: (a, b) => a.sortAs.localeCompare(b.sortAs), dir: 1 });
	C.set('status', { label: 'Status', width: '140px', min: 70, cls: 'c-status', cell: r => r.status.text, cmp: (a, b) => a.status.text.localeCompare(b.status.text), dir: 1 });
	C.set('minutes', { label: 'Hours', width: '76px', min: 56, cls: 'c-num', cell: r => (r.minutes ? hours(r.minutes) : '—'), cmp: (a, b) => num(a.minutes, b.minutes), dir: -1 });
	C.set('last', { label: 'Last run', width: '96px', min: 70, cls: 'c-num', cell: r => dateCode(r.last), cmp: (a, b) => num(a.last, b.last), dir: -1 });
	C.set('size', { label: 'Size', width: '86px', min: 60, cls: 'c-num', cell: r => (r.installed ? bytes(r.size) : '—'), cmp: (a, b) => num(a.size, b.size), dir: -1 });
	C.set('review', { label: 'Rating', width: '74px', min: 56, cls: 'c-num', cell: r => (r.review ? r.review + '%' : '—'), cmp: (a, b) => num(a.review, b.review), dir: -1 });

	const T = registry.tabs;
	T.set('all', { label: 'All', test: () => true });
	T.set('installed', { label: 'Installed', test: r => r.installed });
	T.set('recent', { label: 'Recent', test: r => r.recent > 0 || (r.last && Date.now() / 1000 - r.last < 30 * 86400) });
	T.set('unplayed', { label: 'Unplayed', test: r => r.minutes === 0 });
	T.set('missing', { label: 'Not installed', test: r => !r.installed });
}

/* ----------------------------------------------------------------- build */

function build() {
	const state = {
		coll: 'all', tab: 'all', sort: prefs.get('sort', 'last'), dir: prefs.get('dir', -1), query: '',
		filters: new Map(), // filter id -> value (registry.filters); null/undefined = inactive
		all: [], view: [], selected: null, openApp: 0, mode: 'full',
	};

	const root = h('div', 'lc-ops');
	root.tabIndex = 0;
	root.innerHTML = `
		<header class="lc-ops-head">
			<div class="lc-ops-backbar"><button class="lc-ops-back" title="Back to the operations screen">Operations</button><div class="lc-ops-slot-back"></div></div>
			<div class="lc-ops-rail"><h1 class="lc-ops-title">Operations</h1><b class="lc-ops-total"></b></div>
			<div class="lc-ops-controls">
				<nav class="lc-ops-tabs"></nav>
				<button class="lc-ops-coll" aria-haspopup="listbox"><span>All games</span></button>
				<label class="lc-ops-search"><span>Search</span><input type="text" spellcheck="false" placeholder="Name"></label>
			</div>
			<div class="lc-ops-slot-under-tabs"></div>
			<div class="lc-ops-pop" hidden></div>
		</header>
		<section class="lc-ops-body">
			<div class="lc-reg">
				<div class="lc-reg-cols"></div>
				<div class="lc-reg-scroll"><div class="lc-reg-spacer"><div class="lc-reg-rows"></div></div></div>
				<footer class="lc-reg-foot"></footer>
			</div>
			<aside class="lc-well"></aside>
		</section>`;

	const $ = s => root.querySelector(s);
	const scroll = $('.lc-reg-scroll'), spacer = $('.lc-reg-spacer'), rows = $('.lc-reg-rows');
	const well = $('.lc-well'), pop = $('.lc-ops-pop'), search = $('.lc-ops-search input');
	const head = $('.lc-reg-cols'), tabs = $('.lc-ops-tabs');

	// Columns shown right now: the user's set in full mode, a fixed three in the sidebar.
	const columns = () => (state.mode === 'compact'
		? COMPACT_COLUMNS.filter(id => registry.columns.has(id)).map(id => ({ id, ...registry.columns.get(id) }))
		: visibleColumns());

	const renderHeader = () => {
		const cols = columns();
		if (!registry.columns.has(state.sort)) state.sort = 'name';
		head.innerHTML = cols.map(c => `<button data-sort="${c.id}" data-col="${c.id}" class="${c.align === 'left' ? 'al' : ''}">${esc(c.label)}</button>`).join('');
		if (state.mode !== 'compact') root.style.setProperty('--lc-cols', columnTemplate(cols));
		else root.style.removeProperty('--lc-cols');
		markSort();
		emit('headerRender', head);
		fit();
	};

	const markSort = () => {
		for (const b of head.querySelectorAll('[data-sort]')) {
			b.classList.toggle('on', b.dataset.sort === state.sort);
			b.dataset.dir = b.dataset.sort === state.sort ? (state.dir > 0 ? 'up' : 'down') : '';
		}
	};

	const renderTabs = () => {
		const list = visibleTabs();
		if (!list.some(t => t.id === state.tab)) state.tab = list[0]?.id || 'all';
		tabs.innerHTML = list.map(t => `<button data-tab="${esc(t.id)}">${esc(t.label)}<i></i></button>`).join('');
		countTabs();
	};

	// Tab counts are part of the data, so they read as hanging ID blocks.
	// Games hidden in Steam stay out unless the filter drawer's chip (or the Hidden tab) asks.
	const showHidden = () => Boolean(state.filters.get('f:hidden')?.length);
	const listed = (tabId = state.tab) => (showHidden() || tabId === 'sys:hidden' ? state.all : state.all.filter(r => !r.hidden));

	const countTabs = () => {
		for (const b of tabs.querySelectorAll('[data-tab]')) {
			const t = registry.tabs.get(b.dataset.tab);
			b.querySelector('i').textContent = t ? listed(b.dataset.tab).filter(r => t.test(r)).length : '';
			b.classList.toggle('on', b.dataset.tab === state.tab);
		}
	};

	const load = () => {
		const c = collections().find(x => x.id === state.coll) || collections()[0];
		if (!c) { state.all = []; return; }
		$('.lc-ops-coll span').textContent = c.name;
		state.all = [...c.apps()].map((a, i) => record(a, i));
		countTabs();
	};

	const passes = r => {
		for (const [id, value] of state.filters) {
			if (value == null) continue;
			const f = registry.filters.get(id);
			if (f && !f.test(r, value)) return false;
		}
		return true;
	};

	const apply = (quiet = false) => {
		const tab = registry.tabs.get(state.tab) || registry.tabs.get('all');
		const q = state.query.trim().toLowerCase();
		const col = registry.columns.get(state.sort) || registry.columns.get('name');
		const pool = listed();
		if (showHidden() !== apply.hidden) {
			apply.hidden = showHidden();
			countTabs();
		}
		state.view = pool.filter(r => tab.test(r) && passes(r) && (!q || r.name.toLowerCase().includes(q)))
			.sort((a, b) => state.dir * col.cmp(a, b) || a.sortAs.localeCompare(b.sortAs));
		for (const b of tabs.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === state.tab);
		markSort();
		spacer.style.height = `${state.view.length * rowHeight()}px`;
		if (!state.view.includes(state.selected)) state.selected = state.view[0] || null;
		$('.lc-ops-total').textContent = pad(pool.length, 4);
		const inst = state.view.filter(r => r.installed);
		$('.lc-reg-foot').innerHTML = `
			<span><em>Shown</em> ${state.view.length.toLocaleString()} / ${pool.length.toLocaleString()}</span>
			<span><em>Installed</em> ${inst.length}</span>
			<span><em>Logged</em> ${Math.round(state.view.reduce((s, r) => s + r.minutes, 0) / 60).toLocaleString()} hrs</span>
			<span><em>On disk</em> ${bytes(inst.reduce((s, r) => s + r.size, 0))}</span>`;
		if (!quiet) { // rows scan in after the data changes, not on a background refresh
			rows.classList.add('boot');
			clearTimeout(apply.boot);
			apply.boot = setTimeout(() => rows.classList.remove('boot'), 900);
		}
		paint(true);
		detail();
		emit('afterRefresh', state.view);
	};

	let painted = [-1, -1];
	const paint = force => {
		const top = scroll.scrollTop, hgt = scroll.clientHeight, ROW = rowHeight(); // the sidebar rows meet it (css/sidebar.css)
		const from = Math.max(0, Math.floor(top / ROW) - 8);
		const to = Math.min(state.view.length, Math.ceil((top + hgt) / ROW) + 8);
		if (!force && from === painted[0] && to === painted[1]) return;
		painted = [from, to];
		const cols = columns();
		rows.style.transform = `translateY(${from * ROW}px)`;
		rows.innerHTML = state.view.slice(from, to).map((r, i) => `
			<div class="lc-row${r === state.selected ? ' sel' : ''}${r.appid === state.openApp ? ' open' : ''} t-${r.status.tone}" data-i="${from + i}" style="--i:${i}">${
				cols.map(c => `<span class="${c.cls || 'c-num'}" data-col="${c.id}">${c.cell(r)}</span>`).join('')
			}</div>`).join('');
		emit('rowsPainted', rows);
	};

	const select = (r, { reveal = false, sound = true } = {}) => {
		if (!r || r === state.selected) return;
		state.selected = r;
		if (sound) beep('select');
		if (reveal) {
			const ROW = rowHeight(), i = state.view.indexOf(r), y = i * ROW;
			if (y < scroll.scrollTop) scroll.scrollTop = y;
			else if (y + ROW > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = y + ROW - scroll.clientHeight;
		}
		paint(true);
		detail();
		emit('select', r);
	};

	// RunGame returns at once and Steam takes seconds to report the launch: the command
	// says so meanwhile, and a second press can't start the game twice.
	let launching = null;
	const LAUNCH_MS = 20000;
	const isLaunching = appid => launching?.appid === appid && Date.now() < launching.until;

	const run = r => {
		if (!r) return;
		if (isLaunching(r.appid) && statusOf(r.app).code !== 4) return;
		beep('command');
		const SC = host().SteamClient; // the main window's own SteamClient lacks Apps/Installs/URL
		const gameId = String(r.app.m_gameid || r.appid);
		const { code } = statusOf(r.app);
		if (code === 4) SC?.Apps?.TerminateApp?.(gameId, false);
		else if (r.installed) { launching = { appid: r.appid, until: Date.now() + LAUNCH_MS }; SC?.Apps?.RunGame?.(gameId, '', -1, 100); syncStatus(); }
		else SC?.Installs?.OpenInstallWizard?.([r.appid]);
	};

	const open = r => { if (!r) return; beep('nav'); emit('open', r); navigate(`/library/app/${r.appid}`); };

	// The main command says what a press would do now, as the game changes state.
	const runLabel = ({ code, text }, appid) => (code === 0 ? 'Install' : code === 4 ? 'Stop' : [1, 2, 3, 5, 6, 7, 8].includes(code) ? text : isLaunching(appid) ? 'Launching' : 'Play');

	const syncStatus = () => {
		const r = state.selected;
		if (!r || state.mode !== 'full') return;
		// Steam may hand out a new overview object when an app's state changes; read the
		// current one, or the button kept the state it had when the list was built (note 11).
		r.app = host().appStore?.GetAppOverviewByAppID?.(r.appid) || r.app;
		const status = statusOf(r.app);
		if (status.code === 4) launching = null;
		const command = well.querySelector('.cmd-run');
		if (command && command.textContent !== runLabel(status, r.appid)) command.textContent = runLabel(status, r.appid);
		if (status.code === r.status.code) return;
		r.status = status;
		r.installed = status.code !== 0;
		const pill = well.querySelector('.lc-well-status');
		if (pill) {
			pill.className = `lc-well-status t-${status.tone}`;
			pill.textContent = status.text;
		}
		paint(true);
	};
	const statusTimer = setInterval(syncStatus, 1000);

	const detail = () => {
		const r = state.selected;
		if (!r) { well.innerHTML = '<div class="lc-well-empty">No records</div>'; return; }
		const art = capsuleURLs(r.app);
		well.innerHTML = `
			<div class="lc-well-frame">
				<div class="lc-well-art">${art.length ? `<img src="${esc(art[0])}" alt="">` : ''}<b>${r.appid}</b></div>
				<h2 class="lc-well-name">${esc(r.name)}</h2>
				<div class="lc-well-status t-${r.status.tone}">${r.status.text}</div>
				<dl class="lc-well-data">
					<div class="d-hours"><dt>Hours logged</dt><dd data-n="${r.minutes / 60}">0</dd></div>
					<div class="d-2w"><dt>Last 2 weeks</dt><dd data-n="${r.recent / 60}">0</dd></div>
					<div class="d-last"><dt>Last session</dt><dd>${dateCode(r.last)}<small>${ago(r.last)}</small></dd></div>
					<div class="d-size"><dt>On disk</dt><dd>${r.installed ? bytes(r.size) : '—'}</dd></div>
					<div class="d-review"><dt>User rating</dt><dd>${r.review ? r.review + '<small>%</small>' : '—'}</dd></div>
					<div class="d-year"><dt>Released</dt><dd>${year(r.released)}</dd></div>
				</dl>
				<div class="lc-well-cmds">
					<button class="cmd-run">${runLabel(r.status, r.appid)}</button>
					<button class="cmd-open">Open record</button>
					<button class="cmd-store">Store page</button>
				</div>
				<div class="lc-ops-slot-well"></div>
			</div>`;
		// Next candidate on a failed load; none left means no art rather than a broken-image icon.
		const artImg = well.querySelector('.lc-well-art img');
		let artTried = 0;
		artImg?.addEventListener('error', () => {
			if (++artTried < art.length) artImg.src = art[artTried];
			else artImg.remove();
		});
		// Played from here, not CSS: a CSS animation on it restarted on every header hover.
		if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
			well.querySelector('.lc-well-art img')?.animate(
				[{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, clipPath: 'inset(0)' }],
				{ duration: 400, easing: 'ease-out' },
			);
		}
		for (const dd of well.querySelectorAll('dd[data-n]')) countUp(dd, Number(dd.dataset.n), { decimals: 1 });
		well.querySelector('.cmd-run').onclick = () => run(r);
		well.querySelector('.cmd-open').onclick = () => open(r);
		well.querySelector('.cmd-store').onclick = () => { beep('nav'); host().SteamClient?.URL?.ExecuteSteamURL?.(`steam://store/${r.appid}`); };
		well.classList.remove('flash');
		void well.offsetWidth;
		well.classList.add('flash');
	};

	/* ---------------------------------------------------------- events */

	scroll.addEventListener('scroll', () => paint(false), { passive: true });
	rows.addEventListener('click', e => {
		const row = e.target.closest('.lc-row');
		if (!row) return;
		// Full screen: click selects, double-click opens. Sidebar: click opens.
		const r = state.view[+row.dataset.i];
		if (state.mode === 'compact') { if (r.appid !== state.openApp) open(r); }
		else select(r);
	});
	rows.addEventListener('dblclick', e => {
		const row = e.target.closest('.lc-row');
		if (row) open(state.view[+row.dataset.i]);
	});
	rows.addEventListener('contextmenu', e => {
		const row = e.target.closest('.lc-row');
		const r = row && state.view[+row.dataset.i];
		if (r && gameMenu(r.appid, e, row)) select(r);
	});
	root.addEventListener('keydown', e => {
		if (e.target === search) { if (e.key === 'Escape') { search.value = ''; state.query = ''; apply(); } e.stopPropagation(); return; }
		if (e.target.closest?.('.lc-ops-slot-under-tabs, .lc-ops-pop')) return; // drawers handle their own keys
		const i = state.view.indexOf(state.selected);
		const move = { ArrowDown: 1, ArrowUp: -1, PageDown: 12, PageUp: -12 }[e.key];
		if (move) { e.preventDefault(); e.stopPropagation(); select(state.view[Math.max(0, Math.min(state.view.length - 1, i + move))], { reveal: true }); }
		else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); open(state.selected); }
	});
	tabs.addEventListener('click', e => {
		const b = e.target.closest('[data-tab]');
		if (!b || b.dataset.tab === state.tab) return;
		beep('nav'); state.tab = b.dataset.tab; scroll.scrollTop = 0; apply();
	});
	head.addEventListener('click', e => {
		const b = e.target.closest('[data-sort]');
		if (!b || e.defaultPrevented) return; // column tools cancel clicks that end a drag or resize
		beep('select');
		sortBy(b.dataset.sort);
	});
	search.addEventListener('input', () => { state.query = search.value; scroll.scrollTop = 0; apply(); });

	const coll = root.querySelector('.lc-ops-coll');
	coll.addEventListener('click', () => {
		if (!pop.hidden) { pop.hidden = true; return; }
		beep('nav');
		pop.innerHTML = collections().map(c => `<button data-coll="${esc(c.id)}" class="${c.id === state.coll ? 'on' : ''}">${esc(c.name)}<i>${c.apps().length}</i></button>`).join('');
		pop.hidden = false;
	});
	pop.addEventListener('click', e => {
		const b = e.target.closest('[data-coll]');
		if (!b) return;
		beep('select'); pop.hidden = true; state.coll = b.dataset.coll; scroll.scrollTop = 0; load(); apply();
	});

	new ResizeObserver(() => paint(true)).observe(scroll);

	// The card comes first (user, round 6): as wide as its art can be at this window
	// height, so the art is always as big as it can be, with no dead space beside it.
	// Columns keep their set widths and spare room stays as a gap between the register
	// and the card. When room runs out NAME gives way, down to its minimum, then the card
	// down to its floor (the readout scales to fit, css/ops.css), and then the register
	// scrolls sideways rather than the card leaving the window.
	let lastName = 0;
	const fit = () => {
		if (state.mode === 'compact') return;
		const cols = [...head.querySelectorAll('[data-col]')];
		const tracks = getComputedStyle(head).gridTemplateColumns.split(' ').map(parseFloat);
		const at = cols.findIndex(c => c.dataset.col === 'name');
		if (!cols.length || tracks.length !== cols.length || tracks.some(Number.isNaN)) return;
		// The height the portrait art would get: whatever the readout and commands leave.
		const frame = well.querySelector('.lc-well-frame'), artEl = well.querySelector('.lc-well-art');
		let artH = 0;
		if (frame && artEl && getComputedStyle(artEl).display !== 'none') {
			const fs = getComputedStyle(frame);
			artH = frame.clientHeight - parseFloat(fs.paddingTop) - parseFloat(fs.paddingBottom) - (frame.children.length - 1) * parseFloat(fs.rowGap || 0)
				- [...frame.children].reduce((sum, c) => (c === artEl ? sum : sum + c.offsetHeight), 0);
		}
		// Enough for the command labels, and roomier when short windows have dropped the art.
		const floor = artH > 0 ? 190 : 260;
		const portrait = Math.max(floor, artH > 0 ? 26 + 10 + (artH - 16) * 2 / 3 : 0); // 26 bracket, 10/16 art borders
		const body = $('.lc-ops-body');
		const room = body.clientWidth - parseFloat(getComputedStyle(body).columnGap);
		const fixed = tracks.reduce((sum, w, i) => (i === at ? sum : sum + w), 0)
			+ (cols.length - 1) * (parseFloat(getComputedStyle(head).columnGap) || 0)
			+ parseFloat(getComputedStyle($('.lc-reg')).paddingLeft) + scroll.offsetWidth - scroll.clientWidth + parseFloat(getComputedStyle(scroll).paddingRight);
		let name = 0;
		if (at >= 0) {
			const c = registry.columns.get('name');
			// --c-name-w is the width a NAME drag asks for (js/ops-columns.js).
			const want = parseFloat(root.style.getPropertyValue('--c-name-w')) || nameWidth(c);
			name = Math.round(Math.max(c.min || 160, Math.min(want, room - fixed - portrait)));
			// The readout's height follows the card's width and the art follows that, so let it settle.
			if (Math.abs(name - lastName) < 2) name = lastName;
			lastName = name;
			root.style.setProperty('--lc-name-w', `${name}px`);
		}
		const reg = Math.round(Math.min(fixed + name, room - floor));
		root.style.setProperty('--lc-reg-w', `${reg}px`);
		root.style.setProperty('--lc-card', `${Math.round(Math.min(portrait, room - reg))}px`);
	};
	// The row height follows the window's width (uiScale in data.js): re-lay the list when it changes.
	const rescale = () => {
		const h = `${state.view.length * rowHeight()}px`;
		if (spacer.style.height !== h) { spacer.style.height = h; paint(true); }
	};
	const fitter = new ResizeObserver(() => { fit(); rescale(); });
	fitter.observe(well);
	fitter.observe(root);

	// Back to the library home.
	root.querySelector('.lc-ops-back').addEventListener('click', () => {
		beep('nav');
		navigate('/library/home');
	});

	// Saved layout changes from other modules re-render in place.
	const offs = [
		prefs.on('cols', () => { renderHeader(); paint(true); }),
		prefs.on('colw', () => renderHeader()),
		prefs.on('tabs', () => { renderTabs(); apply(); }),
	];

	/* ------------------------------------------------------ public API */

	const sortBy = (id, dir) => {
		const col = registry.columns.get(id);
		if (!col) return;
		if (dir) state.dir = dir;
		else if (state.sort === id) state.dir *= -1;
		else state.dir = col.dir || -1;
		state.sort = id;
		prefs.set('sort', state.sort); prefs.set('dir', state.dir);
		apply();
	};

	const setFilter = (id, value) => {
		if (value == null) state.filters.delete(id); else state.filters.set(id, value);
		scroll.scrollTop = 0;
		apply();
	};

	const refresh = (quiet = false) => { load(); apply(quiet); };

	// Keep the register's selection on the game being viewed, so moving
	// between the operations screen and a game page never loses your place.
	const focusApp = appid => {
		const r = state.view.find(x => x.appid === appid);
		if (r) { state.selected = null; select(r, { reveal: true, sound: false }); }
		else paint(true);
	};

	const setMode = (mode, appid = 0) => {
		const changed = mode !== state.mode;
		if (changed) emit('modeWillChange', mode, appid); // the full-width register is still on screen
		state.mode = mode;
		root.classList.toggle('compact', mode === 'compact');
		state.openApp = mode === 'compact' ? appid : 0;
		if (changed) renderHeader();
		emit('modeChange', mode, appid);
	};

	renderHeader();
	renderTabs();

	const api = {
		fit,
		root, registry, prefs, on,
		get state() { return state; },
		refresh, apply, paint: () => paint(true), renderHeader, renderTabs,
		sortBy, setFilter, select, open, focusApp, setMode,
		stop() { clearInterval(statusTimer); for (const off of offs) off(); },
	};
	return api;
}

/* --------------------------------------------------------------- install */

let ops = null;

const routeKind = () => {
	const p = currentPath();
	if (p === '/library/home') return { kind: 'home', appid: 0 };
	const m = /^\/library\/app\/(\d+)/.exec(p);
	return m ? { kind: 'app', appid: Number(m[1]) } : { kind: 'other', appid: 0 };
};

export const opsMode = () => (getPref() ? 'shelves' : 'ops');

// OPS <-> SHELVES is the full <-> compact register switch; ops-motion.js plays
// it like opening a game (the new content pushes the register into the sidebar).
export function setOpsMode(mode) {
	setPref(mode === 'shelves');
	window[KEY]?.sync(true);
	window.__lcarsV2ShellV1?.sync?.();
}

export function installOps() {
	if (window[KEY]) return window[KEY];
	if (!registry.columns.size) registerBuiltins();
	let lastKey = '', lastApp = 0, settle = 0, reload = 0, away = false;
	const sync = force => {
		const route = routeKind();
		const host = document.querySelector(HOST);
		// One sidebar everywhere (user, 2026-10-30): outside the OPS home the
		// sidebar is Steam's own game list (its collections, filters, right-click
		// and drag), LCARS-styled, in both modes. The register stays mounted but
		// hidden there ('compact') so the motion hooks still see every move.
		const on = !!host && route.kind !== 'other';
		const mode = route.kind === 'home' && !getPref() ? 'full' : 'compact';
		const html = document.documentElement;
		const was = html.classList.contains('lc-ops-on');
		// Store or community: the library stays exactly as it was. It is on screen
		// under the web page while that loads and slides away, so switching OPS to
		// shelves here flashed a different library (user, round 6). Rows fan in again on return.
		if (!currentPath().startsWith('/library')) { away = true; clearTimeout(settle); return; }
		// Game-to-game navigation passes through a non-library route for ~40 ms;
		// only tear down once the route has stayed elsewhere, or the dock blinks.
		if (was && !on && route.kind === 'other' && !force) {
			clearTimeout(settle);
			settle = setTimeout(() => sync(true), 150);
			return;
		}
		clearTimeout(settle);
		if (on) {
			if (!ops) { ops = build(); window[KEY].api = ops; }
			const fresh = ops.root.parentElement !== host;
			if (fresh) host.insertBefore(ops.root, host.firstChild);
			const key = route.kind + route.appid + mode;
			if (fresh || force || key !== lastKey) {
				const wasFull = ops.state.mode === 'full';
				ops.setMode(mode, route.appid);
				// Steam's list was parked offscreen; it re-measures itself on resize.
				if (wasFull && mode !== 'full') requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
				// Only the full register shows records. The rows fan in when the register
				// is first mounted (again after leaving the library); otherwise they are
				// re-sorted quietly now and the data refreshed once the swipe has finished,
				// since re-reading every record blocks the UI thread mid-swipe.
				if (mode === 'full') {
					const focus = lastApp; // home keeps the game you came from
					clearTimeout(reload);
					if (fresh || away || !ops.state.all.length) ops.refresh();
					else {
						ops.apply(true);
						reload = setTimeout(() => { ops.refresh(true); if (focus) ops.focusApp(focus); }, 700);
					}
					if (focus) ops.focusApp(focus);
				}
				lastKey = key;
			}
			away = false;
		} else {
			lastKey = '';
		}
		if (route.appid) lastApp = route.appid;
		html.classList.toggle('lc-ops-on', on);
		html.classList.toggle('lc-ops-full', on && mode === 'full');
		html.classList.toggle('lc-ops-compact', on && mode === 'compact');
		// The parked game list re-measures itself on resize when it returns.
		if (was && !on) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
	};
	const observer = new MutationObserver(() => requestAnimationFrame(() => sync(false)));
	observer.observe(document.body, { childList: true, subtree: true });
	window[KEY] = { sync, api: null, stop() { observer.disconnect(); ops?.stop(); ops?.root.remove(); ops = null; delete window[KEY]; } };
	sync(true);
	return window[KEY];
}
