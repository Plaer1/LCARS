// LCARSv2 boot sequence: once per UI load the console powers up over the
// shell (scan, elbow, bank segments lighting in order, rails), the library
// computer identifies itself with the real record count and stardate, then
// hands over to the live shell once Steam has finished loading it. Any click or
// key skips it. When UI
// sounds are on it has its own sound track (js/boot-sfx.js) that leads into the
// chosen boot jingle on "All systems nominal".

import { host, clockParts } from './data.js';
import { playBootSound } from './boot-sfx.js';

const KEY = '__lcarsV2BootV1';
const DONE = '__lcarsV2BootDone';
const STRETCH = 1.3; // the keyframes in css/boot.css play this much slower
const TOTAL = 2400 * STRETCH;
const NOMINAL = 1600 * STRETCH; // ms: "All systems nominal" lights, and the jingle starts
const HANDOVER = 800; // ms: the .out sequence in css/boot.css
// Steam builds the shell for seconds after this starts, in long stalls. The overlay
// holds its last frame until the shell is there and the page has run smoothly for a
// while, so the loading stays behind it (clicks still skip).
const HOLD_MAX = 20000;
const SETTLED = 600; // ms of unbroken frames
const FRAME_GAP = 70; // ms: a longer frame means Steam is still busy
const shellReady = () => {
	const cls = document.documentElement.classList;
	return document.querySelectorAll('.lc-bank ._7AlhCx3XGzBeIrQaCneUD').length > 2
		&& !cls.contains('lc-boot')
		&& document.querySelector('._3xRRJfD2xy95i9NhJxLTp0, .lc-reg-rows > *')
		&& (!cls.contains('lc-ops-full') || document.querySelector('.lc-reg-rows > *'))
		&& (document.querySelector('.lc-well-art img')?.complete ?? true);
};

const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Steam's collection getters are MobX computeds that throw (and poison Steam's
// own render) if read before its services finish initialising, so wait first.
async function recordCount() {
	try {
		await host().App?.WaitForServicesInitialized?.();
		return host().collectionStore.allGamesCollection.allApps.length || 0;
	} catch (_) { return 0; }
}

// The real top bar's blocks, each with what it copies. Boot draws them at the sizes they
// usually have; once the bar exists they take its exact places, colours and names.
const TOP_BAR = {
	bar: '._30vB9DdsPK7VrZAbb5Q1Av',
	title: '.lc-title',
	toggle: '.lc-rail-toggle',
	ops: '.lc-rail-toggle [data-mode="ops"]',
	shelves: '.lc-rail-toggle [data-mode="shelves"]',
	news: '._2Szzh5sKyGgnLUR870zbDE._5wILZhsLODVwGfcJ0hKmJ',
	alerts: '._2Szzh5sKyGgnLUR870zbDE.RtSv39ZoBOySnb8XQ5hJf',
	account: '._3yD46y5pd3zOGR7CzKs0mC',
	big: '._2Szzh5sKyGgnLUR870zbDE[class*="_3LKQ3S_yqrebeNL"]',
	controls: '.qP17eBPXkfezFfexZ4hC3',
};

function alignTopBar(root) {
	const row = document.querySelector('._39oUCO1OuizVPwcnnv88no')?.getBoundingClientRect();
	if (!row?.width) return;
	for (const [id, selector] of Object.entries(TOP_BAR)) {
		const block = root.querySelector(`.b-${id}`), real = document.querySelector(selector);
		block.style.display = real ? '' : 'none';
		if (!real) continue;
		const box = real.getBoundingClientRect();
		Object.assign(block.style, { left: `${box.left - row.left}px`, right: 'auto', width: `${box.width}px`, background: getComputedStyle(real).backgroundColor });
		const text = real.textContent.trim(), label = block.querySelector('span');
		if (label && text) label.textContent = text;
	}
	// The beam covers everything up to the title's end, and shrinks to what is left of the title.
	const title = document.querySelector(TOP_BAR.title)?.getBoundingClientRect();
	if (!title?.width) return;
	const beam = root.querySelector('.b-beam');
	beam.style.width = `${title.right - row.left}px`;
	beam.style.setProperty('--sliver', (title.left - row.left) / (title.right - row.left));
}

// Everything else the frame is painted with: bank, bottom rail, resize cap. Boot draws these
// where they really are, so at the handover the frame can simply stay.
const FRAME_BLOCKS = '._25lBLzuVeYAUG279up4xP8, ._7AlhCx3XGzBeIrQaCneUD, ._2UyOBeiSdBayaFdRa39N2O, .lc-plugins, .lc-bank-fill, .lc-elbow-bottom, ._2EQ7ghgqIdjKv9jsQC0Zq9, ._1TdaAqMFadi0UTqilrkelR, .window_resize_grip';
const FRAME_KEY = 'lcarsv2.boot.frame'; // the last layout, so the first frames are already right

