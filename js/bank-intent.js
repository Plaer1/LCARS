// LCARSv2 bank intent: one open and close model for the bank's menu buttons (S08).
// SuperNav buttons open on hover in Steam; root menus open on click only. Here
// both wait 140 ms of resting pointer, switch at once to a sibling while one is
// open, pin on click, and close on Escape or an outside click. The SuperNav
// enter handler is wrapped on the React props object (React reads it at dispatch
// time) so the hover is held until the intent fires; every open goes through the
// retained menu instance, found the way js/flyouts.js finds it.

const KEY = '__lcarsV2BankIntentV1';
const SUPER = '.lc-bank ._7AlhCx3XGzBeIrQaCneUD';
const ROOT = '.lc-bank-sys ._2UyOBeiSdBayaFdRa39N2O';
const BTN = `${SUPER}, ${ROOT}`;
const DWELL = 140;
// Menu aim: while a menu is open, a pointer heading right (toward the flyouts,
// which always open beside the bank) is on its way into that menu, so a sibling
// it crosses (FRIENDS on the way to VIEW's menu) must not steal it. Such a
// sibling only takes over if the pointer rests on it this long.
const AIM_HOLD = 250;
// A hover-opened menu waits this long after the pointer leaves before Steam's
// own close runs, so a sweep onto a sibling switches instead of closing first.
const LEAVE_GRACE = 220;
const POLL = 200;
// steam.js already beeps on any bank click, so a click-open stays silent here.
const CLICK_QUIET = 500;

function reactKey(el, prefix) {
	return Object.keys(el).find(k => k.startsWith(prefix));
}

function menuInstance(el) {
	const key = reactKey(el, '__reactFiber$');
	let fiber = key && el[key];
	for (let depth = 0; fiber && depth < 6; depth++, fiber = fiber.return) {
		for (let hook = fiber.memoizedState; hook; hook = hook.next) {
			const v = hook.memoizedState;
			if (v && typeof v === 'object' && v.current && typeof v.current.Show === 'function' && v.current.m_options) return v.current;
		}
	}
	return null;
}

function propsOf(el) {
	const key = reactKey(el, '__reactProps$');
	return key ? el[key] : null;
}

function wrap(orig, fn) {
	fn.__orig = orig;
	fn.__lcIntent = true;
	return fn;
}

