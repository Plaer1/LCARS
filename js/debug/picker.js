// LCARSv2 annotator picker (slice S18, gestures re-ported round 6). From ATOMS
// tools/steam-visual-audit.js and steam-annotation-highlights.js: while it is on,
// the page keeps working; only Alt gestures are held back, Alt-click notes the
// topmost element (or removes its note), and a Control tap hides the hover box.
// It must never trap input: the note box takes no hold on the page, and a click
// outside it or Esc always closes it. The input sits in a child frame, out of
// reach of Steam's key shortcuts.

import * as store from './store.js';
import { pinHover, unpinHover } from './hover-pin.js';

const KEY = '__lcarsV2DebugPickerV1';
export const HOST_ID = 'lc-debug-host';
const CSS_HREF = new URL('../../css/debug.css', import.meta.url).href;
const localPin = (on, token) => (on ? pinHover(token, location.href) : unpinHover(token));

const GESTURES = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'dragstart', 'contextmenu'];
const NOTE_MAX = 800;
const TAP_MS = 650;
const HOVER_KEY = 'lcarsv2.debug.hover-hidden';
const HINT = 'Optional note. Enter saves, even blank. Esc cancels.';

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

// One shadow-rooted host shared by every debug layer (picker, menu).
export function debugRoot() {
	let host = document.getElementById(HOST_ID);
	if (!host) {
		host = document.createElement('div');
		host.id = HOST_ID;
		host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;display:block!important';
		host.attachShadow({ mode: 'open' }).innerHTML = `<link rel="stylesheet" href="${CSS_HREF}">`;
		document.documentElement.appendChild(host);
		// Store pages replace their contents while navigating and the host can drop out.
		const watch = new MutationObserver(() => {
			if (!host.isConnected) document.documentElement.appendChild(host);
		});
		watch.observe(document.documentElement, { childList: true });
		host.lcUnwatch = () => watch.disconnect();
	}
	return host.shadowRoot;
}

export function attachLayer(name) {
	const root = debugRoot();
	let layer = root.querySelector(`[data-lc-layer="${name}"]`);
	if (!layer) {
		layer = document.createElement('div');
		layer.dataset.lcLayer = name;
		layer.style.cssText = 'position:fixed;inset:0;pointer-events:none';
		root.appendChild(layer);
	}
	return layer;
}

// Removes the host too once no layer is left, so a fully-off debug menu leaves no DOM.
export function detachLayer(layer) {
	const root = layer.getRootNode();
	layer.remove();
	if (root.host && !root.querySelector('[data-lc-layer]')) {
		root.host.lcUnwatch?.();
		root.host.remove();
	}
}

const cssEscape = (value) => (window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/[^A-Za-z0-9_-]/g, '\\$&'));

export function selectorFor(element) {
	if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
	if (element.id) return `#${cssEscape(element.id)}`;
	const classes = Array.from(element.classList).filter((name) => /^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(name)).slice(0, 4);
	return `${element.tagName.toLowerCase()}${classes.map((name) => `.${cssEscape(name)}`).join('')}`;
}

// The :nth-child index keeps identical sibling tiles apart; without it, a
// selector like div.tile matches every tile in a row with the same context.
export function contextFor(element) {
	const parts = [];
	for (let node = element; node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5; node = node.parentElement) {
		const index = node.parentElement ? Array.prototype.indexOf.call(node.parentElement.children, node) + 1 : 0;
		parts.unshift(`${selectorFor(node)}${index ? `:nth-child(${index})` : ''}`);
	}
	return parts.join(' > ');
}

// Where a frame's top-left corner sits in this page. Community modals are same-origin
// iframes: the picker reads and draws across them from the top page.
const frameOffset = (doc) => {
	let x = 0, y = 0;
	for (let frame = doc.defaultView?.frameElement; frame; frame = frame.ownerDocument.defaultView?.frameElement) {
		const rect = frame.getBoundingClientRect();
		x += rect.left + frame.clientLeft;
		y += rect.top + frame.clientTop;
	}
	return { x, y };
};

// An element in a frame belongs to the frame's page, not the page around it.
const routeOf = (element) => {
	const doc = element.ownerDocument;
	return doc === document ? store.pageKey() : doc.location.host + doc.location.pathname;
};

// The record fields a picked element contributes; the note is added on save.
export function describePicked(element) {
	return { route: routeOf(element), selector: selectorFor(element), context: contextFor(element) };
}

