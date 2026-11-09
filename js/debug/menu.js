// LCARSv2 Debug menu (slice S18, re-ported round 7). A small LCARS bar like ATOMS'
// (theme toggle, annotator toggle, a menu button) and a note manager. Browser storage
// only: notes live in store.js.
// One bar per Steam window (the main window, settings, friends...): each opens its bar
// in a small always-on-top popup of its own (js/untether.js), so nothing, not even a web
// page, can cover it. Each window's switches live in localStorage under its own key
// (lcarsv2.debug.v1:<window name>). The main window also drives its web view (over
// Steam's parent/child message channel; the page's notes land in the main store) and its
// menus, which follow its switches and hand their picks to its note box.

import * as store from './store.js';
import { pinHover, unpinHover } from './hover-pin.js';
import { HOST_ID, attachLayer, detachLayer, installPicker, resolveRecord, stopPicker } from './picker.js';
import { mouseAt, moveSelf, untether, windowRect } from '../untether.js';

const API_KEY = '__lcarsV2DebugMenuV1';
const PICKER_KEY = '__lcarsV2DebugPickerV1';
const PILLS_KEY = '__lcarsV2DebugPills'; // the open pill windows by owner, on the SharedJSContext
const STATE_KEY = 'lcarsv2.debug.v1';
const MAIN_NAME = 'SP Desktop_uid0';
const CHANNEL = 'lcarsv2.annotator';
const WEB_MSG = 'lcars-debug'; // main window <-> its web view
const F_POPUP_MENU = 1 << 16;
const PILL_RE = /^lc_annotator_/;
const THEME_PATH = '/themes/LCARSv2/';
const NOTE_MAX = 800;
const HIT_MS = 1400;
const STATUS_MS = 5000;
const POLL_MS = 400; // the pill follows the main window: moved, minimised, closed

const CLICK_SLOP = 4; // px a handle press may travel and still count as a click

const MARKUP = `
	<section class="dbg-menu" aria-label="LCARS debug menu">
		<div class="dbg-menu-more" data-part="more" role="menu" hidden>
			<button type="button" class="dbg-btn" data-act="notes" aria-expanded="false">NOTES (0)</button>
			<button type="button" class="dbg-btn" data-act="export-toon">EXPORT TOON</button>
			<button type="button" class="dbg-btn" data-act="import-open">IMPORT</button>
			<button type="button" class="dbg-btn" data-act="jingles" aria-haspopup="menu" aria-expanded="false">JINGLES</button>
			<div class="dbg-menu-box" data-part="jingles" hidden></div>
			<div class="dbg-menu-box" data-part="export" hidden>
				<textarea class="dbg-menu-text" readonly spellcheck="false" aria-label="Exported notes"></textarea>
				<div class="dbg-row-actions"><button type="button" class="dbg-btn" data-act="export-close">CLOSE</button></div>
			</div>
			<div class="dbg-menu-box" data-part="import" hidden>
				<textarea class="dbg-menu-text" spellcheck="false" aria-label="Paste TOON or JSON notes" placeholder="Paste TOON or JSON"></textarea>
				<div class="dbg-row-actions">
					<button type="button" class="dbg-btn dbg-primary" data-act="import-apply">APPLY</button>
					<button type="button" class="dbg-btn" data-act="import-close">CLOSE</button>
				</div>
			</div>
			<div class="dbg-menu-usage" data-part="usage"></div>
		</div>
		<div class="dbg-menu-status" data-part="status" role="status"></div>
		<div class="dbg-menu-bar">
			<span class="dbg-menu-grip" role="button" tabindex="0" aria-expanded="false" aria-label="LCARS debug menu" title="Click to open or close, drag to move"></span>
			<button type="button" class="dbg-btn" data-act="lcars" aria-pressed="true">LCARS ON</button>
			<button type="button" class="dbg-btn" data-act="annotator" aria-pressed="false" title="Alt-click an element to note it, Alt-click again to remove. Hold Alt to keep hover styles. A Control tap hides the hover box.">ANNOTATOR OFF</button>
			<button type="button" class="dbg-btn dbg-menu-toggle" data-act="more" aria-haspopup="menu" aria-expanded="false" aria-label="Annotation options">☰</button>
		</div>
	</section>
	<section class="dbg-notes" data-part="notes" aria-label="Notes" hidden>
		<header class="dbg-notes-head">
			<span class="dbg-notes-title">Notes</span>
			<span class="dbg-notes-origin"></span>
			<span class="dbg-notes-count" data-part="count"></span>
			<button type="button" class="dbg-btn" data-act="filter" aria-pressed="true">THIS PAGE</button>
			<button type="button" class="dbg-btn" data-act="notes-close">CLOSE</button>
		</header>
		<div class="dbg-notes-error" data-part="notes-error" role="alert"></div>
		<ol class="dbg-notes-list" data-part="list"></ol>
	</section>`;