export function install() {
	window[KEY]?.stop();

	let alive = true;
	let dwellBtn = null;
	let dwellTimer = 0;
	let leaveTimer = 0;
	let pinnedBtn = null;
	let trail = []; // recent pointer samples [x, y, t] for the aim direction
	let lastOpened = null;
	let clickAt = -Infinity;
	let bar = null;
	let queued = false;
	let queuedFrame = 0;
	const listeners = [];
	const listen = (target, type, fn) => {
		target.addEventListener(type, fn, true);
		listeners.push(() => target.removeEventListener(type, fn, true));
	};

	const buttons = () => document.querySelectorAll(BTN);
	const instOf = btn => menuInstance(btn);
	const isOpen = btn => !!instOf(btn)?.m_bVisible;
	const anyOpen = () => [...buttons()].some(isOpen);

	// Wrap Steam's enter/leave on the props object. Steam re-renders replace the
	// object, so this runs again on the next mouseover/mouseout over a button.
	function patch(btn) {
		// Steam leaves these divs out of the Tab order (tabIndex -1); keyboard users need them.
		if (btn.tabIndex < 0) {
			btn.tabIndex = 0;
			btn.setAttribute('role', 'button');
			btn.dataset.lcTab = '1';
		}
		const p = propsOf(btn);
		if (!p) return;
		if (typeof p.onMouseEnter === 'function' && !p.onMouseEnter.__lcIntent) {
			const orig = p.onMouseEnter;
			p.onMouseEnter = wrap(orig, e => (alive ? onEnter(btn) : orig.call(btn, e)));
		}
		if (typeof p.onMouseLeave === 'function' && !p.onMouseLeave.__lcIntent) {
			const orig = p.onMouseLeave;
			p.onMouseLeave = wrap(orig, e => (alive ? onLeave(btn, orig, e) : orig.call(btn, e)));
		}
	}

	function clearDwell() {
		clearTimeout(dwellTimer);
		dwellTimer = 0;
		dwellBtn = null;
	}

	function clearLeave() {
		clearTimeout(leaveTimer);
		leaveTimer = 0;
	}

	function hideOthers(btn) {
		for (const other of buttons()) if (other !== btn && isOpen(other)) instOf(other)?.Hide();
	}

	function hideAll() {
		clearDwell();
		clearLeave();
		pinnedBtn = null;
		for (const b of buttons()) if (isOpen(b)) instOf(b)?.Hide();
		scheduleReconcile();
	}

	// Both kinds open through their retained instance. Steam's own enter handler
	// opens SuperNavs unreliably when a sibling was just hidden, so it is not used
	// for opening; its leave still closes a hover-opened menu (see onLeave).
	function openNow(btn) {
		const inst = instOf(btn);
		if (inst && !inst.m_bVisible) inst.Show();
	}

	function switchTo(btn, pin) {
		clearLeave();
		hideOthers(btn);
		pinnedBtn = pin ? btn : null;
		openNow(btn);
		scheduleReconcile();
	}

	// Heading toward the flyouts: mostly rightward over the last ~80 ms.
	function aimingRight() {
		const now = performance.now();
		const recent = trail.filter(p => now - p[2] < 80);
		if (recent.length < 2) return false;
		const dx = recent[recent.length - 1][0] - recent[0][0];
		const dy = recent[recent.length - 1][1] - recent[0][1];
		return dx > 2 && dx >= Math.abs(dy) * 0.5;
	}

	function onEnter(btn) {
		clearLeave();
		if (isOpen(btn)) return;
		if (anyOpen()) {
			if (!aimingRight()) { switchTo(btn, false); return; }
			clearDwell();
			dwellBtn = btn; // leaving this sibling (as a crossing pointer does) cancels it
			dwellTimer = setTimeout(() => { dwellTimer = 0; dwellBtn = null; switchTo(btn, false); }, AIM_HOLD);
			return;
		}
		clearDwell();
		dwellBtn = btn;
		dwellTimer = setTimeout(() => {
			dwellTimer = 0;
			dwellBtn = null;
			switchTo(btn, false);
		}, DWELL);
	}

	function onLeave(btn, leave, e) {
		if (dwellBtn === btn) clearDwell();
		// Only an open menu has anything to close; passing a crossed sibling's leave
		// to Steam closes the shared root menu the pointer is heading into.
		if (!isOpen(btn)) return;
		// A pinned menu stays up until Escape, an outside click, or a sibling.
		if (pinnedBtn === btn) return;
		clearLeave();
		leaveTimer = setTimeout(() => {
			leaveTimer = 0;
			leave.call(btn, e);
		}, LEAVE_GRACE);
	}

	function showBar(btn) {
		hideBar();
		const bank = btn.closest('.lc-bank');
		if (!bank) return;
		const r = btn.getBoundingClientRect();
		bar = document.createElement('div');
		bar.className = 'lc-bank-bar';
		bar.style.left = `${bank.getBoundingClientRect().right}px`;
		bar.style.top = `${r.top}px`;
		bar.style.height = `${r.height}px`;
		document.body.append(bar);
	}

	function hideBar() {
		if (!bar) return;
		const old = bar;
		bar = null;
		old.classList.add('lc-retract');
		setTimeout(() => old.remove(), 160);
	}

	// Single source of truth: the instance's m_bVisible. Reflect it on the
	// buttons and keep one bank menu up at a time.
	function scheduleReconcile() {
		if (queued) return;
		queued = true;
		queuedFrame = requestAnimationFrame(reconcile);
	}

	function reconcile() {
		queued = false;
		if (!alive) return;
		const btns = [...buttons()];
		let open = btns.filter(isOpen);
		if (open.length > 1) {
			const keep = open.includes(lastOpened) ? lastOpened : open[open.length - 1];
			for (const b of open) if (b !== keep) instOf(b)?.Hide();
			open = [keep];
		}
		if (pinnedBtn && !open.includes(pinnedBtn) && performance.now() - clickAt > CLICK_QUIET) pinnedBtn = null;
		for (const b of btns) {
			const shown = open.includes(b);
			const was = b.hasAttribute('data-lc-open');
			if (shown) {
				b.dataset.lcOpen = b === pinnedBtn ? 'pin' : 'hover';
				if (!was) opened(b);
			} else if (was) {
				delete b.dataset.lcOpen;
			}
		}
		if (!open.length) hideBar();
	}

	function opened(btn) {
		lastOpened = btn;
		showBar(btn);
		// No chirp here: hover-opens stay silent (design canon), and click-opens
		// already chirp from steam.js's bank click handler.
	}

	// React turns mouseout into enter/leave, so patch before its root listener runs.
	const patchNear = el => {
		const b = el instanceof Element ? el.closest(BTN) : null;
		if (b) patch(b);
	};
	listen(document, 'mousemove', e => {
		trail.push([e.clientX, e.clientY, performance.now()]);
		if (trail.length > 8) trail = trail.slice(-8);
	});
	listen(document, 'mouseover', e => patchNear(e.target));
	listen(document, 'mouseout', e => patchNear(e.relatedTarget));

	listen(document, 'click', e => {
		const btn = e.target instanceof Element ? e.target.closest(BTN) : null;
		if (!btn) return;
		// A destination (STORE, LIBRARY...) navigates on click now that its label fills
		// the segment; pinning its menu open over the new page is only in the way.
		if (btn.matches(SUPER)) { hideAll(); return; }
		clearDwell();
		clickAt = performance.now();
		hideOthers(btn);
		pinnedBtn = btn;
		// Steam's own click handler shows a root menu. Open here if it did not.
		if (!isOpen(btn)) openNow(btn);
		requestAnimationFrame(() => {
			if (alive && !isOpen(btn)) openNow(btn);
			scheduleReconcile();
		});
	});

	listen(document, 'keydown', e => {
		if (e.key === 'Escape' && anyOpen()) { hideAll(); return; }
		// The bank segments are divs: Enter or Space on a focused one clicks it.
		const btn = (e.key === 'Enter' || e.key === ' ') && e.target instanceof Element ? e.target.closest(BTN) : null;
		if (btn && btn.tagName !== 'BUTTON') { e.preventDefault(); btn.click(); }
	});

	listen(document, 'pointerdown', e => {
		if (e.target instanceof Element && e.target.closest(BTN)) return;
		if (anyOpen()) hideAll();
	});

	const observer = new MutationObserver(() => {
		buttons().forEach(patch);
		scheduleReconcile();
	});
	observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
	const poll = setInterval(scheduleReconcile, POLL);

	window[KEY] = {
		stop() {
			alive = false;
			clearDwell();
			clearLeave();
			clearInterval(poll);
			if (queued) cancelAnimationFrame(queuedFrame);
			observer.disconnect();
			for (const off of listeners) off();
			for (const b of buttons()) {
				const p = propsOf(b);
				for (const k of ['onMouseEnter', 'onMouseLeave']) if (p?.[k]?.__lcIntent) p[k] = p[k].__orig;
				delete b.dataset.lcOpen;
				if (b.dataset.lcTab) {
					b.tabIndex = -1;
					b.removeAttribute('role');
					delete b.dataset.lcTab;
				}
			}
			document.querySelectorAll('.lc-bank-bar').forEach(n => n.remove());
			delete window[KEY];
		},
	};

	buttons().forEach(patch);
	scheduleReconcile();
}
