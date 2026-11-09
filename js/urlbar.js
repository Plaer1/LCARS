// LCARSv2 URL bar rail (round 6, user: "what if the top blocking element was also
// the url bar"). Steam's own URL bar above web views is drawn as the page frame's
// top rail (css/frame.css), and this puts the page title and ID into it, the way
// the page's own rail used to (js/web/transitions.js frameText; same rules, so the
// names match). The page no longer draws a top rail of its own.

import { esc } from './ops.js';
import { host } from './data.js';

const KEY = '__lcarsV2UrlBarV1';
const BAR = '.UkR3sY319PuaUNuUWks2K';

const hash = s => { let h = 5381; for (const ch of s) h = (Math.imul(h, 33) ^ ch.charCodeAt(0)) >>> 0; return h; };

function frameText(title, url) {
	let u = null;
	try { u = new URL(url); } catch (_) { /* blank or loading: generic label */ }
	const app = /\/app\/(\d+)/.exec(u?.pathname || '');
	let name = String(title || '').trim()
		.replace(/^Welcome to Steam$/i, 'Store front')
		.replace(/^Steam Community$/i, 'Community')
		.replace(/^Steam Community :: /i, '')
		.replace(/\s*(:: Steam Community|on Steam|\| Steam|- Steam)$/i, '')
		.trim();
	if (!name) name = /steamcommunity/.test(u?.host || '') ? 'Community' : app ? 'Store' : 'Store front';
	if (name.length > 26) name = name.slice(0, 25).trimEnd() + '…';
	return { name, id: app ? app[1] : String(hash(u?.pathname || '/') % 10000).padStart(4, '0') };
}

export function install() {
	window[KEY]?.stop();
	let last = '', queued = 0;

	const sync = () => {
		const bar = document.querySelector(BAR);
		if (!bar) return;
		const mgr = host().MainWindowBrowserManager;
		// While a page loads, the title is still the last page's: name it from the requested URL.
		const loading = !!mgr?.m_bLoading;
		const { name, id } = frameText(loading ? '' : mgr?.m_strTitle, (loading && mgr?.m_URLRequested) || mgr?.m_URL);
		let t = bar.querySelector(':scope > .lc-url-title');
		if (!t) { t = document.createElement('span'); t.className = 'lc-url-title'; bar.prepend(t); last = ''; }
		const html = `${esc(name)}<i>${id}</i>`;
		if (html !== last) { t.innerHTML = html; last = html; }
	};

	// Titles change without touching this window's DOM, so poll lightly as well.
	const queue = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; sync(); }); };
	const observer = new MutationObserver(queue);
	observer.observe(document.body, { childList: true, subtree: true });
	const poll = setInterval(sync, 300);

	window[KEY] = {
		stop() {
			observer.disconnect();
			clearInterval(poll);
			cancelAnimationFrame(queued);
			document.querySelectorAll(`${BAR} > .lc-url-title`).forEach(n => n.remove());
			delete window[KEY];
		},
	};
	sync();
}