let state = null; // the bar, in the pill window
// Whose switches this realm reads: its own window's; menus and web views the main window's;
// a pill its owner's.
let stateKey = `${STATE_KEY}:${MAIN_NAME}`;
const sheets = new WeakMap(); // each theme stylesheet's own disabled state, to restore
let sheetsAreOff = false;
const notes = store;

const $ = (selector) => state?.root.querySelector(selector) ?? null;
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
const pad = (value, size = 2) => String(value).padStart(size, '0');
// The pill's page is whatever the main window shows (store.pageKey follows its web view).
const main = () => window.__lcOwner || null;
const pageKey = () => {
	try {
		return main()?.pageKey() ?? store.pageKey();
	} catch (_) {
		return '';
	}
};
const onThisPage = (rec) => rec.route === pageKey();
const recordById = (id) => notes.list().find((rec) => rec.id === id) || null;
const stamp = (ts) => {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Storage can be blocked; the menu still works for this document without it.
function readState() {
	try {
		const data = JSON.parse(localStorage.getItem(stateKey) || '{}');
		return data && typeof data === 'object' ? data : {};
	} catch (_) {
		return {};
	}
}

function writeState(patch) {
	try {
		localStorage.setItem(stateKey, JSON.stringify({ ...readState(), ...patch }));
	} catch (_) {
		// Blocked storage: the switches and position just won't survive a reload.
	}
}

const switches = () => {
	const saved = readState();
	return { annotator: saved.annotator === true, themeOff: saved.themeOff === true };
};

function later(fn, ms) {
	const id = setTimeout(() => {
		state?.timers.delete(id);
		fn();
	}, ms);
	state?.timers.add(id);
}

function setStatus(text, isError = false) {
	const status = $('[data-part=status]');
	if (!status) return;
	status.textContent = text;
	status.classList.toggle('is-error', isError);
	// Errors stay until replaced; the rest clear, so the bar stays small.
	if (text && !isError) later(() => {
		if (status.textContent === text) status.textContent = '';
	}, STATUS_MS);
}

function setNotesError(text) {
	const error = $('[data-part=notes-error]');
	if (error) error.textContent = text;
}

function showBox(part, show) {
	const box = $(`[data-part=${part}]`);
	if (!box) return;
	box.hidden = !show;
	if (show && part === 'import') box.querySelector('textarea').focus();
}

// Only this document's theme stylesheets, matched by the theme path (not ATOMS).
function themeLinks() {
	return Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))
		.filter((link) => String(link.href || link.getAttribute('href') || '').includes(THEME_PATH));
}

// Keeps each sheet's own disabled state: a theme setting may have it off.
function setSheetsOff(off) {
	sheetsAreOff = off;
	for (const link of themeLinks()) {
		if (off) {
			if (!sheets.has(link)) sheets.set(link, link.disabled);
			link.disabled = true;
		} else if (sheets.has(link)) {
			link.disabled = sheets.get(link);
			sheets.delete(link);
		}
	}
}

// Sheets the page adds later stay off while the theme is off.
function watchSheets() {
	const watch = new MutationObserver(() => {
		if (sheetsAreOff) setSheetsOff(true);
	});
	watch.observe(document.head, { childList: true });
	return watch;
}

// Keyboard focus goes back to Steam after a bar click, so Alt reaches the page again.
function giveFocusBack() {
	try {
		main()?.focus();
	} catch (_) {
		// The main window is gone; the pill closes on its next poll.
	}
}

function setThemeOff(off) {
	writeState({ themeOff: off });
	setStatus(off ? 'LCARS styles off.' : '');
	refresh();
}

const annotatorOn = () => Boolean(window[PICKER_KEY]);

function setAnnotator(on) {
	writeState({ annotator: on });
	setStatus(on ? 'Alt-click to note an element, again to remove. Hold Alt to keep hover styles.' : '');
	refresh();
}

function setMoreOpen(open) {
	if (!state) return;
	$('[data-part=more]').hidden = !open;
	$('[data-act=more]').setAttribute('aria-expanded', String(open));
	if (!open) {
		showBox('export', false);
		showBox('import', false);
		setJinglesOpen(false);
	}
}

// Whatever jingles/local/index.json lists when the menu opens, so files can come and go.
async function setJinglesOpen(open) {
	const box = $('[data-part=jingles]');
	const button = $('[data-act=jingles]');
	box.hidden = !open;
	button.setAttribute('aria-expanded', String(open));
	if (!open) return;
	// A flyout beside the menu, on whichever side has room.
	box.style.top = `${button.offsetTop}px`;
	box.classList.toggle('is-right', box.parentElement.getBoundingClientRect().left < box.offsetWidth + 6);
	const { list } = await import('../jingles.js');
	const entries = await list();
	if (!state) return;
	state.jingles = entries;
	box.replaceChildren(...(entries.length ? entries.map((entry, i) => {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'dbg-btn';
		item.dataset.act = 'jingle';
		item.dataset.index = i;
		item.textContent = entry.title || entry.id;
		return item;
	}) : [Object.assign(document.createElement('span'), { textContent: 'No jingles' })]));
}

