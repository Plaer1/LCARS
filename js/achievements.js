// LCARSv2 library achievements helpers (slice S07). The CSS draws the gauges
// and chips; this does two things CSS cannot: tags RARE (global unlock under
// 5%) and classified (hidden) rows from their text, and fills the gauge bars
// with Web Animations (length-scaled, jittered, ticked). Bars are filled once,
// when they first enter the viewport. The inline width stays the data: the
// animation only scales the bar's transform and restores it when it ends.
// Idempotent: install() stops any earlier copy first, and stop() removes every
// class, observer and animation it added.

const KEY = '__lcarsV2AchievementsV1';
const OVERLAY = '.HruWVPwIDh2FFOOH7OiSs';
const ROW = '._316Uo4SBrQ_beBdSYn2HNO';
const NAME = '._3LS_NZyqY77COuRN-Z3TVB';
const PCT = '._17WmAft0lOwrau_jKP2_JW';
const BAR = '._2lgHVJbZwxb10Md7bZ6USU, ._2_0JonK7eKEvh8IoOvq0-B'; // global row fill, header fill
const RARE_BELOW = 5;
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

function tagRows(overlay) {
	for (const row of overlay.querySelectorAll(ROW)) {
		const pct = row.querySelector(PCT)?.textContent.trim() ?? '';
		const name = row.querySelector(NAME)?.textContent.trim() ?? '';
		row.classList.toggle('lc-rare', pct.startsWith('<') || parseFloat(pct) < RARE_BELOW);
		row.classList.toggle('lc-classified', /^hidden achievement/i.test(name));
	}
}

// Keyframes for a bar that ends at fraction f. Long bars get two stepped ticks
// (held values that jump) and a slight overshoot before settling.
function frames(f) {
	if (f < 0.5) return [{ transform: 'scaleX(0)', offset: 0, easing: EASE }, { transform: 'scaleX(1.03)', offset: 0.82, easing: EASE }, { transform: 'scaleX(1)', offset: 1 }];
	return [
		{ transform: 'scaleX(0)', offset: 0, easing: EASE },
		{ transform: `scaleX(${(f * 0.33).toFixed(3)})`, offset: 0.25, easing: 'steps(1, end)' },
		{ transform: `scaleX(${(f * 0.66).toFixed(3)})`, offset: 0.45, easing: 'steps(1, end)' },
		{ transform: `scaleX(${(f * 0.85).toFixed(3)})`, offset: 0.65, easing: EASE },
		{ transform: 'scaleX(1.03)', offset: 0.82, easing: EASE },
		{ transform: 'scaleX(1)', offset: 1 },
	];
}

export function install() {
	window[KEY]?.stop();

	let overlay = null;
	let rowObserver = null;
	let rowFrame = 0;
	let mountFrame = 0;
	const anims = new Set();
	const seenBars = new WeakSet();

	const playBar = (el) => {
		const f = Math.min(Math.max(parseFloat(el.style.width) / 100, 0), 1);
		if (!f || reduced.matches) return;
		const row = el.closest(ROW);
		const index = row ? [...row.parentElement.children].indexOf(row) : 0;
		const duration = (250 + f * 650) * (0.85 + Math.random() * 0.3);
		const delay = (index < 12 ? index * 30 : 0) + Math.random() * 120;
		const anim = el.animate(frames(f), { duration, delay, fill: 'backwards' });
		anims.add(anim);
		anim.onfinish = () => anims.delete(anim);
	};

	// Each bar fills once, when it first scrolls into view.
	const bars = new IntersectionObserver((entries) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			bars.unobserve(e.target);
			playBar(e.target);
		}
	});

	const scan = () => {
		rowFrame = 0;
		if (!overlay?.isConnected) return;
		tagRows(overlay);
		for (const bar of overlay.querySelectorAll(BAR)) {
			if (seenBars.has(bar)) continue;
			seenBars.add(bar);
			if (!reduced.matches) bars.observe(bar);
		}
	};

	const scheduleScan = () => {
		if (!rowFrame) rowFrame = requestAnimationFrame(scan);
	};

	// Follow the overlay as it mounts and unmounts; it sits deep in Steam's tree.
	const attach = () => {
		mountFrame = 0;
		const found = document.querySelector(OVERLAY);
		if (found === overlay) return;
		rowObserver?.disconnect();
		rowObserver = null;
		overlay = found;
		if (!overlay) return;
		rowObserver = new MutationObserver(scheduleScan);
		rowObserver.observe(overlay, { childList: true, subtree: true, characterData: true });
		scheduleScan();
	};

	const scheduleAttach = () => {
		if (!mountFrame) mountFrame = requestAnimationFrame(attach);
	};

	const mountObserver = new MutationObserver(scheduleAttach);
	mountObserver.observe(document.body, { childList: true, subtree: true });

	const stop = () => {
		mountObserver.disconnect();
		rowObserver?.disconnect();
		bars.disconnect();
		if (rowFrame) cancelAnimationFrame(rowFrame);
		if (mountFrame) cancelAnimationFrame(mountFrame);
		for (const anim of anims) anim.cancel();
		anims.clear();
		for (const row of document.querySelectorAll(`${ROW}.lc-rare, ${ROW}.lc-classified`)) {
			row.classList.remove('lc-rare', 'lc-classified');
		}
		overlay = null;
		rowObserver = null;
		if (window[KEY]?.stop === stop) delete window[KEY];
	};

	window[KEY] = { stop };
	attach();
}