// The element a record points at: one selector match is taken as is; several need
// exactly one with the stored context. A tie resolves to nothing, not the wrong node.
export function resolveRecord(rec) {
	let found = [];
	try {
		found = Array.from(document.querySelectorAll(rec.selector));
	} catch (_) {
		return null;
	}
	if (found.length === 1) return found[0];
	const hits = found.filter((el) => contextFor(el) === rec.context);
	return hits.length === 1 ? hits[0] : null;
}

const PICKER_MARKUP = `
	<div class="dbg-box"><span class="dbg-label"></span></div>
	<div class="dbg-scrim" aria-hidden="true"></div>
	<div class="dbg-shield" aria-hidden="true"></div>
	<div class="dbg-note" role="dialog" aria-modal="true" aria-label="Annotation">
		<div class="dbg-note-title"></div>
		<div class="dbg-note-hint"></div>
		<iframe class="dbg-note-frame" title="Note text" srcdoc="<!doctype html><html><body></body></html>"></iframe>
		<div class="dbg-note-actions">
			<button type="button" class="dbg-btn" data-act="cancel">Cancel</button>
			<button type="button" class="dbg-btn dbg-primary" data-act="save">Save</button>
		</div>
	</div>`;

// relay: for windows too small to hold the note box (menus). The picked record goes
// to relay(rec) instead, and the main window opens the box with openRecord(rec).
// notes: where records live (store.js, or the main window's, for a web view).
// pin(true|false, token): keeps :hover on the elements marked data-lc-hover while Alt is
// held (js/debug/hover-pin.js, or the main window's copy of it for a web page).
export function installPicker({ onPicked, relay, notes = store, onNote, pin = localPin } = {}) {
	window[KEY]?.stop();
	const layer = attachLayer('picker');
	layer.innerHTML = PICKER_MARKUP;
	const shadow = layer.getRootNode();
	const box = layer.querySelector('.dbg-box');
	const label = layer.querySelector('.dbg-label');
	const scrim = layer.querySelector('.dbg-scrim');
	const shield = layer.querySelector('.dbg-shield');
	const note = layer.querySelector('.dbg-note');
	const title = layer.querySelector('.dbg-note-title');
	const hint = layer.querySelector('.dbg-note-hint');
	const frame = layer.querySelector('.dbg-note-frame');

	let hovered = null;
	let pointer = null; // last {x, y}; hit-tested once a frame, not on every mouse event
	let pending = null; // {element, rec} while the note box is open
	let raf = 0;
	let stopped = false;
	let hoverShown = true;
	try {
		hoverShown = sessionStorage.getItem(HOVER_KEY) !== '1';
	} catch (_) {
		// Blocked storage: the box starts shown.
	}

	// Compared as strings against a held list: this runs on hover, so no re-querying the page.
	let records = notes.list();
	const noteFor = (element) => {
		const here = routeOf(element);
		const selector = selectorFor(element);
		const candidates = records.filter((rec) => rec.status === 'open' && rec.route === here && rec.selector === selector);
		if (!candidates.length) return null;
		const context = contextFor(element);
		return candidates.find((rec) => rec.context === context) || null;
	};

	// Exactly the element on top, never a prettier ancestor; nothing over our own panel.
	// While Alt holds the page, the shield covers it: hit-test under it (synchronous, so
	// the page never sees the pointer).
	const elementAt = (x, y) => {
		const shielded = shield.classList.contains('is-on');
		if (shielded) shield.style.pointerEvents = 'none';
		let element = document.elementFromPoint(x, y);
		if (shielded) shield.style.pointerEvents = '';
		if (!element || element.id === HOST_ID) return null;
		while (element.tagName === 'IFRAME') {
			let doc = null;
			try {
				doc = element.contentDocument;
			} catch (_) {
				// Cross-origin: the frame itself is as deep as this can see.
			}
			const offset = doc && frameOffset(doc);
			const inner = doc?.elementFromPoint(x - offset.x, y - offset.y);
			if (!inner) break;
			element = inner;
		}
		return element;
	};

	// Viewport rect of an element, in this page's coordinates even inside a frame.
	const rectOf = (element) => {
		const rect = element.getBoundingClientRect();
		const { x, y } = frameOffset(element.ownerDocument);
		return { left: rect.left + x, top: rect.top + y, bottom: rect.bottom + y, width: rect.width, height: rect.height };
	};

	// Same for the pointer: an event from a frame reports frame coordinates.
	const pointOf = (event) => {
		const { x, y } = event.view && event.view !== window ? frameOffset(event.view.document) : { x: 0, y: 0 };
		return { x: event.clientX + x, y: event.clientY + y };
	};

	let labelFor = null; // the element the label text was worked out for
	const draw = () => {
		raf = 0;
		if (pointer && !pending && hoverShown) hovered = elementAt(pointer.x, pointer.y);
		const element = pending ? pending.element : hovered;
		const rect = hoverShown || pending ? element?.isConnected && rectOf(element) : null;
		if (!rect || rect.width <= 0 || rect.height <= 0) {
			box.classList.remove('is-on');
			return;
		}
		box.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
		box.style.width = `${Math.max(1, Math.round(rect.width))}px`;
		box.style.height = `${Math.max(1, Math.round(rect.height))}px`;
		box.classList.add('is-on');
		if (labelFor !== element) {
			labelFor = element;
			const action = pending ? 'note pending' : noteFor(element) ? 'noted · Alt-click to remove' : 'Alt-click to add a note';
			label.textContent = `${selectorFor(element)} · ${action}`;
		}
	};
	const schedule = () => {
		if (!raf && !stopped) raf = requestAnimationFrame(draw);
	};
	const unlisten = notes.onChange((list) => {
		records = list;
		labelFor = null;
		schedule();
	});

	const onMove = (event) => {
		pointer = pointOf(event);
		if (!pending) schedule();
	};

	const input = () => {
		try {
			return frame.contentDocument?.querySelector('input') || null;
		} catch (_) {
			return null;
		}
	};

	const focusInput = () => {
		if (!pending) return;
		const focus = () => {
			if (!pending) return;
			const field = input();
			if (!field) return;
			frame.contentWindow.focus();
			field.focus({ preventScroll: true });
		};
		focus();
		requestAnimationFrame(focus);
		setTimeout(focus, 48);
	};

	const close = () => {
		if (note.classList.contains('is-open')) onNote?.(false);
		pending = null;
		labelFor = null;
		scrim.classList.remove('is-on');
		note.classList.remove('is-open');
		const field = input();
		if (field) field.value = '';
		hint.textContent = HINT;
		hint.classList.remove('is-error');
		schedule();
	};

	const openNote = (element, rec) => {
		endHold(); // the note box takes over; hover styles go back to normal
		pending = { element, rec };
		labelFor = null;
		title.textContent = `Annotate · ${rec.route}`;
		hint.textContent = HINT;
		hint.classList.remove('is-error');
		const rect = element ? rectOf(element) : null;
		const width = Math.min(380, Math.max(220, innerWidth - 16));
		note.style.left = `${rect ? clamp(Math.round(rect.left), 8, Math.max(8, innerWidth - width - 8)) : Math.round((innerWidth - width) / 2)}px`;
		note.style.top = `${rect ? clamp(Math.round(rect.bottom + 8), 8, Math.max(8, innerHeight - 170)) : Math.round(innerHeight / 3)}px`;
		scrim.classList.add('is-on');
		note.classList.add('is-open');
		onNote?.(true);
		focusInput();
		schedule();
	};

	const save = () => {
		if (!pending) return;
		try {
			const rec = notes.add({ ...pending.rec, note: (input()?.value || '').trim().slice(0, NOTE_MAX) });
			close();
			onPicked?.(rec);
		} catch (err) {
			hint.textContent = err.message;
			hint.classList.add('is-error');
		}
	};

	// Alt gestures only, and never over our own layers: everything else reaches the
	// page. Alt-clicking a linked image would otherwise
	// start a download or drag, so the whole gesture is swallowed in the capture phase.
	const altTarget = (event) => {
		if (!event.altKey || pending || event.composedPath().some((node) => node.id === HOST_ID)) return null;
		const point = pointOf(event);
		const element = elementAt(point.x, point.y);
		if (!element) return null;
		event.preventDefault();
		event.stopImmediatePropagation();
		event.stopPropagation();
		return element;
	};
	const onGesture = (event) => {
		altTarget(event);
	};
	const onClick = (event) => {
		const element = altTarget(event);
		if (element) pickAt(element);
	};
	const pickAt = (element) => {
		const existing = noteFor(element);
		labelFor = null;
		if (existing) {
			try {
				notes.remove(existing.id);
				onPicked?.(null);
			} catch (err) {
				console.error('[lcars annotator]', err);
			}
			schedule();
		} else if (relay) relay(describePicked(element));
		else openNote(element, describePicked(element));
	};

	// Alt held (ATOMS' input lock): the elements under the pointer keep their hover styles
	// (pinned through DevTools), and a transparent shield takes the pointer away from the
	// page, so moving on can't end the hover. The picker still sees what is under the
	// pointer, and an Alt-click there annotates the hovered state.
	let hold = null;
	const beginHold = () => {
		if (hold || pending || stopped) return;
		const token = Math.random().toString(36).slice(2);
		const els = [...document.querySelectorAll(':hover')].filter((el) => el.id !== HOST_ID).slice(0, 64);
		for (const el of els) el.setAttribute('data-lc-hover', '');
		document.documentElement.dataset.lcPin = token;
		// Native window-drag regions bypass DOM events: off while Alt is held.
		const drag = document.createElement('style');
		drag.textContent = 'html, html *, html *::before, html *::after { -webkit-app-region: no-drag !important; }';
		(document.head || document.documentElement).append(drag);
		hold = { token, els, drag };
		Promise.resolve(pin(true, token)).catch(() => false).finally(() => {
			if (hold?.token === token) shield.classList.add('is-on'); // after the pin, so the hover never drops
		});
	};
	const endHold = () => {
		if (!hold) return;
		const { token, els, drag } = hold;
		hold = null;
		shield.classList.remove('is-on');
		drag.remove();
		for (const el of els) el.removeAttribute('data-lc-hover');
		delete document.documentElement.dataset.lcPin;
		try { pin(false, token); } catch (_) {}
	};
	const onHoldKey = (event) => {
		if (event.key !== 'Alt') return;
		if (event.type === 'keydown' && !event.repeat) beginHold();
		else if (event.type === 'keyup') endHold();
	};
	const onHoldLost = () => { if (document.hidden || !document.hasFocus()) endHold(); };
	shield.addEventListener('mousemove', (event) => onMove(event), { passive: true });
	shield.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const element = elementAt(event.clientX, event.clientY);
		if (element && !pending) pickAt(element);
	});
	for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'auxclick', 'contextmenu', 'wheel', 'dragstart']) {
		shield.addEventListener(type, (event) => { event.preventDefault(); event.stopPropagation(); }, { passive: false });
	}

	// A Control tap (down and up alone, quickly) hides or shows the hover box.
	const tapWindows = new Map();
	const attachTap = (win) => {
		if (tapWindows.has(win)) {
			const old = tapWindows.get(win);
			win.removeEventListener('keydown', old.keydown, true);
			win.removeEventListener('keyup', old.keyup, true);
		}
		let started = null;
		const handlers = {
			keydown: (event) => {
				if (event.key !== 'Control') {
					started = null;
				} else if (!event.repeat) {
					started = !event.altKey && !event.metaKey && !event.shiftKey ? Date.now() : null;
				}
			},
			keyup: (event) => {
				const tap = event.key === 'Control' && started !== null && Date.now() - started <= TAP_MS &&
					!event.altKey && !event.metaKey && !event.shiftKey;
				started = null;
				if (!tap) return;
				hoverShown = !hoverShown;
				try {
					sessionStorage.setItem(HOVER_KEY, hoverShown ? '0' : '1');
				} catch (_) {
					// Blocked storage: it just won't survive a reload.
				}
				schedule();
			},
			cancel: () => {
				started = null;
			},
		};
		win.addEventListener('keydown', handlers.keydown, true);
		win.addEventListener('keyup', handlers.keyup, true);
		win.addEventListener('pointerdown', handlers.cancel, true);
		win.addEventListener('wheel', handlers.cancel, true);
		win.addEventListener('blur', handlers.cancel, true);
		tapWindows.set(win, handlers);
	};

	// The frame's document starts empty and is rebuilt if the host ever moves (a move
	// reloads it), so it is filled here; values copied because it inherits no tokens.
	const onFrameLoad = () => {
		const doc = frame.contentDocument;
		if (!doc?.body) return;
		const style = getComputedStyle(shadow.host);
		const token = (name) => style.getPropertyValue(name).trim();
		Object.assign(doc.documentElement.style, { height: '100%', background: 'transparent' });
		Object.assign(doc.body.style, { height: '100%', margin: '0', overflow: 'hidden', background: 'transparent' });
		const field = doc.createElement('input');
		field.type = 'text';
		field.maxLength = NOTE_MAX;
		field.autocomplete = 'off';
		field.placeholder = 'e.g. reset to vanilla size';
		Object.assign(field.style, {
			boxSizing: 'border-box', width: '100%', height: '36px', padding: '0 10px', outline: 'none', borderRadius: '0',
			border: `1px solid ${token('--lc-gold')}`, background: token('--lc-black'), color: token('--lc-ink'),
			font: `500 14px ${token('--lc-prose') || 'sans-serif'}`,
		});
		field.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			if (event.key === 'Enter') save();
			else close();
		});
		doc.body.replaceChildren(field);
		attachTap(frame.contentWindow);
		focusInput();
	};

	const onAction = (event) => {
		const act = event.target.dataset?.act;
		if (act === 'save') save();
		else if (act === 'cancel') close();
	};
	// A click outside the box cancels it, and Esc works wherever focus went (a window
	// that lost key focus can't reach the input): the box can never trap you.
	const onEsc = (event) => {
		if (event.key !== 'Escape' || !pending) return;
		event.preventDefault();
		event.stopPropagation();
		close();
	};
	const onViewport = () => schedule();

	frame.addEventListener('load', onFrameLoad);
	if (frame.contentDocument?.readyState === 'complete' && frame.contentDocument.body) onFrameLoad();
	note.addEventListener('click', onAction);
	scrim.addEventListener('pointerdown', close);
	window.addEventListener('keydown', onEsc, true);
	window.addEventListener('keydown', onHoldKey, true);
	window.addEventListener('keyup', onHoldKey, true);
	window.addEventListener('blur', onHoldLost);
	document.addEventListener('visibilitychange', onHoldLost);
	document.addEventListener('mousemove', onMove, { capture: true, passive: true });
	for (const type of GESTURES) window.addEventListener(type, onGesture, true);
	window.addEventListener('click', onClick, true);
	window.addEventListener('scroll', onViewport, true);
	window.addEventListener('resize', onViewport);
	attachTap(window);

	// Events inside a frame never reach this window, so each same-origin frame gets the
	// same listeners. Steam adds modal frames at any time, and a frame that navigates has
	// lost them: keyed by document, looked for on a timer.
	const hookedFrames = new Map();
	const hookFrames = () => {
		for (const frameEl of document.querySelectorAll('iframe')) {
			let win = null, doc = null;
			try {
				win = frameEl.contentWindow;
				doc = win.document;
			} catch (_) {
				continue; // cross-origin
			}
			if (!doc || hookedFrames.has(doc)) continue;
			const listeners = [
				[doc, 'mousemove', onMove, { capture: true, passive: true }],
				[win, 'keydown', onEsc, true], [win, 'keydown', onHoldKey, true], [win, 'keyup', onHoldKey, true],
				[win, 'click', onClick, true], [win, 'scroll', onViewport, true],
				...GESTURES.map((type) => [win, type, onGesture, true]),
			];
			for (const [target, type, fn, opts] of listeners) target.addEventListener(type, fn, opts);
			attachTap(win);
			hookedFrames.set(doc, () => {
				for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
			});
		}
	};
	const frameTimer = setInterval(hookFrames, 500);
	hookFrames();

	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(frameTimer);
		for (const unhook of hookedFrames.values()) {
			try { unhook(); } catch (_) {} // the frame is already gone
		}
		if (note.classList.contains('is-open')) onNote?.(false); // an open box hid the web view: give it back
		cancelAnimationFrame(raf);
		unlisten();
		endHold();
		window.removeEventListener('keydown', onHoldKey, true);
		window.removeEventListener('keyup', onHoldKey, true);
		window.removeEventListener('blur', onHoldLost);
		document.removeEventListener('visibilitychange', onHoldLost);
		window.removeEventListener('keydown', onEsc, true);
		document.removeEventListener('mousemove', onMove, { capture: true });
		for (const type of GESTURES) window.removeEventListener(type, onGesture, true);
		window.removeEventListener('click', onClick, true);
		window.removeEventListener('scroll', onViewport, true);
		window.removeEventListener('resize', onViewport);
		for (const [win, handlers] of tapWindows) {
			try {
				win.removeEventListener('keydown', handlers.keydown, true);
				win.removeEventListener('keyup', handlers.keyup, true);
				win.removeEventListener('pointerdown', handlers.cancel, true);
				win.removeEventListener('wheel', handlers.cancel, true);
				win.removeEventListener('blur', handlers.cancel, true);
			} catch (_) {
				// The note frame's window is already gone.
			}
		}
		detachLayer(layer);
		if (window[KEY]?.stop === stop) delete window[KEY];
	};
	window[KEY] = {
		stop,
		hold: (on) => (on ? beginHold() : endHold()),
		openRecord: (rec) => {
			if (pending) return;
			openNote(null, rec);
			// The pick came from a menu window, which had key focus.
			try {
				window.SteamClient?.Window?.SetKeyFocus?.(true);
			} catch (_) {
				// Esc and the Cancel button still work.
			}
		},
	};
	return window[KEY];
}

export function stopPicker() {
	window[KEY]?.stop();
}