async function playJingle(index) {
	try {
		const { play } = await import('../jingles.js');
		if (!await play(state.jingles[index])) setStatus('Audio is blocked', true);
	} catch (err) {
		setStatus(err.message, true);
	}
}

function syncFilter() {
	const filter = $('[data-act=filter]');
	if (!filter) return;
	filter.textContent = state.ui.onlyPage ? 'THIS PAGE' : 'ALL PAGES';
	filter.setAttribute('aria-pressed', String(state.ui.onlyPage));
}

function setNotesOpen(open) {
	if (!state) return;
	state.ui.open = open;
	state.notes.hidden = !open;
	$('[data-act=notes]').setAttribute('aria-expanded', String(open));
	if (open) {
		syncFilter();
		refresh();
	}
}

function rowHtml(rec, number) {
	const { ui } = state;
	const done = rec.status === 'done';
	const onPage = onThisPage(rec) && rec.route.startsWith('/'); // a web view's elements aren't in the main document
	let body = `<div class="dbg-row-text">${rec.note ? esc(rec.note) : '<span class="dbg-row-dim">No note text</span>'}</div>`;
	if (ui.edit && ui.edit.id === rec.id) {
		body = `<div class="dbg-row-edit">
			<input class="dbg-note-input" type="text" maxlength="${NOTE_MAX}" aria-label="Note text" value="${esc(ui.edit.value)}">
			<div class="dbg-row-actions">
				<button type="button" class="dbg-btn dbg-primary" data-act="save-edit">SAVE</button>
				<button type="button" class="dbg-btn" data-act="cancel-edit">CANCEL</button>
			</div>
		</div>`;
	}
	const actions = ui.confirm === rec.id
		? `<div class="dbg-row-actions">
			<span class="dbg-row-ask">Delete this note?</span>
			<button type="button" class="dbg-btn dbg-danger" data-act="delete-yes">DELETE</button>
			<button type="button" class="dbg-btn" data-act="delete-no">KEEP</button>
		</div>`
		: `<div class="dbg-row-actions">
			<button type="button" class="dbg-btn" data-act="jump"${onPage ? '' : ' disabled title="Open this page to jump to the note"'}>JUMP</button>
			<button type="button" class="dbg-btn" data-act="edit">EDIT</button>
			<button type="button" class="dbg-btn" data-act="status">${done ? 'REOPEN' : 'DONE'}</button>
			<button type="button" class="dbg-btn" data-act="delete">DELETE</button>
		</div>`;
	return `<li class="dbg-note-row${done ? ' is-done' : ''}" data-id="${esc(rec.id)}">
		<div class="dbg-row-top">
			<span class="dbg-row-num">${pad(number, 3)}</span>
			<span class="dbg-row-status">${done ? 'DONE' : 'OPEN'}</span>
			<span class="dbg-row-route">${esc(rec.route)}</span>
			<span class="dbg-row-time">${stamp(rec.ts)}</span>
		</div>
		${body}
		<div class="dbg-row-sel">${esc(rec.selector)}</div>
		${actions}
	</li>`;
}

function renderList() {
	const { ui } = state;
	const list = $('[data-part=list]');
	const all = notes.list();
	// Keep text typed into an open edit box when the list re-renders.
	const liveInput = list.querySelector('.dbg-row-edit input');
	if (ui.edit && liveInput) ui.edit.value = liveInput.value;
	if (ui.edit && !all.some((rec) => rec.id === ui.edit.id)) ui.edit = null;
	if (ui.confirm && !all.some((rec) => rec.id === ui.confirm)) ui.confirm = null;
	const numbers = new Map(all.map((rec, index) => [rec.id, index + 1]));
	const rows = all.filter((rec) => !ui.onlyPage || onThisPage(rec)).reverse();
	list.innerHTML = rows.length
		? rows.map((rec) => rowHtml(rec, numbers.get(rec.id))).join('')
		: `<li class="dbg-notes-empty">${ui.onlyPage
			? 'No notes on this page. Turn on ANNOTATOR and Alt-click an element.'
			: 'No notes saved yet.'}</li>`;
	$('[data-part=count]').textContent = `${rows.length} shown of ${all.length}`;
	if (ui.focusEdit) {
		ui.focusEdit = false;
		list.querySelector('.dbg-row-edit input')?.focus();
	}
}

