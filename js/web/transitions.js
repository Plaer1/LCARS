// LCARSv2 web page transitions (S16): the personnel-status-report frame, the
// transporter load-in, the exit sweep for links that cannot cross-document
// transition, and the store hooks (review graph reveal, queue readout, sale
// event names). Plain script: no import or export, so it runs the same whether
// Millennium loads it as a classic or a module script. Re-running it stops the
// previous instance first. Reads only the DOM: never Steam's store getters.
(() => {
	const KEY = '__lcarsV2WebTransitionsV1';
	window[KEY]?.stop();

	const root = document.documentElement;
	const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const VT = CSS.supports('view-transition-name: a') && 'onpageswap' in window;
	const STEAM_HOST = /(^|\.)(steampowered\.com|steamcommunity\.com)$/;
	const SEGMENTS = 12, LEAVE_MS = 320, FAILSAFE_MS = 1000, BEAM_MS = 1300;
	const TRANSPORTER = false; // switched off (user, 2026-11-04: it looks bad); code kept for now

	const cleanups = [];
	const on = (target, type, fn, opts) => {
		target.addEventListener(type, fn, opts);
		cleanups.push(() => target.removeEventListener(type, fn, opts));
	};
	let frame = null, readout = null, readoutPos = '', leaveTimers = [], queued = 0;
	const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
		for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); graphStart(en.target); }
	}, { threshold: 0.25 }) : null;

	const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
	const hash = s => { let h = 5381; for (const ch of s) h = (Math.imul(h, 33) ^ ch.charCodeAt(0)) >>> 0; return h; };

	// ---------------------------------------------------------------- frame

	// Title from document.title, shortened; ID is the app id, else a stable hash of the path.
	const frameText = () => {
		const app = /\/app\/(\d+)/.exec(location.pathname);
		let name = document.title.trim()
			.replace(/^Welcome to Steam$/i, 'Store front')
			.replace(/^Steam Community$/i, 'Community')
			.replace(/^Steam Community :: /i, '')
			.replace(/\s*(:: Steam Community|on Steam|\| Steam|- Steam)$/i, '')
			.trim();
		if (name.length > 26) name = name.slice(0, 25).trimEnd() + '…';
		return { name: name || 'Steam', id: app ? app[1] : String(hash(location.pathname) % 10000).padStart(4, '0') };
	};

	const buildFrame = () => {
		const f = document.createElement('div');
		f.id = 'lc-web-frame';
		f.setAttribute('aria-hidden', 'true');
		f.innerHTML = '<div class="lc-web-rail lc-web-top"><span class="lc-web-title"><span class="lc-web-name"></span><span class="lc-web-id"></span></span><i class="lc-web-channel"></i></div>'
			+ '<div class="lc-web-rail lc-web-bottom"></div><i class="lc-web-sweep"></i>';
		return f;
	};

	const paintFrame = () => {
		if (!frame) return;
		const { name, id } = frameText();
		setText(frame.querySelector('.lc-web-name'), name);
		setText(frame.querySelector('.lc-web-id'), id);
	};

	// ------------------------------------------------------------ load-in

	// Transporter (user, round 6): the page materialises out of a sparkle column
	// inside the frame instead of sliding in. CSS in web-motion.css; the overlay
	// and the class go after BEAM_MS, so content is never held back longer.
	const beam = () => {
		const b = document.createElement('div');
		b.id = 'lc-beam';
		b.setAttribute('aria-hidden', 'true');
		document.body.append(b);
		root.classList.add('lc-beaming');
		const t = setTimeout(() => { b.remove(); root.classList.remove('lc-beaming'); }, BEAM_MS);
		cleanups.push(() => { clearTimeout(t); b.remove(); root.classList.remove('lc-beaming'); });
	};

	// ----------------------------------------------------------- exit sweep

	const clearLeave = () => {
		leaveTimers.forEach(clearTimeout);
		leaveTimers = [];
		root.classList.remove('lc-leaving');
	};

	const sameDocument = url => url.href.split('#')[0] === location.href.split('#')[0];

	on(document, 'click', e => {
		if (calm || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
		if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.closest('form')) return;
		let url;
		try { url = new URL(a.href); } catch { return; }
		if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !STEAM_HOST.test(url.hostname) || sameDocument(url)) return;
		if (VT && url.origin === location.origin) return; // the browser transitions this one
		e.preventDefault();
		clearLeave();
		root.classList.add('lc-leaving');
		leaveTimers = [
			setTimeout(() => { location.href = url.href; }, LEAVE_MS),
			setTimeout(clearLeave, FAILSAFE_MS),
		];
	});

	// ------------------------------------------------- review graph (S25)
	// Each graph replays its reveal once, on first entry into view. Per-load jitter
	// follows the bar-fill rule: duration x0.85-1.15, delay 0-120 ms, same for both panels.
	// CSS reads --lc-graph-dur and --lc-graph-delay on each panel (see store-reviews-graph.css).

	const jitter = { dur: 0.85 + Math.random() * 0.3, delay: Math.random() * 120 };

	function graphStart(g) {
		g.classList.add('lc-graph-go');
		for (const p of g.querySelectorAll(':scope > ._1FOq8Z-HYOo-')) {
			const last = p.classList.contains('Cbt2Mrm2GWw-');
			p.style.setProperty('--lc-graph-dur', Math.round((last ? 430 : 520) * jitter.dur) + 'ms');
			p.style.setProperty('--lc-graph-delay', Math.round((last ? 90 : 0) + jitter.delay) + 'ms');
		}
	}

	const scanGraphs = () => {
		if (!io || calm) return;
		for (const g of document.querySelectorAll('.EpJ2bqGTew8-:not([data-lc-graph])')) {
			g.dataset.lcGraph = '1';
			io.observe(g);
		}
	};

	// --------------------------------------------------- queue readout (S11)
	// "Next in Queue (N REMAINING)": position is 12 - N, shown as 07 / 12 with a
	// 12-segment strip. Rebuilt only when the position changes.

	const queueReadout = () => {
		const ctn = document.querySelector('body.app #queueCtn.in_queue');
		const m = ctn && /\((\d+)\s+REMAINING\)/i.exec(ctn.textContent || '');
		if (!m) {
			readout?.remove();
			readout = null;
			readoutPos = '';
			return;
		}
		const pos = SEGMENTS - Math.min(SEGMENTS, Number(m[1]));
		if (!readout) {
			readout = document.createElement('div');
			readout.className = 'lc-queue-readout';
			readout.setAttribute('aria-hidden', 'true');
		}
		if (readoutPos !== String(pos)) {
			readoutPos = String(pos);
			const segs = Array.from({ length: SEGMENTS }, (_, i) => `<i class="lc-queue-seg${i < pos ? ' lc-done' : ''}"></i>`).join('');
			readout.innerHTML = `<b>${String(pos).padStart(2, '0')} / ${SEGMENTS}</b><span class="lc-queue-strip">${segs}</span>`;
		}
		if (!readout.isConnected) (ctn.querySelector('#queueActionsCtn') || ctn).after(readout);
	};

	// ------------------------------------------------------ sale event (S13)
	// The sale hero carries its event name in data-lc-event; store-sale.css shows it on the rail.

	const saleEvent = () => {
		if (!document.body.classList.contains('sale_page_background')) return;
		const hero = document.querySelector('.SaleBackground > .Pb0e9y8A1NQ-[style*="url("], .SaleBackground > .fNzGZCCbi6w-');
		if (!hero) return;
		const name = document.title.replace(/^Steam\s+/i, '').replace(/\s*(on Steam|\| Steam|- Steam)$/i, '').trim().slice(0, 40)
			|| [...hero.querySelectorAll('img[alt]')].map(i => i.alt.trim()).find(Boolean) || '';
		if (name && hero.dataset.lcEvent !== name) hero.dataset.lcEvent = name;
	};

	// -------------------------------------------------------------- wiring

	// Community hub art (user note 32): Steam's background picture, run through an edge
	// filter (greyscale, a 3x3 edge kernel, then tinted to the palette) so it reads as LCARS
	// line art behind the page, like ATOMS' greyscaler but outlines. css/community.css draws
	// it from --lc-edge-src; the filter is SVG because CSS can't detect edges, and needs no
	// canvas (no cross-origin reads). Its region is the layer's own box, with edges
	// duplicated, so the layer's border doesn't read as an edge (a thin frame line).
	let edgeDefs = null;
	const edgeArt = () => {
		const el = document.querySelector('.apphub_background[style*="background-image"]');
		const src = el?.style.backgroundImage;
		if (!src || src === 'none' || el.style.getPropertyValue('--lc-edge-src') === src) return;
		el.style.setProperty('--lc-edge-src', src);
		if (edgeDefs?.isConnected) return;
		edgeDefs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		edgeDefs.setAttribute('aria-hidden', 'true');
		edgeDefs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
		edgeDefs.innerHTML = `<filter id="lc-edges" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
			<feColorMatrix type="saturate" values="0"/>
			<feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" edgeMode="duplicate" preserveAlpha="true"/>
			<feComponentTransfer><feFuncR type="linear" slope="9"/><feFuncG type="linear" slope="9"/><feFuncB type="linear" slope="9"/></feComponentTransfer>
			<feColorMatrix type="matrix" values="0.6 0 0 0 0  0.6 0 0 0 0  1 0 0 0 0  0 0 0 1 0"/>
		</filter>`;
		document.body.append(edgeDefs);
		cleanups.push(() => edgeDefs?.remove());
	};

	// Store front sections (user: "bare minimum"): each record group gets its own palette
	// colour in turn and a console code on its bracket foot (css/store.css), the way LCARS
	// screens number their panels. Codes come from the title, so a group keeps its code.
	const GROUP = ['--lc-peach', '--lc-lavender', '--lc-lilac', '--lc-coral', '--lc-steel', '--lc-gold'];
	const storeGroups = () => {
		if (location.host !== 'store.steampowered.com' || location.pathname !== '/') return;
		const groups = document.querySelectorAll('.home_pagecontent_ctn, #home_maincap_v7 > .home_cluster_ctn');
		groups.forEach((g, i) => {
			const title = (g.querySelector('.home_title_ctn, .title_grid, .tW10-at9cMc-, .WidgetHeaderCtn')?.textContent || '').trim().replace(/\s+/g, ' ');
			const code = `${String(i + 1).padStart(2, '0')}-${String(hash(title || String(i)) % 10000).padStart(4, '0')}`;
			if (g.dataset.lcCode === code) return;
			g.dataset.lcCode = code;
			g.style.setProperty('--lc-group', `var(${GROUP[i % GROUP.length]})`);
		});
	};

	const runHooks = () => {
		queued = 0;
		paintFrame();
		queueReadout();
		saleEvent();
		scanGraphs();
		edgeArt();
		storeGroups();
	};

	const schedule = () => { if (!queued) queued = requestAnimationFrame(runHooks); };

	// Page clicks, as sound names for the main window (js/sound.js), which plays them only if
	// the UI sounds setting is on. First match wins.
	const SFX = [
		['.home_tab_button, .apphub_sectionTab', 'tab'],
		['.arrow, [class*="carousel__back-button"], [class*="carousel__next-button"]', 'step'],
		['.carousel_thumbs > *, .carousel__dot', 'tick'],
		['.modalContentLink', 'open'],
		['#modalContentDismiss', 'close'],
		['.btnv6_white_transparent, .btnv6_blue_hoverfade, .btn_small_tall, .btn_medium, .btn_grey_grey', 'select'],
		['button, [role="button"], a', 'link'],
	];
	const sfx = event => {
		for (const [selector, kind] of SFX) {
			if (!event.target.closest?.(selector)) continue;
			window.SteamClient?.BrowserView?.PostMessageToParent?.('lcars-sfx', kind);
			return;
		}
	};

	const init = () => {
		if (window.self === window.top) on(window, 'click', sfx);
		if (!calm) root.classList.add('lc-anim');
		// A page in a modal's iframe already sits inside the modal's own frame.
		if (window.self === window.top) {
			root.classList.add('lc-framed');
			frame = buildFrame();
			document.body.prepend(frame);
		}
		if (!calm && TRANSPORTER) beam();
		// Tell the Steam window this page has its frame up (it holds a curtain over the
		// library until then; see webSlide in js/ops-motion.js).
		window.SteamClient?.BrowserView?.PostMessageToParent?.('lcars-page-ready', '');
		runHooks();

		const mo = new MutationObserver(schedule);
		mo.observe(document.body, { childList: true, subtree: true, characterData: true });
		mo.observe(document.head, { childList: true, subtree: true, characterData: true });
		cleanups.push(() => mo.disconnect());

		on(window, 'pageshow', clearLeave);
		if (VT) on(window, 'pageswap', e => { root.dataset.lcVt = e.viewTransition ? 'on' : 'off'; clearLeave(); });
	};

	const stop = () => {
		cleanups.splice(0).forEach(fn => fn());
		io?.disconnect();
		clearLeave();
		frame?.remove();
		frame = null;
		readout?.remove();
		readout = null;
		readoutPos = '';
		root.classList.remove('lc-framed', 'lc-anim', 'lc-leaving');
	};

	window[KEY] = { stop };
	if (document.readyState === 'loading') on(document, 'DOMContentLoaded', init, { once: true });
	else init();
})();
