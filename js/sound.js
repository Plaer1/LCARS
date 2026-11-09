// LCARSv2 console sounds (optional, "UI sounds" setting). Short tones synthesized live with
// Web Audio: original to this theme, nothing sampled, shipped or copied from anywhere.
// Quiet by design. Theme code calls beep(kind); Steam's own controls are classified here by
// one click listener per window, and web pages send their sounds over from js/web/transitions.js.

// [frequency Hz, start s, length s, level (1 = normal), waveform]
const VOICES = {
	// two-step chirp up: moving between departments / views
	nav: [[1320, 0, .045], [1760, .05, .05]],
	// single short blip: selecting a record or a sort column
	select: [[2093, 0, .035]],
	// descending pair: issuing a command (play, open, install)
	command: [[1568, 0, .06], [1175, .07, .09]],
	hover: [[2640, 0, .018, .22]],     // pointer reaches a command
	link: [[1760, 0, .02, .6]],        // any other button or link
	tick: [[3136, 0, .02, .5]],        // checkbox, small step
	chip: [[2489, 0, .03, .8]],        // filter chip
	step: [[1760, 0, .03, .7], [2349, .035, .03, .7]], // carousel and pager arrows
	tab: [[1480, 0, .04], [1976, .045, .04]],          // tab within a page
	open: [[988, 0, .03], [1319, .035, .03], [1760, .07, .05]],  // menu, drawer or dialog opens
	close: [[1760, 0, .03], [1319, .035, .03], [988, .07, .05]], // and closes
	on: [[1175, 0, .04], [1760, .05, .07]],  // toggle on
	off: [[1760, 0, .04], [1175, .05, .07]], // toggle off
	confirm: [[1319, 0, .05], [1661, .055, .05], [1976, .11, .1]], // primary dialog button
	cancel: [[880, 0, .06, .9, 'triangle'], [659, .07, .1, .9, 'triangle']],
	notify: [[1976, 0, .07], [1976, .12, .07], [2637, .24, .16]],  // a toast arrives
};

// First match wins. A function gets the matched element.
const CLICKS = [
	['.DialogToggle, ._9Ql-oVe_j8E-vsDdyVdWo', el => (/\bOn\b/.test(el.className) || el.getAttribute('aria-checked') === 'true' ? 'on' : 'off')],
	['.DialogCheckbox, .lc-fx-tagmore, ._3sz4Ldugm_cV_JaHOErVR8', 'tick'],
	['.lc-fx-chip', 'chip'],
	['._29NTOneobxPjUfxHUk9N8Y > *, .bsNegRKT1Hbv4tqHrOk9- > *', 'step'],
	['[role="tab"], ._1b6LYWVijW-9E4YV0keDWZ, ._1-vlriAtKYDViAEunue4VO', 'tab'],
	['.DialogDropDown, .lc-fx-filter, .lc-fx-more, .lc-ops-coll', 'open'],
	['.closeButton, .lc-fx-close, .lc-fx-x', 'close'],
	['.contextMenuItem, [class*="contextMenuItem"]', 'select'],
	['.DialogButton.Primary', 'confirm'],
	['.DialogButton.Secondary', 'cancel'],
	['button, [role="button"], a', 'link'],
];
const HOVERS = '._7AlhCx3XGzBeIrQaCneUD, ._2UyOBeiSdBayaFdRa39N2O, .lc-rail-toggle [data-mode], .lc-ops-tabs button, .cmd-run, .cmd-open, .cmd-store';

let ctx = null;
let lastAt = 0;
const GAP = 60; // ms: theme code's own beep for a click wins over the listener's

function tone(freq, at, len, level = 1, type = 'sine') {
	const t = ctx.currentTime + at;
	const osc = ctx.createOscillator();
	const amp = ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(freq, t);
	amp.gain.setValueAtTime(0, t);
	amp.gain.linearRampToValueAtTime(0.05 * level, t + 0.006);
	amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
	osc.connect(amp).connect(ctx.destination);
	osc.start(t);
	osc.stop(t + len + 0.02);
}

window.__lcarsBeep = kind => {
	const voice = VOICES[kind];
	if (!voice) return;
	lastAt = performance.now();
	try {
		ctx ||= new AudioContext();
		if (ctx.state === 'suspended') ctx.resume();
		for (const v of voice) tone(...v);
	} catch (_) {}
};

const attached = new WeakSet();

// One window's clicks and hovers. Runs at the bottom of the bubble, after Steam and the theme.
window.__lcarsSfxAttach = win => {
	if (attached.has(win.document)) return;
	attached.add(win.document);
	let hovered = null;
	win.addEventListener('click', event => {
		if (performance.now() - lastAt < GAP || !event.target.closest) return;
		for (const [selector, kind] of CLICKS) {
			const el = event.target.closest(selector);
			if (el) { window.__lcarsBeep(typeof kind === 'function' ? kind(el) : kind); return; }
		}
	});
	win.addEventListener('pointerover', event => {
		const el = event.target.closest?.(HOVERS) || null;
		if (el && el !== hovered) window.__lcarsBeep('hover');
		hovered = el;
	}, { passive: true });
};
window.__lcarsSfxAttach(window);

// The web view is a separate page: it says what was clicked (js/web/transitions.js).
let view = null;
const onViewMessage = (name, kind) => { if (name === 'lcars-sfx') window.__lcarsBeep(kind); };
setInterval(() => {
	let current = null;
	try { current = (window.opener || window).MainWindowBrowserManager?.m_browser || null; } catch (_) { return; }
	if (current === view || !current?.on) return;
	view?.off('message', onViewMessage);
	view = current;
	view.on('message', onViewMessage);
}, 1000);