function refresh() {
	if (!state) return;
	const usage = notes.usage();
	const { annotator: on, themeOff } = switches();
	const lcars = $('[data-act=lcars]');
	lcars.textContent = themeOff ? 'LCARS OFF' : 'LCARS ON';
	lcars.setAttribute('aria-pressed', String(!themeOff));
	const annotator = $('[data-act=annotator]');
	annotator.textContent = on ? 'ANNOTATOR ON' : 'ANNOTATOR OFF';
	annotator.setAttribute('aria-pressed', String(on));
	$('[data-act=notes]').textContent = `NOTES (${usage.count})`;
	const meter = $('[data-part=usage]');
	meter.textContent = usage.error
		|| `${usage.count} of ${usage.max} notes · ${Math.ceil(usage.bytes / 1024)} of ${usage.maxBytes / 1024} KB`;
	meter.classList.toggle('is-error', Boolean(usage.error));
	if (state.ui.open) {
		setNotesError(usage.error || '');
		renderList();
	}
}

// Runs in the main window, for the pill's JUMP: the element is here, not in the pill.
function jumpHere(rec) {
	const el = resolveRecord(rec);
	if (!el) return 'No single element matches this note on this page. The page may have changed.';
	el.scrollIntoView({ block: 'center', inline: 'center' });
	const rect = el.getBoundingClientRect();
	if (!rect.width || !rect.height) return '';
	const layer = attachLayer('flash');
	const box = document.createElement('div');
	box.className = 'dbg-flash';
	Object.assign(box.style, {
		left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
	});
	layer.append(box);
	setTimeout(() => {
		box.remove();
		if (!layer.children.length) detachLayer(layer);
	}, HIT_MS);
	return '';
}

function jumpTo(rec) {
	if (!onThisPage(rec)) {
		setNotesError(`That note is on ${rec.route}. Open that page to jump to it.`);
		return;
	}
	let error = 'The main window is not answering.';
	try {
		error = main()?.jump(rec) ?? error;
	} catch (_) {
		// Keeps the message above.
	}
	setNotesError(error);
}

function mutate(action) {
	try {
		action();
		setNotesError('');
	} catch (err) {
		setNotesError(err.message);
	}
	renderList();
}

function withRecord(id, fn) {
	const rec = recordById(id);
	if (!rec) {
		setNotesError('That note no longer exists.');
		renderList();
		return;
	}
	fn(rec);
}

function saveEdit(row) {
	const input = row?.querySelector('input');
	if (!input) return;
	const note = input.value.trim().slice(0, NOTE_MAX);
	mutate(() => {
		notes.update(row.dataset.id, { note });
		state.ui.edit = null;
	});
}

async function exportNotes() {
	try {
		const text = notes.exportTOON();
		if (!text) {
			setStatus('No open notes to export.');
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			if (!state) return;
			showBox('export', false);
			setStatus('Copied open notes as TOON to the clipboard.');
		} catch (_) {
			if (!state) return;
			const box = $('[data-part=export] textarea');
			box.value = text;
			showBox('export', true);
			box.select();
			setStatus('Clipboard refused. Copy the TOON text below.', true);
		}
	} catch (err) {
		setStatus(err.message, true);
	}
}

function applyImport() {
	const box = $('[data-part=import] textarea');
	try {
		const count = notes.import(box.value);
		box.value = '';
		showBox('import', false);
		setStatus(`Imported ${count} notes.`);
	} catch (err) {
		setStatus(err.message, true);
	}
	refresh();
}

// The pill window is anchored by its bottom-left corner on screen: the bar grows to the
// right when it opens and the menu and notes grow upwards, and the handle stays put.
function moveWindow() {
	moveSelf(state.pos.left, state.pos.bottom - state.size.height);
}

// The window is exactly as big as what is showing.
function fitWindow() {
	if (!state) return;
	const rects = [...state.layer.querySelectorAll('.dbg-menu, .dbg-notes, .dbg-menu-box')]
		.map((el) => el.getBoundingClientRect())
		.filter((rect) => rect.width && rect.height);
	if (!rects.length) return;
	const width = Math.ceil(Math.max(...rects.map((rect) => rect.right)));
	const height = Math.ceil(innerHeight - Math.min(...rects.map((rect) => rect.top)));
	if (width === state.size.width && height === state.size.height) return;
	state.size = { width, height };
	window.SteamClient.Window.ResizeTo(width, height, true);
	moveWindow();
}

function scheduleFit() {
	if (!state || state.fitQueued) return;
	state.fitQueued = true;
	// Not requestAnimationFrame: Steam reports this popup as hidden, so frames never come.
	setTimeout(() => {
		if (!state) return;
		state.fitQueued = false;
		fitWindow();
	});
}

const savePos = () => writeState({ pillPos: state.pos });

function onPanelClick(event) {
	const target = event.target.closest?.('[data-act]');
	const act = target?.dataset.act;
	switch (act) {
		case 'lcars': setThemeOff(!switches().themeOff); giveFocusBack(); break;
		case 'annotator': setAnnotator(!switches().annotator); giveFocusBack(); break;
		case 'more': setMoreOpen($('[data-part=more]').hidden); break;
		case 'notes': setNotesOpen(!state.ui.open); break;
		case 'export-toon': exportNotes(); break;
		case 'export-close': showBox('export', false); break;
		case 'import-open': showBox('import', true); break;
		case 'import-close': showBox('import', false); break;
		case 'import-apply': applyImport(); break;
		case 'jingles': setJinglesOpen($('[data-part=jingles]').hidden); break;
		case 'jingle': playJingle(Number(target.dataset.index)); break;
		default: break;
	}
}