const measureFrame = () => [...document.querySelectorAll(FRAME_BLOCKS)].map(el => {
	const box = el.getBoundingClientRect(), css = getComputedStyle(el);
	return { l: box.left, t: box.top, w: box.width, h: box.height, c: css.backgroundColor, r: css.borderRadius, i: css.backgroundImage };
}).filter(b => b.w && b.h);

function paintFrame(layer, blocks) {
	layer.replaceChildren(...blocks.map((b, n) => {
		const el = document.createElement('i');
		Object.assign(el.style, { left: `${b.l}px`, top: `${b.t}px`, width: `${b.w}px`, height: `${b.h}px`, borderRadius: b.r, backgroundImage: b.i });
		el.style.setProperty('--seg', b.c);
		el.style.setProperty('--n', n);
		return el;
	}));
	layer.dataset.sig = JSON.stringify(blocks);
}

function savedFrame() {
	try {
		const saved = JSON.parse(localStorage.getItem(FRAME_KEY));
		return saved?.win === `${innerWidth}x${innerHeight}` ? saved.blocks : null;
	} catch (_) { return null; }
}

// Once the real frame exists: boot's blocks become exactly it, without replaying their light-up.
function alignFrame(root) {
	const blocks = measureFrame();
	if (blocks.length < 8) return;
	const layer = root.querySelector('.b-frame');
	if (layer.dataset.sig === JSON.stringify(blocks)) return;
	layer.classList.add('settled');
	paintFrame(layer, blocks);
	root.querySelector('.b-bank')?.remove();
	root.querySelector('.b-rail-base')?.remove();
	try { localStorage.setItem(FRAME_KEY, JSON.stringify({ win: `${innerWidth}x${innerHeight}`, blocks })); } catch (_) {}
}

// The scrolling column: your real record IDs, twice over so the loop has no seam.
function fillStream(el) {
	try {
		const ids = [...host().collectionStore.allGamesCollection.allApps].slice(0, 44).map(a => String(a.appid).padStart(7, '0'));
		el.textContent = [...ids, ...ids].join('\n');
	} catch (_) { /* no column is fine */ }
}

function countUp(el, to, ms) {
	const t0 = performance.now();
	const step = t => {
		const p = Math.min(1, (t - t0) / ms);
		el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3)))).padStart(4, '0');
		if (p < 1 && el.isConnected) requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}

