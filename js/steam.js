// LCARSv2 main-window runtime.
// Builds the console frame (top elbow, command bank, bottom elbow), moves the
// SuperNav destinations into the bank, and keeps the top rail's title
// interruption and the bank's date/time readout current. Paint lives in CSS.

import { beep, clockParts, currentPath, host, navigate, rowHeight, uiScale } from './data.js';
import { installOps, opsMode, setOpsMode } from './ops.js';
import { installReadout } from './readout.js';
import { syncFlyouts } from './flyouts.js';

const SEL = {
	outer: '._3mz8wQ6Q44B8P7pzPP4Iyw',
	superNav: '._2D64jIEK7wpUR_NlObDW76',
	rootMenus: '._1Ky59qmywxOUtNcI1cgmkX',
	navItem: '._7AlhCx3XGzBeIrQaCneUD',
	navSelected: '._1gqEjB5QsKT_NftD1dEsdZ',
	dragArea: '._30vB9DdsPK7VrZAbb5Q1Av',
};

const KEY = '__lcarsV2ShellV1';

function el(tag, cls, html = '') {
	const e = document.createElement(tag);
	e.className = cls;
	e.innerHTML = html;
	return e;
}

function install() {
	if (window[KEY]) { window[KEY].sync(); return; }
	if (document.title !== 'Steam') return;

	let parts = null;
	const build = outer => {
		const elbowTop = el('div', 'lc-elbow lc-elbow-top', '<span>LCARS</span>');
		const bank = el('div', 'lc-bank');
		const nav = el('div', 'lc-bank-nav');
		const sys = el('div', 'lc-bank-sys');
		const fill = el('div', 'lc-bank-fill', '<b class="lc-date"></b><b class="lc-time"></b>');
		const elbowBottom = el('div', 'lc-elbow lc-elbow-bottom', '<span>Library computer</span>');
		// The computer's own name (user ask), from Steam's system info; the generic label until it answers.
		host().SteamClient?.System?.GetSystemInfo?.().then(i => { if (i?.sHostname) elbowBottom.firstChild.textContent = i.sHostname; }).catch(() => {});
		const title = el('div', 'lc-title');
		// Library view switch: two joined segments, the current one gold.
		const toggle = el('div', 'lc-rail-toggle', '<button data-mode="ops">Ops</button><button data-mode="shelves">Shelves</button>');
		toggle.addEventListener('click', e => {
			const b = e.target.closest('[data-mode]');
			if (!b || b.dataset.mode === opsMode()) return;
			beep('nav');
			setOpsMode(b.dataset.mode);
			navigate('/library/home'); // a swap from a game record lands on that view's home
		});
		bank.append(nav, sys, fill);
		outer.append(elbowTop, bank, elbowBottom);
		// Power-up: bank segments sweep in once per UI load.
		document.documentElement.classList.add('lc-boot');
		setTimeout(() => document.documentElement.classList.remove('lc-boot'), 1600);
		bank.addEventListener('click', e => { if (e.target.closest('._7AlhCx3XGzBeIrQaCneUD, ._2UyOBeiSdBayaFdRa39N2O, ._25lBLzuVeYAUG279up4xP8')) beep('nav'); });
		return { elbowTop, bank, nav, sys, fill, elbowBottom, title, toggle };
	};

	const tick = () => {
		if (!parts) return;
		const now = new Date();
		const c = clockParts(now);
		parts.fill.querySelector('.lc-date').textContent = c.date;
		parts.fill.querySelector('.lc-time').innerHTML = c.seconds ? `${c.time}<i>${c.seconds}</i>` : c.time;
	};

	const routeTitle = () => {
		const current = document.querySelector(`${SEL.navItem}${SEL.navSelected}`)?.textContent.trim() || 'Steam';
		if (!/library/i.test(current)) return current;
		const app = /^\/library\/app\/(\d+)/.exec(currentPath());
		if (app) {
			const name = host().appStore?.GetAppOverviewByAppID?.(Number(app[1]))?.display_name;
			return name ? `Library • ${name}` : 'Library';
		}
		if (currentPath() === '/library/home') {
			return opsMode() === 'ops' ? 'Library • Operations' : 'Library • Shelves';
		}
		return 'Library';
	};

	// The active department colours the frame (css/bank-motion.css). When it changes, a
	// light runs along the bank to the new block, then the colour wipes out along the
	// top rail and down the filler.
	let dept = -1;
	const syncDept = () => {
		const segs = [...document.querySelectorAll('.lc-bank ._7AlhCx3XGzBeIrQaCneUD')];
		const at = segs.findIndex(s => s.classList.contains('_1gqEjB5QsKT_NftD1dEsdZ'));
		if (at < 0 || at === dept) return;
		document.documentElement.dataset.dept = at + 1;
		if (dept >= 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
			const dir = at > dept ? 1 : -1, steps = Math.abs(at - dept);
			for (let k = 1; k <= steps; k++) {
				segs[dept + dir * k].animate([{ filter: 'brightness(1.6)' }, { filter: 'none' }], { duration: 170, delay: (k - 1) * 55, easing: 'steps(3, end)' });
			}
			document.querySelector('._30vB9DdsPK7VrZAbb5Q1Av')?.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0)' }], { duration: 300, easing: 'steps(12, end)' });
			parts.fill.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0)' }], { duration: 300, easing: 'steps(10, end)' });
		}
		dept = at;
	};

	let queued = false;
	const sync = () => {
		queued = false;
		const outer = document.querySelector(SEL.outer);
		if (!outer) return;
		document.documentElement.classList.add('lc-shell');
		// Created with TransparentParentWindow by the Change Window Params plugin
		// (it records the flags per window name; Steam drops them from our URL)?
		// Then window-corners.css lets the desktop show outside the console outline.
		const flags = host().__cwpCreateFlags?.[window.name] || 0;
		document.documentElement.classList.toggle('lc-transparent', !!(flags & (1 << 22)));
		if (!parts || !parts.bank.isConnected) { parts = build(outer); tick(); }

		// SuperNav (back/forward + destinations) becomes the command bank.
		const nav = document.querySelector(SEL.superNav);
		if (nav && nav.parentElement !== parts.nav) parts.nav.appendChild(nav);
		syncDept();

		// The less-used root menus (Steam, View, Friends, Games, Help) become
		// a second, smaller bank group under the destinations. Their popups
		// open from wherever the button sits, so they follow it here.
		const roots = document.querySelector(SEL.rootMenus);
		if (roots && roots.parentElement !== parts.sys) parts.sys.appendChild(roots);

		// Their menus fly out to the right of the bank instead of dropping down.
		syncFlyouts();

		// Millennium's plugin sidebar (Collections CSV, Change Window Params, ...)
		// has no opener left in the frame, so it gets its own SYSTEM segment.
		if (!parts.plugins) {
			parts.plugins = el('div', 'lc-ext lc-plugins', '<span class="lc-ext-name">Millennium</span>');
			parts.plugins.setAttribute('role', 'button');
			parts.plugins.tabIndex = 0;
			parts.plugins.title = 'Millennium';
			// A real Steam menu window, like the rest of the bank: it has to clear the store's web view.
			let menu = null;
			const open = () => {
				if (menu?.m_bVisible) return;
				const api = host().MILLENNIUM_API, h = host().SP_REACT.createElement;
				beep('nav');
				menu = api.showContextMenu(h(api.Menu, { label: 'Millennium' },
					h(api.MenuItem, { onClick: () => navigate('/millennium/settings') }, 'Millennium settings'),
					h(api.MenuItem, { onClick: () => api.openQuickAccess() }, 'Millennium sidebar')),
				parts.plugins, { bForcePopup: true, bOverlapHorizontal: false, bOverlapVertical: true });
			};
			let dwell = 0;
			parts.plugins.addEventListener('mouseenter', () => { dwell = setTimeout(open, 140); }); // the bank's hover intent
			parts.plugins.addEventListener('mouseleave', () => clearTimeout(dwell));
			parts.plugins.addEventListener('click', () => { clearTimeout(dwell); open(); });
			parts.plugins.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
		}
		if (parts.plugins.parentElement !== parts.sys) parts.sys.appendChild(parts.plugins);

		// Title interruption lives inside the drag area so dragging still works.
		const drag = document.querySelector(SEL.dragArea);
		if (drag && parts.title.parentElement !== drag) drag.appendChild(parts.title);
		const text = routeTitle();
		if (parts.title.textContent !== text) {
			// "Library • Deadlock": the department part is its own span, dropped when the rail is short (css/frame.css).
			const [dept, view] = text.split(' • ');
			parts.title.replaceChildren(...(view ? [Object.assign(el('span', 'lc-title-dept'), { textContent: `${dept} • ` }), view] : [text]));
			parts.title.classList.remove('lc-sweep');
			void parts.title.offsetWidth;
			parts.title.classList.add('lc-sweep');
		}

		// The view switch rides in the rail beside the title on library pages.
		const library = /^\/library\/(home|app\/)/.test(currentPath());
		if (drag && library && parts.toggle.parentElement !== drag) drag.appendChild(parts.toggle);
		if (!library && parts.toggle.isConnected) parts.toggle.remove();
		for (const b of parts.toggle.children) b.classList.toggle('on', b.dataset.mode === opsMode());
	};

	const queue = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
	const observer = new MutationObserver(queue);
	observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
	const clock = setInterval(tick, 1000);
	// The window itself never scrolls; focusing something near an edge (the annotator's
	// note field) used to scroll it and cut the top bar off. The root can't be clipped.
	const pin = () => { if (scrollX || scrollY) scrollTo(0, 0); };
	addEventListener('scroll', pin);
	const scale = () => {
		document.documentElement.style.setProperty('--lc-ui-scale', uiScale().toFixed(3));
		document.documentElement.style.setProperty('--lc-row', `${rowHeight()}px`);
	};
	addEventListener('resize', scale);
	scale();
	// Millennium's panel opens under store/community pages: that is Millennium's own
	// behaviour (user), so it is left alone. Undo the wrapper an earlier version left on
	// MILLENNIUM_API (it lives in SharedJSContext, which outlives this window).
	const millApi = host().MILLENNIUM_API;
	if (millApi?.openQuickAccess?.__lcOrig) millApi.openQuickAccess = millApi.openQuickAccess.__lcOrig;
	window[KEY] = {
		sync,
		stop() { observer.disconnect(); clearInterval(clock); removeEventListener('scroll', pin); removeEventListener('resize', scale);  delete document.documentElement.dataset.dept; delete window[KEY]; },
	};
	sync();
	installOps();
	installReadout();
	loadModules();
}

// Feature modules owned by separate slices. Each exports an idempotent
// install(); one that is missing or throws never takes the shell down.
const MODULES = ['ops-columns', 'ops-filters', 'ops-motion', 'sidebar', 'urlbar', 'popups', 'bank-intent', 'achievements', 'boot'];

function loadModules() {
	for (const name of MODULES) {
		import(`./${name}.js`)
			.then(m => m.install?.())
			.catch(e => console.warn(`[lcarsv2] ${name}:`, e));
	}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