function onNotesClick(event) {
	const act = event.target.closest?.('[data-act]')?.dataset.act;
	const row = event.target.closest?.('.dbg-note-row');
	const id = row?.dataset.id;
	const { ui } = state;
	switch (act) {
		case 'notes-close': setNotesOpen(false); break;
		case 'filter':
			ui.onlyPage = !ui.onlyPage;
			syncFilter();
			renderList();
			break;
		case 'jump': withRecord(id, jumpTo); renderList(); break;
		case 'edit':
			withRecord(id, (rec) => {
				ui.edit = { id, value: rec.note };
				ui.confirm = null;
				ui.focusEdit = true;
				renderList();
			});
			break;
		case 'save-edit': saveEdit(row); break;
		case 'cancel-edit': ui.edit = null; renderList(); break;
		case 'status':
			withRecord(id, (rec) => mutate(() => notes.update(id, { status: rec.status === 'done' ? 'open' : 'done' })));
			break;
		case 'delete': ui.confirm = id; ui.edit = null; renderList(); break;
		case 'delete-no': ui.confirm = null; renderList(); break;
		case 'delete-yes':
			mutate(() => notes.remove(id));
			ui.confirm = null;
			renderList();
			break;
		default: break;
	}
}

// Keys typed in a note box stop here.
function onNotesKey(event) {
	event.stopPropagation();
	const row = event.target.closest?.('.dbg-note-row');
	if (!row || !event.target.matches?.('.dbg-row-edit input')) return;
	if (event.key === 'Enter') {
		event.preventDefault();
		saveEdit(row);
	} else if (event.key === 'Escape') {
		event.preventDefault();
		state.ui.edit = null;
		renderList();
	}
}

function wire() {
	const { root } = state;
	const panel = root.querySelector('.dbg-menu');
	const grip = root.querySelector('.dbg-menu-grip');
	const notesPanel = root.querySelector('[data-part=notes]');
	state.panel = panel;
	state.notes = notesPanel;
	panel.classList.add('is-collapsed'); // opens collapsed
	panel.addEventListener('click', onPanelClick);
	notesPanel.addEventListener('click', onNotesClick);
	notesPanel.addEventListener('keydown', onNotesKey);

	// Dragging the handle moves the whole window. Pointer screenX is wrong in here, and
	// clientX moves with the window, so the drag follows Steam's own pointer position.
	let drag = null;
	grip.addEventListener('pointerdown', async (event) => {
		if (event.button !== 0) return;
		grip.setPointerCapture(event.pointerId);
		event.preventDefault();
		const at = { left: state.pos.left, bottom: state.pos.bottom };
		drag = { from: null, at, moved: false, busy: true, x: event.clientX, y: event.clientY };
		const from = await mouseAt();
		if (drag?.at === at) {
			drag.from = from;
			drag.busy = false;
		}
	});
	grip.addEventListener('pointermove', async (event) => {
		if (!drag) return;
		drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > CLICK_SLOP;
		if (!drag.moved || drag.busy || !drag.from) return;
		const current = drag;
		current.busy = true; // one position query at a time
		const to = await mouseAt();
		current.busy = false;
		if (drag !== current || !to) return;
		state.pos = { left: current.at.left + to.x - current.from.x, bottom: current.at.bottom + to.y - current.from.y };
		moveWindow();
	});
	const toggle = () => {
		const collapsed = !panel.classList.contains('is-collapsed');
		if (collapsed) setMoreOpen(false);
		panel.classList.toggle('is-collapsed', collapsed);
		grip.setAttribute('aria-expanded', String(!collapsed));
	};
	const endDrag = (event) => {
		if (!drag) return;
		const { moved } = drag;
		drag = null;
		if (moved) savePos();
		else if (event.type === 'pointerup') {
			toggle();
			giveFocusBack();
		}
	};
	grip.addEventListener('pointerup', endDrag);
	grip.addEventListener('pointercancel', endDrag);
	grip.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		toggle();
	});

	// The menu closes on a click elsewhere, Escape, or when focus goes back to Steam.
	state.onOutside = (event) => {
		if (!event.composedPath().includes(panel)) setMoreOpen(false);
	};
	state.onEscape = (event) => {
		if (event.key === 'Escape' && !$('[data-part=more]').hidden) {
			event.stopPropagation();
			setMoreOpen(false);
		}
	};
	state.onBlur = () => setMoreOpen(false);
	state.onStorage = (event) => {
		if (event.key === stateKey || event.key === null) refresh();
	};
	window.addEventListener('pointerdown', state.onOutside, true);
	window.addEventListener('keydown', state.onEscape, true);
	window.addEventListener('blur', state.onBlur);
	window.addEventListener('storage', state.onStorage);

	state.fitWatch = new ResizeObserver(scheduleFit);
	for (const el of root.querySelectorAll('.dbg-menu, .dbg-notes, .dbg-menu-box')) state.fitWatch.observe(el);
	state.shapeWatch = new MutationObserver(scheduleFit);
	state.shapeWatch.observe(state.layer, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
}