// The jingle choice arrives as a CSS variable from the "Boot jingle" setting;
// sounds are allowed only when the "UI sounds" setting loaded sound.js.
async function jingle(at) {
	const css = getComputedStyle(document.documentElement);
	const read = name => css.getPropertyValue(name).trim().replace(/"/g, '');
	let choice = read('--lc-jingle') || 'match';
	if (choice === 'none') return;
	if (choice === 'match') choice = read('--lc-palette-jingle') || 'local:2'; // the design-doc palette is TNG-era
	try {
		const j = await import('./jingles.js');
		const list = await j.list();
		const n = /^local:(\d+)$/.exec(choice);
		const entry = n ? list[Number(n[1]) - 1] : list[Math.floor(Math.random() * list.length)];
		if (entry) await j.play(entry, undefined, at);
	} catch (e) { console.warn('[lcarsv2] jingle:', e); }
}

// With the Change Window Params plugin, Steam's first main window after a start or a UI
// reload is opaque, and the plugin replaces it with a transparent one a moment later.
// Booting there would play twice, the first time out of sight. So boot waits for the
// plugin's verdict (window.__cwpDecision) when this window has no flags from it.
const CWP_SEEN = 'lcarsv2.cwp'; // remembered once the plugin is known to be in use
async function finalWindow() {
	const h = host();
	if (h.__cwpCreateFlags?.[window.name] != null) {
		try { localStorage.setItem(CWP_SEEN, '1'); } catch (_) {}
		return true;
	}
	let seen = false;
	try { seen = localStorage.getItem(CWP_SEEN) === '1'; } catch (_) {}
	if (!seen && !h.PLUGIN_LIST?.['steam-change-window-params']) return true;
	for (let waited = 0; waited < 3000; waited += 100) {
		if (h.__cwpDecision) return h.__cwpDecision !== 'rebuild';
		await new Promise(r => setTimeout(r, 100));
	}
	return true;
}

export function install() {
	window[KEY]?.stop();
	if (window[DONE] || document.title !== 'Steam') return;
	window[DONE] = true;
	finalWindow().then(final => { if (final) boot(); });
}

function boot() {
	const root = document.createElement('div');
	root.id = 'lc-boot';
	root.setAttribute('aria-hidden', 'true');
	root.innerHTML = `
		<div class="b-center"><div class="b-well"></div></div>
		<div class="b-scan"></div>
		<div class="b-elbow"><span>LCARS</span></div>
		<div class="b-bank">${['01', '02', '03', '04', '05', '06'].map((n, i) => `<i style="--n:${i}"><b>${n}</b></i>`).join('')}</div>
		<div class="b-top">
			<i class="b-bar"></i>
			<div class="b-title"><span>Library • Operations</span></div>
			<i class="b-beam"></i>
			<i class="b-toggle"></i>
			<div class="b-ops"><span>Ops</span></div>
			<div class="b-shelves"><span>Shelves</span></div>
			<div class="b-news"><span>News</span></div>
			<div class="b-alerts"><span>Alerts</span></div>
			<div class="b-account"><span></span></div>
			<div class="b-big"><span>Big Picture</span></div>
			<i class="b-controls"></i>
		</div>
		<div class="b-rail b-rail-base"></div>
		<div class="b-frame"></div>
		<div class="b-id">
			<h1>Library computer</h1>
			<h2><span>Access and retrieval system</span></h2>
			<dl>
				<div><dt>Records</dt><dd class="b-records">0000</dd></div>
				<div><dt>${getComputedStyle(document.documentElement).getPropertyValue('--lc-stardate').trim() === '1' ? 'Stardate' : 'Date'}</dt><dd>${clockParts().date}</dd></div>
				<div><dt>Banks</dt><dd class="b-banks">00/06</dd></div>
			</dl>
			<p class="b-ok">All systems nominal</p>
			<div class="b-sweep"><i></i></div>
		</div>
		<div class="b-widgets">
			<div class="b-stream"><div></div></div>
			<div class="b-gauges">
				<div class="b-rings"><i></i><i></i><i></i><b></b></div>
				<div class="b-eq">${Array.from({ length: 16 }, (_, n) => `<i style="--n:${n}"></i>`).join('')}</div>
				<p>Accessing records</p>
			</div>
		</div>`;
	// The readout swipes off with the black, so it lives in the centre layer under the frame.
	root.querySelector('.b-center').append(root.querySelector('.b-id'), root.querySelector('.b-widgets'));
	const known = savedFrame();
	if (known) {
		paintFrame(root.querySelector('.b-frame'), known);
		root.querySelector('.b-bank').remove();
		root.querySelector('.b-rail-base').remove();
	}
	document.body.appendChild(root);
	if (reduce()) root.classList.add('still');
	else for (const a of root.getAnimations({ subtree: true })) a.playbackRate = 1 / STRETCH;

	const timers = [];
	const at = (ms, fn) => timers.push(setTimeout(fn, ms));
	let finished = false;
	let sound = null;
	const finish = () => {
		if (finished) return;
		finished = true;
		sound?.close();
		root.classList.add('out');
		setTimeout(() => root.remove(), reduce() ? 200 : HANDOVER);
		removeEventListener('keydown', finish, true);
		removeEventListener('pointerdown', finish, true);
	};

	if (reduce()) { at(400, finish); }
	else {
		at(1050 * STRETCH, () => recordCount().then(n => {
			countUp(root.querySelector('.b-records'), n, 600 * STRETCH);
			fillStream(root.querySelector('.b-stream > div'));
		}));
		const banks = root.querySelector('.b-banks');
		for (let i = 1; i <= 6; i++) at((300 + i * 100) * STRETCH, () => { banks.textContent = `${String(i).padStart(2, '0')}/06`; });
		let calm = 0, last = performance.now();
		const watch = now => {
			calm = now - last > FRAME_GAP ? 0 : calm + now - last;
			last = now;
			if (!finished) requestAnimationFrame(watch);
		};
		requestAnimationFrame(watch);
		const hold = () => {
			alignTopBar(root);
			alignFrame(root);
			if (calm >= SETTLED && shellReady()) finish();
			else at(100, hold);
		};
		at(TOTAL - 380, hold);
	}
	// Skipping is always possible; capture so the click doesn't also hit the UI below.
	addEventListener('keydown', finish, true);
	addEventListener('pointerdown', finish, true);
	at(HOLD_MAX, finish); // hard ceiling: never block input longer than this
	// Sound starts with the animation's first frame and runs on the audio clock from there:
	// Steam keeps this thread busy while it loads, so timers here can fire seconds late.
	const sounds = getComputedStyle(document.documentElement).getPropertyValue('--lc-ui-sounds').trim() === '1';
	if (sounds) {
		requestAnimationFrame(() => {
			if (finished) return;
			if (reduce()) { jingle(); return; }
			try {
				const ctx = new AudioContext();
				ctx.resume?.();
				sound = playBootSound(ctx, STRETCH);
			} catch (e) { console.warn('[lcarsv2] boot sound:', e); }
			jingle(performance.now() + NOMINAL);
		});
	}

	window[KEY] = {
		stop() {
			for (const t of timers) clearTimeout(t);
			finish();
			root.remove();
			delete window[KEY];
		},
	};
}
