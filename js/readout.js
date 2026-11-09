// LCARSv2 game readout: on a library game page, the overview panel is
// recomposed into a console readout. An injected panel carries the record
// title rail and big numeric data blocks (all from Steam's app data and the
// page's own achievement count); Steam's real in-page play bar is restyled
// by CSS into the vertical command bank beside it, so PLAY etc. stay the
// genuine Steam controls.

import { ago, bytes, countUp, currentPath, dateCode, host, record, year } from './data.js';

const KEY = '__lcarsV2ReadoutV1';
const PANEL = '._27RcNu8aXKBpYkHcNNrt-X'; // AppDetailsOverviewPanel container
const ACH = '._2muiKHUkOiTvX-6arqnQUC';   // play bar "3/20"
const CLOUD = '._2cRYms-zZc4misk9tj3bt8 ._2TYVGoD27ZMfjRirKQNLfk';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function appIdFromPath() {
	const m = /^\/library\/app\/(\d+)/.exec(currentPath());
	return m ? Number(m[1]) : 0;
}

function build(appid) {
	const app = host().appStore?.GetAppOverviewByAppID?.(appid);
	if (!app) return null;
	const r = record(app, 0);
	const el = document.createElement('section');
	el.className = 'lc-readout';
	el.dataset.appid = String(appid);
	el.innerHTML = `
		<div class="lc-ro-rail"><h2>${esc(r.name)}</h2><b>${appid}</b><span class="lc-ro-state t-${r.status.tone}">${r.status.text}</span></div>
		<div class="lc-ro-grid">
			<div class="ro hours"><dt>Hours logged</dt><dd data-n="${r.minutes / 60}">0</dd><small>${r.minutes.toLocaleString()} minutes</small></div>
			<div class="ro recent"><dt>Last 2 weeks</dt><dd data-n="${r.recent / 60}">0</dd><small>hours</small></div>
			<div class="ro last"><dt>Last session</dt><dd>${dateCode(r.last)}</dd><small>${ago(r.last)}</small></div>
			<div class="ro ach"><dt>Achievements</dt><dd class="ach-n">—</dd><small class="ach-p">&nbsp;</small><i class="ach-bar"><u></u></i></div>
			<div class="ro size"><dt>On disk</dt><dd>${r.installed ? bytes(r.size) : '—'}</dd><small class="cloud">&nbsp;</small></div>
			<div class="ro rating"><dt>User rating</dt><dd>${r.review ? r.review + '<em>%</em>' : '—'}</dd><small>Released ${year(r.released)}</small></div>
		</div>`;
	for (const dd of el.querySelectorAll('dd[data-n]')) countUp(dd, Number(dd.dataset.n), { decimals: 1, ms: 900 });
	return el;
}

// Achievement and cloud figures come from the page itself once it renders.
function fill(el) {
	const a = document.querySelector(ACH)?.textContent.trim();
	const m = a && /^(\d+)\s*\/\s*(\d+)$/.exec(a);
	if (m && el.dataset.ach !== a) {
		el.dataset.ach = a;
		const [n, total] = [Number(m[1]), Number(m[2])];
		const pct = total ? Math.round((n / total) * 100) : 0;
		el.querySelector('.ach-n').innerHTML = `${n}<em>/${total}</em>`;
		el.querySelector('.ach-p').textContent = `${pct}% complete`;
		el.querySelector('.ach-bar u').style.width = `${pct}%`;
		el.querySelector('.ach').classList.add('live');
	}
	const cloud = document.querySelector(CLOUD)?.textContent.trim();
	if (cloud) el.querySelector('.cloud').textContent = `Cloud: ${cloud}`;
}

export function installReadout() {
	if (window[KEY]) return window[KEY];
	let current = null;
	let queued = false;
	const sync = () => {
		queued = false;
		const appid = appIdFromPath();
		const panel = appid && document.querySelector(PANEL);
		document.documentElement.classList.toggle('lc-readout-on', !!panel);
		if (!panel) { current = null; return; }
		if (!current || current.dataset.appid !== String(appid) || !current.isConnected) {
			current?.remove();
			current = build(appid);
			if (!current) return;
		}
		if (current.parentElement !== panel) panel.insertBefore(current, panel.firstChild);
		fill(current);
	};
	const observer = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(sync); } });
	observer.observe(document.body, { childList: true, subtree: true, characterData: true });
	window[KEY] = { sync, stop() { observer.disconnect(); current?.remove(); delete window[KEY]; } };
	sync();
	return window[KEY];
}