// The pill is untethered: it stays wherever it is put, even outside its window. It only
// hides while its window is minimised, and closes with it.
async function followOwner() {
	if (!state || state.polling) return;
	state.polling = true;
	let rect = null;
	try {
		rect = await main()?.rect();
	} catch (_) {
		rect = null;
	}
	if (!state) return;
	state.polling = false;
	if (!rect) {
		window.close();
		return;
	}
	const last = state.ownerRect;
	state.ownerRect = rect;
	if (rect.hidden !== Boolean(last?.hidden)) {
		if (rect.hidden) window.SteamClient.Window.HideWindow();
		else window.SteamClient.Window.ShowWindow();
	}
}

const isMainWindow = () => window.name === 'SP Desktop_uid0';

// Menus, toasts and the like: no room for a note box, and no window of their own to speak of.
const isMenuWindow = () => document.documentElement.classList.contains('MillenniumWindow_ContextMenu')
	|| /(?:Menu|Supernav)$|^Sign in/.test(document.title)
	|| /^(?:contextmenu|MainMenu|QuickAccess|notificationtoasts|tooltip|desktopoverlay)/i.test(window.name)
	|| Boolean(Number(/createflags=(\d+)/.exec(location.href)?.[1]) & F_POPUP_MENU);

// Every other Steam window follows the switches. Menus hand a pick to the main window's
// note box (a menu is too small, and closes when focus moves); the rest note in place.
function installFollower(relayPicks) {
	const channel = relayPicks ? new BroadcastChannel(CHANNEL) : null;
	const apply = () => {
		const { annotator, themeOff } = switches();
		if (themeOff !== sheetsAreOff) setSheetsOff(themeOff);
		if (annotator === annotatorOn()) return;
		if (annotator) installPicker(channel ? { relay: (rec) => channel.postMessage(rec) } : {});
		else stopPicker();
	};
	const onStorage = (event) => {
		if (event.key === stateKey || event.key === null) apply();
	};
	const sheetWatch = watchSheets();
	window.addEventListener('storage', onStorage);
	apply();
	const stopFollower = () => {
		window.removeEventListener('storage', onStorage);
		sheetWatch.disconnect();
		channel?.close();
		stopPicker();
		setSheetsOff(false);
		if (window[API_KEY]?.stop === stopFollower) delete window[API_KEY];
	};
	window[API_KEY] = { stop: stopFollower };
	return window[API_KEY];
}

// Main window side of the web view link: answers the page and keeps it told the
// switches. Steam creates the view after the window, so this keeps looking for it.
function linkWebView() {
	let browser = null;
	const send = () => {
		if (!browser) return;
		const { annotator, themeOff } = switches();
		try {
			browser.PostMessage(WEB_MSG, JSON.stringify({
				annotator,
				themeOff,
				notes: store.list().filter((rec) => !rec.route.startsWith('/')),
			}));
		} catch (_) {
			// No page in the view right now; it says hello when one loads.
		}
	};
	const onMessage = (name, args) => {
		if (name !== WEB_MSG) return;
		try {
			const message = JSON.parse(args);
			if (message.op === 'hello') send();
			else if (message.op === 'add') store.add(message.rec);
			else if (message.op === 'remove') store.remove(message.id);
			else if (message.op === 'import') store.import(message.text);
			else if (message.op === 'update') store.update(message.id, message.patch);
			else if (message.op === 'pin') { if (message.on) pinHover(message.token, message.url); else unpinHover(message.token); } // Alt held in the page
		} catch (err) {
			console.error('[lcars debug] web view message', err);
		}
	};
	const find = () => {
		let current = null;
		try {
			current = (window.opener || window).MainWindowBrowserManager?.m_browser || null;
		} catch (_) {
			return;
		}
		if (current === browser || !current?.on) return;
		browser?.off('message', onMessage);
		browser = current;
		browser.on('message', onMessage);
		send();
	};
	// Key focus often stays in this window while the pointer is over the page, and then
	// the page sees no Alt at all (clicks arrive without altKey): pass the key on.
	const sendAlt = (alt) => {
		try {
			browser?.PostMessage(WEB_MSG, JSON.stringify({ alt }));
		} catch (_) {
			// No page in the view right now.
		}
	};
	const onAltKey = (event) => {
		if (event.key === 'Alt' && !event.repeat && switches().annotator) sendAlt(event.type === 'keydown');
	};
	const onWindowBlur = () => sendAlt(false);
	window.addEventListener('keydown', onAltKey, true);
	window.addEventListener('keyup', onAltKey, true);
	window.addEventListener('blur', onWindowBlur);
	const timer = setInterval(find, 1000);
	find();
	const unlisten = store.onChange(send);
	return {
		send,
		stop() {
			clearInterval(timer);
			unlisten();
			window.removeEventListener('keydown', onAltKey, true);
			window.removeEventListener('keyup', onAltKey, true);
			window.removeEventListener('blur', onWindowBlur);
			browser?.off('message', onMessage);
		},
	};
}

