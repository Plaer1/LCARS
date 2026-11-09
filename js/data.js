// LCARSv2 data access: thin, defensive readers over Steam's own stores
// (they live on the SharedJSContext window, i.e. window.opener) plus the
// formatters the console uses. Everything shown is real library data.

export const host = () => window.opener || window;

// The window instance that owns this document. Index-based lookups break as
// soon as a game's overlay window joins the list, so ask by window.
export function mainHistory() {
	try {
		const ws = host().SteamUIStore.WindowStore;
		return (ws.GetWindowInstanceFromWindow?.(window) || ws.MainWindowInstance)?.m_history || null;
	} catch (_) { return null; }
}

// The register and the sidebar list scale with the window's width (user): full size from
// 1707 px wide, 80% at Steam's 1010 px minimum. steam.js publishes it as --lc-ui-scale
// and the row height as --lc-row; ops.js virtualises its rows by rowHeight().
export const uiScale = () => Math.min(1, Math.max(0.8, 0.8 + 0.2 * (innerWidth - 1010) / 697));
export const rowHeight = () => Math.round(30 * uiScale());

export const currentPath = () => mainHistory()?.location?.pathname || '';

export function navigate(path) {
	const h = mainHistory();
	if (h) h.push(path);
}

// Steam's per-client display status codes, as far as they matter here.
const STATUS = {
	1: 'Launching', 2: 'Uninstalling', 3: 'Installing', 4: 'Running', 5: 'Validating',
	6: 'Updating', 7: 'Downloading', 8: 'Syncing', 9: 'Ready to install', 11: 'Ready',
	18: 'Update paused', 19: 'Update queued', 20: 'Update required',
	22: 'Paused', 23: 'Queued', 24: 'Download required',
};

export function statusOf(app) {
	const pcd = app.per_client_data?.[0];
	if (!pcd?.installed) return { code: 0, text: 'Not installed', tone: 'off' };
	const code = pcd.display_status;
	const text = STATUS[code] || 'Installed';
	const tone = code === 11 ? 'ready' : code === 4 ? 'run' : [6, 7, 3, 20, 24].includes(code) ? 'busy' : 'ready';
	return { code, text, tone };
}

// Personal achievement progress, as far as Steam has cached it (missing = unknown).
export function achievements(appid) {
	try {
		const p = host().appAchievementProgressCache?.m_achievementProgress?.mapCache?.get(appid);
		return p && p.total ? { unlocked: p.unlocked, total: p.total, pct: p.percentage } : null;
	} catch (_) { return null; }
}

export function iconURL(app) {
	try { return host().appStore.GetIconURLForApp(app) || ''; } catch (_) { return ''; }
}

export const tagName = id => { try { return host().appStore.GetLocalizationForStoreTag(id) || ''; } catch (_) { return ''; } };

// Steam keeps supported languages as a bit per language, in a string.
function bitCount(bits) {
	let n = 0;
	try { for (let b = BigInt(bits || 0); b; b &= b - 1n) n++; } catch (_) { /* unreadable: no languages */ }
	return n;
}

export function record(app, index) {
	const status = statusOf(app);
	return {
		index,
		appid: app.appid,
		name: app.display_name || String(app.appid),
		sortAs: (app.sort_as || app.display_name || '').toLowerCase(),
		installed: status.code !== 0,
		status,
		minutes: app.minutes_playtime_forever || 0,
		recent: app.minutes_playtime_last_two_weeks || 0,
		last: app.rt_last_time_played || 0,
		size: Number(app.size_on_disk) || 0,
		review: app.review_percentage_without_bombs || 0,
		reviewScore: app.review_score_without_bombs || 0, // Steam's 1-9 label, 8 Very Positive
		metacritic: app.metacritic_score || 0,
		released: app.rt_original_release_date || app.rt_steam_release_date || 0,
		purchased: app.rt_purchased_time || 0,
		updated: app.rt_store_asset_mtime || 0,
		copies: app.number_of_copies || 0,
		type: app.app_type || 0, // 1 game, 2 software/tool, 1073741824 non-Steam shortcut
		controller: app.xbox_controller_support || 0,
		deck: (app.steam_hw_compat_category_packed || 0) & 0x3, // 0 unknown, 1 unsupported, 2 playable, 3 verified (verify in S03)
		steamOS: app.steam_os_compat_category || 0, // 0 unknown, 1 unsupported, 2 compatible
		ps4: app.ps4_controller_support > 0,
		ps5: app.ps5_controller_support > 0,
		owner: app.BIsOwnedByAnotherUser?.() ? app.owner_account_id : 0, // family member's account, 0 for your own
		languages: bitCount(app.bitfield_supported_languages),
		hidden: !!host().collectionStore?.BIsHidden?.(app.appid),
		tags: app.m_setStoreTags ? [...app.m_setStoreTags] : [],
		cats: app.m_setStoreCategories ? [...app.m_setStoreCategories] : [],
		descriptors: app.m_setContentDescriptors ? [...app.m_setContentDescriptors] : [],
		get ach() { return achievements(app.appid); },
		get iconURL() { return iconURL(app); },
		app,
	};
}