// A web page inside the main window. It has no bar (the pill is above it): it runs the
// picker on the main window's notes and switches, sent over Steam's message channel.
function installWebView() {
	const view = window.SteamClient.BrowserView;
	const post = (message) => view.PostMessageToParent(WEB_MSG, JSON.stringify(message));
	const listeners = new Set();
	let records = [];
	const remote = {
		pageKey: store.pageKey,
		list: () => records,
		add: (rec) => {
			post({ op: 'add', rec });
			return rec;
		},
		update: (id, patch) => post({ op: 'update', id, patch }),
		remove: (id) => post({ op: 'remove', id }),
		import: (text) => post({ op: 'import', text }),
		usage: () => ({ count: records.length, max: store.MAX_RECORDS, bytes: JSON.stringify(records).length, maxBytes: store.MAX_BYTES, error: null }),
		onChange: (fn) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
	};
	let linked = false;
	// The page has no DevTools bridge: the main window pins its hover (js/debug/hover-pin.js).
	const pin = (on, token) => {
		post({ op: 'pin', on, token, url: location.href });
		return new Promise((done) => setTimeout(done, 150));
	};
	// The hook has one slot and the last caller wins, and Steam's store code registers
	// after this runs: keep the slot here and pass everything else on to its callbacks.
	const nativeRegister = view.RegisterForMessageFromParent;
	const others = new Set();
	view.RegisterForMessageFromParent = (fn) => {
		others.add(fn);
		return { unregister: () => others.delete(fn) };
	};
	const registration = nativeRegister.call(view, (name, args) => {
		if (name !== WEB_MSG) {
			for (const fn of others) fn(name, args);
			return;
		}
		if (!linked) {
			linked = true;
			// Notes this origin kept from before there was one store move across, once.
			const local = store.list();
			if (local.length) {
				post({ op: 'import', text: JSON.stringify({ records: local }) });
				store.clear();
			}
		}
		const message = JSON.parse(args);
		if ('alt' in message) {
			window[PICKER_KEY]?.hold?.(message.alt);
			return;
		}
		records = message.notes || [];
		for (const fn of listeners) fn(records);
		if (message.themeOff !== sheetsAreOff) setSheetsOff(message.themeOff);
		if (message.annotator && !annotatorOn()) installPicker({ notes: remote, pin });
		else if (!message.annotator) stopPicker();
	});
	post({ op: 'hello' });
	const stopView = () => {
		registration?.unregister?.();
		view.RegisterForMessageFromParent = nativeRegister;
		for (const fn of others) nativeRegister.call(view, fn);
		stopPicker();
		setSheetsOff(false);
		if (window[API_KEY]?.stop === stopView) delete window[API_KEY];
	};
	window[API_KEY] = { stop: stopView };
	return window[API_KEY];
}

export function install() {
	window[API_KEY]?.stop();
	if (window.self !== window.top || document.title === 'SharedJSContext' || PILL_RE.test(window.name)) return { stop() {} };
	if (isMenuWindow()) return installFollower(true);
	if (location.protocol.startsWith('http') && location.host !== 'steamloopback.host' && window.SteamClient?.BrowserView) return installWebView();
	return installOwner();
}

// Where the pill opens: wherever it was left, else the window's bottom-left corner.
// screenX can read 0 here, so the window's real rect comes from Steam.
// shortcut: no check that the saved spot is still on a monitor; if one goes away, the pill
// can open off-screen (clear pillPos in lcarsv2.debug.v1:<window name> to reset it).
async function pillStart(rect) {
	const saved = readState().pillPos || {};
	return {
		left: Number.isFinite(saved.left) ? saved.left : rect.x + 24,
		bottom: Number.isFinite(saved.bottom) ? saved.bottom : rect.y + rect.height - 24,
	};
}

// A real window: it owns a pill, runs its own picker from its own switches, and the main
// window also drives its web view and menus.
function installOwner() {
	stateKey = `${STATE_KEY}:${window.name}`;
	const isMain = isMainWindow();
	// Turning the debug menu on means you want to annotate: every window starts with it on.
	writeState({ annotator: true, themeOff: false });
	const webView = isMain ? linkWebView() : null;
	// Picks from menu windows open the note box here.
	const channel = isMain ? new BroadcastChannel(CHANNEL) : null;
	if (channel) channel.onmessage = (event) => window[PICKER_KEY]?.openRecord?.(event.data);
	const apply = () => {
		const { annotator, themeOff } = switches();
		if (themeOff !== sheetsAreOff) setSheetsOff(themeOff);
		if (annotator && !annotatorOn()) installPicker({});
		else if (!annotator) stopPicker();
		webView?.send();
	};
	const onStorage = (event) => {
		if (event.key === stateKey || event.key === null) apply();
	};
	const sheetWatch = watchSheets();
	window.addEventListener('storage', onStorage);
	apply();
	const hand = {
		key: stateKey,
		pageKey: () => store.pageKey(),
		jump: (rec) => jumpHere(rec),
		rect: async () => ({ ...(await windowRect()), hidden: document.hidden }),
		focus: () => window.SteamClient?.Window?.SetKeyFocus?.(true),
	};
	const shared = window.opener || window;
	const pills = (shared[PILLS_KEY] ||= {});
	let pill = null;
	let stopped = false;
	(async () => {
		try {
			pills[window.name]?.close();
		} catch (_) {
			// Already closed.
		}
		const rect = await windowRect();
		const pos = await pillStart(rect);
		if (stopped) return;
		pill = untether({
			name: `lc_annotator_${window.name.replace(/\W/g, '_')}`,
			title: 'LCARS annotator',
			rect: { width: 44, height: 44, left: pos.left, top: pos.bottom - 44 },
			module: import.meta.url,
			entry: 'installPill',
			hand: { ...hand, start: () => pos },
		});
		if (pill) pills[window.name] = pill;
	})().catch((err) => console.error('[lcars debug] pill', err));
	const stopOwner = () => {
		stopped = true;
		window.removeEventListener('storage', onStorage);
		window.removeEventListener('pagehide', stopOwner);
		sheetWatch.disconnect();
		webView?.stop();
		channel?.close();
		stopPicker();
		setSheetsOff(false);
		try {
			pill?.close();
		} catch (_) {
			// Already closed.
		}
		if (pills[window.name] === pill) delete pills[window.name];
		if (window[API_KEY]?.stop === stopOwner) delete window[API_KEY];
	};
	window.addEventListener('pagehide', stopOwner);
	window[API_KEY] = { stop: stopOwner };
	return window[API_KEY];
}

// Runs inside the pill window (untether loads this module there).
export function installPill() {
	if (!PILL_RE.test(window.name) || state) return;
	let start = null;
	try {
		stateKey = main().key;
		start = main().start();
	} catch (_) {
		start = null;
	}
	if (!start) {
		window.close();
		return;
	}
	const layer = attachLayer('menu');
	const root = layer.getRootNode();
	root.host.classList.add('is-pill');
	layer.innerHTML = MARKUP;
	state = {
		layer,
		root,
		panel: null,
		notes: null,
		pos: start,
		size: { width: 0, height: 0 },
		fitQueued: false,
		polling: false,
		ownerRect: null,
		ui: { onlyPage: true, open: false, edit: null, confirm: null, focusEdit: false },
		jingles: [],
		timers: new Set(),
		unsubscribe: null,
		onOutside: null,
		onEscape: null,
		onBlur: null,
		onStorage: null,
		fitWatch: null,
		shapeWatch: null,
		poll: 0,
	};
	$('.dbg-notes-origin').textContent = 'all of Steam';
	wire();
	syncFilter();
	state.unsubscribe = notes.onChange(refresh);
	refresh();
	// Sized and shown once the shadow stylesheet has loaded, so it never flashes unstyled.
	const show = () => {
		if (!state) return;
		fitWindow();
		window.SteamClient.Window.ShowWindow();
		state.poll = setInterval(followOwner, POLL_MS);
	};
	const link = root.querySelector('link');
	if (link?.sheet) show();
	else link?.addEventListener('load', show, { once: true });
	window[API_KEY] = { stop: stopBar };
}

export function stop() {
	window[API_KEY]?.stop();
}

function stopBar() {
	if (!state) return;
	const s = state;
	state = null;
	s.unsubscribe?.();
	s.fitWatch?.disconnect();
	s.shapeWatch?.disconnect();
	clearInterval(s.poll);
	for (const id of s.timers) clearTimeout(id);
	window.removeEventListener('pointerdown', s.onOutside, true);
	window.removeEventListener('keydown', s.onEscape, true);
	window.removeEventListener('blur', s.onBlur);
	window.removeEventListener('storage', s.onStorage);
	detachLayer(s.layer);
	if (window[API_KEY]?.stop === stopBar) delete window[API_KEY];
}

// Used by debug-off.js: stop everything, forget the switches, keep the notes.
export function teardown() {
	stop();
	const { annotator, themeOff } = switches();
	if (annotator || themeOff) writeState({ annotator: false, themeOff: false });
	document.getElementById(HOST_ID)?.remove();
}