export function collections() {
	const cs = host().collectionStore;
	if (!cs) return [];
	const out = [];
	if (cs.allGamesCollection) out.push({ id: 'all', name: 'All games', apps: () => cs.allGamesCollection.allApps });
	for (const c of cs.userCollections || []) out.push({ id: c.id, name: c.displayName, apps: () => c.allApps });
	return out;
}

// In the order Steam tries them: the user's custom art (jpg, then png), then the stock capsule.
export function capsuleURLs(app) {
	const store = host().appStore;
	try { return [...store.GetCustomVerticalCapsuleURLs(app), store.GetVerticalCapsuleURLForApp(app)].filter(Boolean); } catch (_) { return []; }
}

// Steam's own library game menu (Play, Manage, Add to collection, Properties...),
// the one its game list opens on right-click. Webpack ids and export names change
// between Steam builds, so the modules are found once by what their code does.
let menuParts;
function findMenuParts() {
	const w = host();
	let req;
	w.webpackChunksteamui?.push([[Symbol('lc')], {}, r => { req = r; }]);
	if (!req) return null;
	const pick = (needle, test) => {
		const id = Object.keys(req.m).find(k => req.m[k].toString().includes(needle));
		return id && Object.values(req(id)).find(v => typeof v === 'function' && test(String(v)));
	};
	const show = pick('bRootContextMenu', s => s.includes('bRootContextMenu'));
	const Menu = pick('RegisterForAppData(this.props.overview.appid)', s => s.includes('navigator:'));
	const options = pick('RegisterForAppData(this.props.overview.appid)', s => s.includes('bFitToWindow'));
	return show && Menu && options ? { show, Menu, options } : null;
}

export function gameMenu(appid, e, anchor) {
	const w = host();
	const overview = w.appStore?.GetAppOverviewByAppID(appid);
	if (!overview) return false; // the menu throws (and takes the UI down) without one
	menuParts ??= findMenuParts();
	if (!menuParts || !w.SP_REACT) return false;
	e.preventDefault();
	const { show, Menu, options } = menuParts;
	const el = w.SP_REACT.createElement(Menu, {
		overview, client: 'mostavailable', bInGamepadUI: false, ownerWindow: window,
		launchSource: 600, // shortcut: Steam's own game-list value, hard-coded; look it up if Steam rejects it
	});
	show(el, { preventDefault() {}, stopPropagation() {}, currentTarget: anchor, clientX: e.clientX, clientY: e.clientY }, options());
	return true;
}

export const heroURL = appid => `/assets/${appid}/library_hero.jpg`;

/* ---------------------------------------------------------- formatting */

export const pad = (n, w) => String(n).padStart(w, '0');

export function dateCode(sec) {
	if (!sec) return '—';
	const d = new Date(sec * 1000);
	const doy = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000;
	return `${d.getFullYear()}.${pad(doy, 3)}`;
}

export function ago(sec) {
	if (!sec) return 'Never';
	// Calendar days, so 23:00 last night reads as yesterday, not today.
	const day = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
	const days = day(new Date()) - day(new Date(sec * 1000));
	if (days < 1) return 'Today';
	if (days === 1) return 'Yesterday';
	if (days < 60) return `${days} days ago`;
	const months = Math.round(days / 30.4);
	return months < 24 ? `${months} months ago` : `${Math.round(days / 365)} years ago`;
}

export const hours = min => (min / 60 >= 100 ? Math.round(min / 60) : (min / 60).toFixed(1));

export function bytes(b) {
	if (!b) return '—';
	const gb = b / 1073741824;
	return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`;
}

export const year = sec => (sec ? new Date(sec * 1000).getFullYear() : '—');

// Theme settings arrive as CSS variables (the "Stardate" / "Military time" conditions).
const flag = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() === '1';

// TNG-era convention: 1000 units per year counted from 2323, plus the elapsed
// fraction of the current year. Real dates before 2323 come out negative.
export function stardate(d = new Date()) {
	const y = d.getFullYear(), start = new Date(y, 0, 1), end = new Date(y + 1, 0, 1);
	return (1000 * (y - 2323) + 1000 * (d - start) / (end - start)).toFixed(1);
}

// The bank readout's two lines: { date, time, seconds }.
export function clockParts(now = new Date()) {
	const date = flag('--lc-stardate') ? stardate(now) : now.toLocaleDateString();
	if (!flag('--lc-military')) return { date, time: now.toLocaleTimeString([], { hour12: true, hour: 'numeric', minute: '2-digit' }), seconds: '' };
	return { date, time: `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}`, seconds: pad(now.getSeconds(), 2) };
}

// Count a number up into an element (once), for readouts.
export function countUp(el, to, { decimals = 0, ms = 650, suffix = '' } = {}) {
	if (!el) return;
	const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	const fmt = v => (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString()) + suffix;
	if (reduce || !Number.isFinite(to)) { el.textContent = Number.isFinite(to) ? fmt(to) : String(to); return; }
	const t0 = performance.now();
	const step = t => {
		const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
		el.textContent = fmt(to * e);
		if (p < 1 && el.isConnected) requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}

export const beep = kind => { try { window.__lcarsBeep?.(kind); } catch (_) {} };
