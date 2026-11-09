// LCARSv2 Register tab editor and filter drawer (slice S04).
// TABS (a menu command) orders and labels the tab strip. FILTER opens a drawer
// under the tabs: groups combine AND across, OR within a group (tags: plain
// click AND, Ctrl/Cmd click OR). Everything registers through ops-api.js.
// Tab order and presets live in localStorage only; SAVE AS COLLECTION is the
// one path that writes a Steam collection, and only when the user confirms it.

import { beep, host, tagName } from './data.js';
import { esc } from './ops.js';
import { registry, prefs, on, DEFAULT_TABS } from './ops-api.js';

const KEY = '__lcarsV2FiltersV1';
const OPS = '__lcarsV2OpsV1';
const GB = 1073741824;
const NONSTEAM = 1073741824;
const GAP = 5; // gap between strip segments (.lc-ops-tabs)
const SEARCH_MIN = 180; // the search field keeps this much room before tabs give up space
const DYN = ['f:released', 'f:purchased', 'f:owner'];
const YEAR = 31536000; // seconds
const KIND = { system: 'System', collection: 'Collection', preset: 'Preset' };
const DYN_TAG_GROUP = 4; // Steam's filterGroups index for store tags (verified live)
const EMPTY = new Set();

const h = (tag, cls, html = '') => {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html) e.innerHTML = html;
	return e;
};
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// collectionStore's getters are MobX computeds: read before Steam's services
// finish initialising, they throw and cache the error, which then crashes
// Steam's own render. So nothing here touches the store until it is ready.
let storeReady = false;
const store = () => (storeReady ? host().collectionStore || null : null);
const apiNow = () => window[OPS]?.api || null;
const yearOf = sec => (sec ? new Date(sec * 1000).getFullYear() : 0);
const decadeOf = sec => (sec ? Math.floor(yearOf(sec) / 10) * 10 : 0);
const clamp = x => Math.max(0, Math.min(100, Math.round(Number(x)) || 0));
// How long a game has sat unplayed since it was bought, in years; null if played or undated.
const backlogYears = r => (r.minutes === 0 && r.purchased ? (Date.now() / 1000 - r.purchased) / YEAR : null);
const inBacklog = (min, max) => r => { const y = backlogYears(r); return y !== null && y >= min && y < max; };
// Steam's friend store only knows players it has loaded. Anyone else comes from Steam
// Community's mini profile (profile pages themselves refuse this window's origin), and
// is remembered so the name is there at once next time.
const ownerLookups = new Set();
function lookUpOwner(id) {
	if (ownerLookups.has(id)) return;
	ownerLookups.add(id);
	fetch(`https://steamcommunity.com/miniprofile/${id}/json`, { credentials: 'include' })
		.then(res => res.json())
		.then(({ persona_name: name }) => {
			if (!name) throw new Error('no name');
			prefs.set('ownernames', { ...prefs.get('ownernames', {}), [id]: name });
			refreshOwners();
		})
		.catch(() => ownerLookups.delete(id)); // tried again the next time the name is wanted
}

// Your own account id, from the SteamID of whoever is logged in.
const ownAccount = () => Number(BigInt(host().App.m_CurrentUser.strSteamID) - 76561197960265728n);

function ownerName(id) {
	let name = '';
	try {
		const friends = host().friendStore;
		// The public name, not any nickname you've given them.
		name = (friends.GetPlayer?.(id) || friends.m_FriendsUIFriendStore?.GetPlayer?.(id))?.persona?.m_strPlayerName || '';
	} catch (_) { /* store not ready: looked up below */ }
	if (name) return name;
	lookUpOwner(id);
	return prefs.get('ownernames', {})[id] || `Account ${id}`;
}

/* ------------------------------------------------------ membership sets */

// Built once per library load (ops.js replaces state.all then), never per row.
const memo = new Map();
function setFor(key, build) {
	const src = apiNow()?.state.all;
	if (!src) return EMPTY;
	const hit = memo.get(key);
	if (hit && hit.src === src) return hit.set;
	const set = build(src);
	memo.set(key, { src, set });
	return set;
}
const member = (key, build, r) => setFor(key, build).has(r.appid);
const appSet = c => new Set(c?.allApps ? [...c.allApps].map(a => a.appid) : []);

const SETS = {
	ready: () => appSet(store()?.readyToPlayActiveCollection),
	vr: () => appSet(store()?.vrAppsCollection),
	shared: () => {
		const s = store()?.sharedLibrariesCollections;
		return new Set((Array.isArray(s) ? s : [s]).filter(Boolean).flatMap(c => (c.allApps ? [...c.allApps].map(a => a.appid) : [])));
	},
	fav: src => new Set(src.filter(r => store()?.BIsFavorite?.(r.appid)).map(r => r.appid)),
	hidden: src => new Set(src.filter(r => store()?.BIsHidden?.(r.appid)).map(r => r.appid)),
};

/* ---------------------------------------------------------- tab sources */

// Built-in tabs (all, installed, recent, unplayed, missing) come from ops.js.
const SYS_TABS = [
	['sys:ready', 'Ready', r => member('sys:ready', SETS.ready, r)],
	['sys:fav', 'Favourites', r => member('sys:fav', SETS.fav, r)],
	['sys:hidden', 'Hidden', r => member('sys:hidden', SETS.hidden, r)],
	['sys:deck', 'Deck verified', r => r.deck === 3],
	['sys:nonsteam', 'Non-Steam', r => r.type === NONSTEAM],
	['sys:shared', 'Shared', r => member('sys:shared', SETS.shared, r)],
	['sys:vr', 'VR', r => member('sys:vr', SETS.vr, r)],
];

const bases = new Map(); // tab id -> label before any short-label override

function putTab(id, label, group, test) {
	registry.tabs.set(id, { label, group, test });
	bases.set(id, label);
}

function applyLabels() {
	const over = prefs.get('tablabels', {}) || {};
	for (const [id, t] of registry.tabs) {
		if (!bases.has(id)) bases.set(id, t.label);
		t.label = over[id] || bases.get(id);
	}
}

let collSig = '';
function syncCollections() {
	// Tabs are the Ops menu's own saved views (built-ins and SAVE AS TAB presets, note 77):
	// Steam's collections stay in the collection picker beside them.
	const cols = [];
	const sig = cols.map(c => c.id + '\u0001' + c.label).join('\u0002');
	if (sig === collSig) return false;
	collSig = sig;
	for (const id of [...registry.tabs.keys()]) {
		if (id.startsWith('uc:')) { registry.tabs.delete(id); bases.delete(id); }
	}
	applyLabels();
	return true;
}

const presetList = () => {
	const p = prefs.get('presets', []);
	return Array.isArray(p) ? p.filter(x => x && typeof x.name === 'string' && x.name) : [];
};

function presetPasses(p, r) {
	for (const [gid, vals] of Object.entries(p.filters || {})) {
		if (!vals?.length) continue;
		const f = registry.filters.get(gid);
		if (f && !f.test(r, vals)) return false;
	}
	return true;
}

function syncPresets() {
	for (const id of [...registry.tabs.keys()]) {
		if (id.startsWith('preset:')) { registry.tabs.delete(id); bases.delete(id); }
	}
	for (const p of presetList()) putTab('preset:' + p.name, p.name.toUpperCase(), 'preset', r => presetPasses(p, r));
	applyLabels();
}

// Saved tab order, unknown ids dropped. Mirrors visibleTabs() in ops-api.js.
function currentTabIds() {
	const saved = prefs.get('tabs', DEFAULT_TABS);
	const ids = (Array.isArray(saved) ? saved : DEFAULT_TABS).filter((id, i, a) => registry.tabs.has(id) && a.indexOf(id) === i);
	return ids.length ? ids : ['all'];
}

/* ------------------------------------------------------ filter groups */

// Tag values: 't<id>' must be on the app (AND); 'u<id>' is one of an any-of set (OR).
// The any-of set only narrows when at least one of its tags is picked.
function tagsPass(r, value) {
	let hasOr = false;
	let anyOr = false;
	for (const id of value) {
		const t = Number(id.slice(1));
		if (id[0] === 't') { if (!r.tags.includes(t)) return false; }
		else { hasOr = true; if (r.tags.includes(t)) anyOr = true; }
	}
	return !hasOr || anyOr;
}

// Plain click narrows (AND), Ctrl/Cmd click broadens (OR). A plain click on a
// picked tag clears it; Ctrl on a picked tag flips it between AND and OR.
function nextTags(cur, key, ctrl) {
	const a = 't' + key;
	const o = 'u' + key;
	if (cur.includes(a)) return ctrl ? cur.map(x => (x === a ? o : x)) : cur.filter(x => x !== a);
	if (cur.includes(o)) return ctrl ? cur.map(x => (x === o ? a : x)) : cur.filter(x => x !== o);
	return [...cur, ctrl ? o : a];
}

// kind: multi (default, OR within), tags (AND/OR), slider (review minimum), decade, year, owner.
const GROUPS = [
	{ id: 'f:play', label: 'Play state', chips: [
		['unplayed', 'Unplayed', r => r.minutes === 0],
		['played', 'Played', r => r.minutes > 0],
		['recent2w', 'Played in 2 weeks', r => r.recent > 0],
		['ach100', '100% achievements', r => { const a = r.ach; return !!a && a.total > 0 && a.unlocked >= a.total; }],
		['achnone', 'Achievements not started', r => { const a = r.ach; return !!a && a.total > 0 && a.unlocked === 0; }],
	] },
	{ id: 'f:backlog', label: 'Unplayed for', chips: [
		['y1', 'Under 1 year', inBacklog(0, 1)],
		['y5', '1–5 years', inBacklog(1, 5)],
		['y10', '5–10 years', inBacklog(5, 10)],
		['yold', 'Over 10 years', inBacklog(10, Infinity)],
	] },
	{ id: 'f:install', label: 'Install', chips: [
		['installed', 'Installed', r => r.installed],
		['notinst', 'Not installed', r => !r.installed],
		['update', 'Update pending', r => [18, 19, 20].includes(r.status.code)],
		['running', 'Running', r => r.status.code === 4],
	] },
	// ops.js keeps hidden games out of the list until this chip is on; it filters nothing itself.
	{ id: 'f:hidden', label: 'Hidden games', chips: [['show', 'Show hidden', () => true]] },
	{ id: 'f:tags', label: 'Tags', kind: 'tags', test: (r, value) => tagsPass(r, value) },
	// Steam's store category IDs, checked against known single and multiplayer games.
	{ id: 'f:players', label: 'Players', chips: [
		['single', 'Single-player', r => r.cats.includes(2)],
		['multi', 'Multiplayer', r => r.cats.includes(1)],
		['coop', 'Co-op', r => r.cats.includes(9)],
		['online', 'Online co-op', r => r.cats.includes(38)],
		['pvp', 'PvP', r => r.cats.includes(49)],
	] },
	{ id: 'f:owner', label: 'Owner', kind: 'owner' },
	{ id: 'f:steamos', label: 'SteamOS', chips: [
		['compatible', 'Compatible', r => r.steamOS === 2],
		['unsupported', 'Unsupported', r => r.steamOS === 1],
		['unknown', 'Unknown', r => r.steamOS === 0],
	] },
	{ id: 'f:deck', label: 'Steam Deck', chips: [
		['verified', 'Verified', r => r.deck === 3],
		['playable', 'Playable', r => r.deck === 2],
		['unsupported', 'Unsupported', r => r.deck === 1],
		['unknown', 'Unknown', r => r.deck === 0],
	] },
	// Controller codes read from the library: 2 is the most common, -1 the least.
	{ id: 'f:controller', label: 'Controller', chips: [
		['full', 'Full', r => r.controller === 2],
		['partial', 'Partial', r => r.controller === 1],
		['none', 'None', r => r.controller === 0],
		['unknown', 'Unknown', r => r.controller === -1],
	] },
	{ id: 'f:playstation', label: 'PlayStation', chips: [
		['ps5', 'PS5 controller', r => r.ps5],
		['ps4', 'PS4 controller', r => r.ps4],
	] },
	{ id: 'f:vr', label: 'VR', chips: [
		['vr', 'VR', r => member('sys:vr', SETS.vr, r)],
		['flat', 'Flat', r => !member('sys:vr', SETS.vr, r)],
	] },
	{ id: 'f:type', label: 'Type', chips: [
		['game', 'Game', r => r.type === 1],
		['software', 'Software', r => r.type === 2],
		['nonsteam', 'Non-Steam', r => r.type === NONSTEAM],
	] },
	// Slider: value is [percent]; no value means off.
	{ id: 'f:review', label: 'Review min', kind: 'slider', test: (r, value) => r.review >= Number(value[0]) },
	{ id: 'f:reviewlabel', label: 'Reviews', chips: [
		['s9', 'Overwhelmingly positive', r => r.reviewScore === 9],
		['s8', 'Very positive', r => r.reviewScore === 8],
		['s7', 'Positive', r => r.reviewScore === 7],
		['s6', 'Mostly positive', r => r.reviewScore === 6],
		['s5', 'Mixed', r => r.reviewScore === 5],
		['sneg', 'Negative', r => r.reviewScore >= 1 && r.reviewScore <= 4],
		['s0', 'No reviews', r => r.reviewScore === 0],
	] },
	{ id: 'f:metacritic', label: 'Metacritic', chips: [
		['m90', '90+', r => r.metacritic >= 90],
		['m75', '75–89', r => r.metacritic >= 75 && r.metacritic < 90],
		['m50', '50–74', r => r.metacritic >= 50 && r.metacritic < 75],
		['mlow', 'Under 50', r => r.metacritic > 0 && r.metacritic < 50],
		['m0', 'No score', r => !r.metacritic],
	] },
	{ id: 'f:languages', label: 'Languages', chips: [
		['l1', '1', r => r.languages === 1],
		['l5', '2–5', r => r.languages >= 2 && r.languages <= 5],
		['l10', '6–10', r => r.languages >= 6 && r.languages <= 10],
		['lmany', '11+', r => r.languages >= 11],
	] },
	// Steam's content descriptor IDs.
	{ id: 'f:mature', label: 'Mature content', chips: [
		['violence', 'Violence or gore', r => r.descriptors.includes(2)],
		['nudity', 'Some nudity', r => r.descriptors.includes(1)],
		['general', 'General mature', r => r.descriptors.includes(5)],
		['none', 'None listed', r => !r.descriptors.length],
	] },
	{ id: 'f:size', label: 'Size on disk', chips: [
		['lt1', 'Under 1 GB', r => r.size > 0 && r.size < GB],
		['b1', '1–10 GB', r => r.size >= GB && r.size < 10 * GB],
		['b10', '10–50 GB', r => r.size >= 10 * GB && r.size < 50 * GB],
		['gt50', 'Over 50 GB', r => r.size >= 50 * GB],
	] },
	{ id: 'f:released', label: 'Released', kind: 'decade' },
	{ id: 'f:purchased', label: 'Purchased', kind: 'year' },
];
const GROUP_BY = new Map(GROUPS.map(g => [g.id, g]));

// Chip predicates, cached: decades and years are parsed from the id.
const predCache = new Map();
function predOf(gid, id) {
	const key = gid + '|' + id;
	let fn = predCache.get(key);
	if (fn) return fn;
	const chip = GROUP_BY.get(gid)?.chips?.find(c => c[0] === id);
	if (chip) fn = chip[2];
	else if (gid === 'f:released') { const d = Number(id.slice(1)); fn = r => decadeOf(r.released) === d; }
	else if (gid === 'f:purchased') { const y = Number(id.slice(1)); fn = r => yearOf(r.purchased) === y; }
	else if (gid === 'f:owner') { const o = Number(id.slice(1)); fn = r => r.owner === o; }
	else fn = () => false;
	predCache.set(key, fn);
	return fn;
}

function labelOf(gid, id) {
	const chip = GROUP_BY.get(gid)?.chips?.find(c => c[0] === id);
	if (chip) return chip[1];
	if (gid === 'f:tags') return (id[0] === 'u' ? '+ ' : '') + (tagName(Number(id.slice(1))) || id);
	if (gid === 'f:released') return `${id.slice(1)}s`;
	if (gid === 'f:owner') return ownerName(Number(id.slice(1)) || ownAccount());
	if (gid === 'f:review') return `${id}%+`;
	return id.slice(1);
}

function registerGroups() {
	for (const g of GROUPS) {
		registry.filters.set(g.id, {
			label: g.label,
			group: g.id,
			test: g.test || ((r, value) => !value?.length || value.some(id => predOf(g.id, id)(r))),
		});
	}
}

// Decades, purchase years and family owners come from the library itself, once per load.
let dyn = { src: null, decades: [], years: [], owners: [] };
function dynamics(src) {
	if (dyn.src === src) return dyn;
	const dec = new Set();
	const yrs = new Set();
	const owners = new Map();
	for (const r of src) {
		owners.set(r.owner, (owners.get(r.owner) || 0) + 1);
		if (r.released) dec.add(decadeOf(r.released));
		if (r.purchased) yrs.add(yearOf(r.purchased));
	}
	dyn = {
		src,
		decades: [...dec].sort((a, b) => a - b),
		years: [...yrs].sort((a, b) => b - a),
		owners: [...owners].sort((a, b) => b[1] - a[1]).map(([id]) => id),
	};
	return dyn;
}

let tagCache = null;
// Library-wide tags, most used first, names localised by Steam.
function topTags() {
	if (tagCache) return tagCache;
	let list = [];
	try {
		const as = host().appStore;
		as?.RefreshTagsIfNeeded?.();
		list = (as?.GetTopStoreTags?.() || [])
			.slice()
			.sort((a, b) => b.nCount - a.nCount)
			.map(t => ({ id: t.nTagId, name: tagName(t.nTagId) }))
			.filter(t => t.name);
	} catch (_) { /* tags not ready yet: the picker stays empty */ }
	tagCache = list;
	return list;
}

/* ------------------------------------------------------- live state */

let mounted = null; // the ops api we are mounted on
let nav = null, ctrl = null, coll = null, slot = null;
let filterBtn = null, more = null, wrap = null, readout = null, readoutText = null;
let drawer = null, closeTimer = 0, filledSrc = null, tagQuery = '';
let shownChips = new Map(); // group id -> chip ids currently drawn
let counts = new Map(); // 'group|chip' -> records it would add; 'f:review|slider' for the slider
let sliderTimer = 0;
let editor = null, editorAnchor = null, drag = null, flyout = null, dialog = null;
let ro = null, mo = null, poll = 0;
let unsubs = [];

// Count each displayed chip against the collection, tab, search and every
// other active group (AND), leaving its own group out. One pass per refresh.
function recount(st) {
	counts = new Map();
	const tab = registry.tabs.get(st.tab) || registry.tabs.get('all');
	const q = st.query.trim().toLowerCase();
	const active = [...st.filters].filter(([id, v]) => v?.length && registry.filters.has(id));
	const pool = [];
	for (const r of st.all) {
		if (!tab?.test(r) || (q && !r.name.toLowerCase().includes(q))) continue;
		let fail = null;
		let n = 0;
		for (const [id, v] of active) {
			if (!registry.filters.get(id).test(r, v)) { fail = id; n++; }
		}
		if (n > 1) continue;
		pool.push({ r, fail });
	}
	const baseOf = gid => pool.filter(p => p.fail === null || p.fail === gid).map(p => p.r);
	for (const [gid, ids] of shownChips) {
		const base = baseOf(gid);
		if (gid === 'f:tags') {
			const cur = st.filters.get(gid) || [];
			for (const id of ids) {
				// A picked tag counts the current result; a candidate counts a plain AND add.
				const pick = cur.includes(id) ? cur : nextTags(cur, id.slice(1), false);
				let c = 0;
				for (const r of base) if (tagsPass(r, pick)) c++;
				counts.set(gid + '|' + id, c);
			}
			continue;
		}
		for (const id of ids) {
			const fn = predOf(gid, id);
			let c = 0;
			for (const r of base) if (fn(r)) c++;
			counts.set(gid + '|' + id, c);
		}
	}
	const v = Number(st.filters.get('f:review')?.[0] || 0);
	counts.set('f:review|slider', baseOf('f:review').filter(r => r.review >= v).length);
}

function updateChips(st) {
	if (!drawer) return;
	for (const b of drawer.querySelectorAll('[data-chip]')) {
		const gid = b.dataset.group;
		const id = b.dataset.chip;
		const g = GROUP_BY.get(gid);
		const cur = st.filters.get(gid) || [];
		const lit = cur.includes(id);
		const n = counts.get(gid + '|' + id);
		b.classList.toggle('on', lit);
		b.setAttribute('aria-pressed', String(lit));
		if (n !== undefined) b.querySelector('i').textContent = n.toLocaleString();
		b.disabled = !lit && n === 0;
	}
	updateSlider(st);
}

function chipList(g, st) {
	if (g.kind === 'tags') {
		const sel = st.filters.get(g.id) || [];
		const q = tagQuery.trim().toLowerCase();
		const picked = sel.map(id => ({ id, label: labelOf(g.id, id) }));
		const rest = topTags()
			.filter(t => !sel.includes('t' + t.id) && !sel.includes('u' + t.id) && (!q || t.name.toLowerCase().includes(q)))
			.slice(0, 40)
			.map(t => ({ id: 't' + t.id, label: t.name }));
		return [...picked, ...rest];
	}
	if (g.kind === 'decade') return dynamics(st.all).decades.map(d => ({ id: 'd' + d, label: `${d}s` }));
	if (g.kind === 'year') return dynamics(st.all).years.map(y => ({ id: 'y' + y, label: String(y) }));
	if (g.kind === 'owner') return dynamics(st.all).owners.map(o => ({ id: 'o' + o, label: labelOf(g.id, 'o' + o) }));
	return g.chips.map(([id, label]) => ({ id, label }));
}

const chipHTML = (gid, c) => {
	const mode = gid === 'f:tags' ? (c.id[0] === 'u' ? ' or' : ' and') : '';
	return `<button type="button" class="lc-fx-chip${mode}" data-group="${esc(gid)}" data-chip="${esc(c.id)}" aria-pressed="false"><span>${esc(c.label)}</span><i></i></button>`;
};

// A looked-up name arrived: redraw whatever shows owner names.
function refreshOwners() {
	const st = mounted?.state;
	if (!st) return;
	if (drawer) { fillGroups(['f:owner']); recount(st); updateChips(st); }
	renderReadout(st);
}

function fillGroups(ids) {
	const st = mounted?.state;
	if (!st || !drawer) return;
	for (const gid of ids) {
		const g = GROUP_BY.get(gid);
		const box = drawer.querySelector(`[data-chips="${gid}"]`);
		if (!g || !box) continue;
		const list = chipList(g, st);
		shownChips.set(gid, list.map(c => c.id));
		box.innerHTML = list.map(c => chipHTML(gid, c)).join('');
	}
}

function activeLabels(st) {
	const labels = [];
	for (const g of GROUPS) for (const id of st.filters.get(g.id) || []) labels.push(labelOf(g.id, id));
	return labels;
}

function renderReadout(st) {
	if (!readout) return;
	const labels = activeLabels(st);
	readout.hidden = !labels.length;
	if (labels.length) readoutText.textContent = `${labels.join(' · ')} · ${st.view.length.toLocaleString()} RECORDS`;
}

// The slot under the tabs holds the readout and the drawer; empty, it hides.
function syncSlot() {
	if (!slot || !wrap) return;
	const need = !!drawer || !readout.hidden;
	if (need) { if (wrap.parentElement !== slot) slot.append(wrap); }
	else wrap.remove();
}

/* ---------------------------------------------------------- drawer */

function groupHTML(g) {
	if (g.kind === 'slider') {
		return `<section class="lc-fx-group" data-group="${esc(g.id)}" data-kind="slider">
			<h3>${esc(g.label)}</h3>
			<div class="lc-fx-cell"><div class="lc-fx-slide">
				<div class="lc-fx-track">
					<input type="range" class="lc-fx-range" min="0" max="100" step="1" value="0" aria-label="Review minimum, percent">
					<div class="lc-fx-ticks">${[70, 80, 90].map(t => `<button type="button" data-tick="${t}" style="left:${t}%">${t}</button>`).join('')}</div>
				</div>
				<div class="lc-fx-numwrap"><input type="number" class="lc-fx-num" min="0" max="100" step="1" value="0" aria-label="Review minimum"><span class="lc-fx-pct">%</span></div>
				<span class="lc-fx-slidecount"></span>
			</div></div>
		</section>`;
	}
	const cell = g.kind === 'tags' ? '<input type="text" class="lc-fx-tagq" placeholder="Type a tag" spellcheck="false" aria-label="Search tags">' : '';
	const more = g.kind === 'tags' ? '<button type="button" class="lc-fx-tagmore" aria-expanded="false">More tags</button>' : '';
	return `<section class="lc-fx-group" data-group="${esc(g.id)}">
		<h3>${esc(g.label)}</h3>
		<div class="lc-fx-cell">${cell}<div class="lc-fx-chips" data-chips="${esc(g.id)}"></div>${more}</div>
	</section>`;
}

function buildDrawer() {
	const d = h('div', 'lc-fx-drawer');
	d.innerHTML = `
		<div class="lc-fx-body">${GROUPS.map(groupHTML).join('')}</div>
		<footer class="lc-fx-foot">
			<label class="lc-fx-name"><span>Preset</span><input type="text" maxlength="24" placeholder="Name" spellcheck="false"></label>
			<button type="button" class="lc-fx-save">Save as tab</button>
			<button type="button" class="lc-fx-coll">Save as collection</button>
			<button type="button" class="lc-fx-close">Close</button>
		</footer>
		<div class="lc-fx-rail"></div>`;
	d.addEventListener('click', onDrawerClick);
	d.addEventListener('input', onDrawerInput);
	d.addEventListener('change', onDrawerChange);
	d.addEventListener('keydown', onDrawerKey);
	return d;
}

function toggleDrawer() {
	if (drawer && !drawer.classList.contains('closing')) closeDrawer();
	else openDrawer();
}

function openDrawer() {
	const st = mounted?.state;
	if (!st) return;
	if (drawer) { clearTimeout(closeTimer); drawer.remove(); drawer = null; }
	tagCache = null;
	tagQuery = '';
	drawer = buildDrawer();
	wrap.append(drawer);
	fillGroups(GROUPS.map(g => g.id));
	filledSrc = st.all;
	recount(st);
	updateChips(st);
	syncSlot();
	// Measure the natural height first, then let the keyframes take it there.
	drawer.style.setProperty('--fx-h', `${Math.min(drawer.scrollHeight, window.innerHeight * 0.52)}px`);
	drawer.classList.add('opening');
	filterBtn.setAttribute('aria-expanded', 'true');
	beep('nav');
}

function closeDrawer() {
	if (!drawer || drawer.classList.contains('closing')) return;
	const d = drawer;
	d.classList.remove('opening');
	d.classList.add('closing');
	filterBtn?.setAttribute('aria-expanded', 'false');
	clearTimeout(closeTimer);
	closeTimer = setTimeout(() => {
		d.remove();
		if (drawer === d) drawer = null;
		syncSlot();
	}, reduced() ? 0 : 320); // matches .lc-fx-drawer.closing in ops-filters.css
}

function toggleChip(gid, id) {
	const api = mounted;
	if (!api) return;
	const cur = api.state.filters.get(gid) || [];
	const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
	beep('select');
	api.setFilter(gid, next.length ? next : null);
}

function toggleTag(id, ctrl) {
	const api = mounted;
	if (!api) return;
	const cur = api.state.filters.get('f:tags') || [];
	const next = nextTags(cur, id.slice(1), ctrl);
	beep('select');
	api.setFilter('f:tags', next.length ? next : null);
}

function clearFilters() {
	const api = mounted;
	if (!api) return;
	for (const id of [...api.state.filters.keys()]) api.setFilter(id, null);
}

function saveAsTab() {
	const api = mounted;
	if (!api || !drawer) return;
	const filters = {};
	for (const [gid, v] of api.state.filters) if (v?.length) filters[gid] = [...v];
	if (!Object.keys(filters).length) return;
	const input = drawer.querySelector('.lc-fx-name input');
	const list = presetList();
	const name = input.value.trim().slice(0, 24) || `Preset ${list.length + 1}`;
	prefs.set('presets', [...list.filter(p => p.name !== name), { name, filters }]);
	syncPresets();
	const id = 'preset:' + name;
	prefs.set('tabs', [...currentTabIds().filter(x => x !== id), id]);
	input.value = '';
	clearFilters();
	nav?.querySelector(`[data-tab="${CSS.escape(id)}"]`)?.click();
}

/* ------------------------------------------------------ review slider */

// Range and number field both feed one value; each side is read by name.
function sliderValue(from) {
	const el = drawer?.querySelector(from === 'range' ? '.lc-fx-range' : '.lc-fx-num');
	return el && el.value !== '' ? clamp(el.value) : null;
}

// Set both controls and the lavender fill (--v) from one value; `from` skips the source.
function setSlider(v, from) {
	const range = drawer?.querySelector('.lc-fx-range');
	const num = drawer?.querySelector('.lc-fx-num');
	if (!range || !num) return;
	if (from !== 'range') range.value = v;
	if (from !== 'num') num.value = v;
	range.style.setProperty('--v', `${v}%`);
}

// Live drags only schedule the filter; the sort runs once the pointer rests.
function scheduleSlider(v) {
	clearTimeout(sliderTimer);
	sliderTimer = setTimeout(() => applySlider(v), 150);
}

function applySlider(v) {
	clearTimeout(sliderTimer);
	const api = mounted;
	if (!api) return;
	const cur = Number(api.state.filters.get('f:review')?.[0] || 0);
	if (v === cur) return;
	api.setFilter('f:review', v > 0 ? [String(v)] : null);
}

// Keep the slider in step with the stored filter, but never fight the control being used.
function updateSlider(st) {
	const range = drawer?.querySelector('.lc-fx-range');
	if (!range) return;
	const num = drawer.querySelector('.lc-fx-num');
	const busy = document.activeElement === range || document.activeElement === num;
	if (!busy) setSlider(Number(st.filters.get('f:review')?.[0] || 0));
	const n = counts.get('f:review|slider');
	drawer.querySelector('.lc-fx-slidecount').textContent = n === undefined ? '' : n.toLocaleString();
}

/* ------------------------------------------------------ drawer events */

function onDrawerClick(e) {
	const tick = e.target.closest('[data-tick]');
	if (tick) { const v = Number(tick.dataset.tick); setSlider(v); applySlider(v); return; }
	const chip = e.target.closest('[data-chip]');
	if (chip) {
		if (chip.dataset.group === 'f:tags') toggleTag(chip.dataset.chip, e.ctrlKey || e.metaKey);
		else toggleChip(chip.dataset.group, chip.dataset.chip);
		return;
	}
	const moreTags = e.target.closest('.lc-fx-tagmore');
	if (moreTags) {
		const open = moreTags.getAttribute('aria-expanded') !== 'true';
		moreTags.setAttribute('aria-expanded', String(open));
		moreTags.textContent = open ? 'Fewer tags' : 'More tags';
		return;
	}
	if (e.target.closest('.lc-fx-save')) { saveAsTab(); return; }
	if (e.target.closest('.lc-fx-coll')) { openCollectionDialog(); return; }
	if (e.target.closest('.lc-fx-close')) closeDrawer();
}

function onDrawerInput(e) {
	const t = e.target;
	if (t.classList.contains('lc-fx-range') || t.classList.contains('lc-fx-num')) {
		const from = t.classList.contains('lc-fx-range') ? 'range' : 'num';
		const v = sliderValue(from);
		if (v == null) return;
		setSlider(v, from);
		scheduleSlider(v);
		return;
	}
	if (!t.classList.contains('lc-fx-tagq')) return;
	tagQuery = t.value;
	const st = mounted?.state;
	if (!st) return;
	fillGroups(['f:tags']);
	recount(st);
	updateChips(st);
}

function onDrawerChange(e) {
	const t = e.target;
	const from = t.classList.contains('lc-fx-range') ? 'range' : t.classList.contains('lc-fx-num') ? 'num' : null;
	if (!from) return;
	const v = sliderValue(from);
	if (v == null) return;
	setSlider(v);
	applySlider(v);
}

function onDrawerKey(e) {
	if (e.key === 'Escape') {
		e.stopPropagation();
		closeDrawer();
		filterBtn?.focus();
		return;
	}
	// Steam's range input steps 1 on arrows; PageUp/PageDown step 10 here.
	if ((e.key === 'PageUp' || e.key === 'PageDown') && e.target.classList.contains('lc-fx-range')) {
		e.preventDefault();
		const t = e.target;
		t.value = clamp(Number(t.value) + (e.key === 'PageUp' ? 10 : -10));
		t.dispatchEvent(new Event('input', { bubbles: true }));
		t.dispatchEvent(new Event('change', { bubbles: true }));
		return;
	}
	if (e.key !== 'Enter') return;
	// Enter takes AND, Ctrl/Cmd+Enter takes OR, on a focused tag chip or the tag search.
	if (e.target.matches('[data-group="f:tags"][data-chip]')) {
		e.preventDefault();
		toggleTag(e.target.dataset.chip, e.ctrlKey || e.metaKey);
	} else if (e.target.classList.contains('lc-fx-tagq')) {
		e.preventDefault();
		const first = drawer.querySelector('[data-group="f:tags"][data-chip]:not(.on):not(:disabled)');
		if (first) toggleTag(first.dataset.chip, e.ctrlKey || e.metaKey);
	} else if (e.target.closest('.lc-fx-name')) {
		e.preventDefault();
		saveAsTab();
	}
}

/* ------------------------------------------------ save as collection */

// Steam's dynamic filter keeps store tags only: AND tags go in one intersection
// group, OR-only tags in a union group. Verified against live counts.
function dynPlan(st) {
	const tags = st.filters.get('f:tags') || [];
	const and = tags.filter(x => x[0] === 't').map(x => Number(x.slice(1)));
	const or = tags.filter(x => x[0] === 'u').map(x => Number(x.slice(1)));
	const dropped = [];
	for (const g of GROUPS) {
		if (g.id === 'f:tags') continue;
		const v = st.filters.get(g.id);
		if (v?.length) dropped.push(`${g.label}: ${v.map(id => labelOf(g.id, id)).join(', ')}`);
	}
	let tagGroup = null;
	if (and.length) {
		tagGroup = { opts: and, union: false };
		if (or.length) dropped.push(`Tags (any of): ${or.map(t => tagName(t)).join(', ')}`);
	} else if (or.length) {
		tagGroup = { opts: or, union: true };
	}
	return { tagGroup, dropped, and: and.map(t => tagName(t)), or: or.map(t => tagName(t)) };
}

// Steam's own filter spec, borrowed from an existing dynamic collection so the
// structure matches; only the tag group is ours.
function dynSpec(tagGroup) {
	const c = (store()?.userCollections || []).find(x => x.bIsDynamic);
	const raw = c?.ToStorageFormat?.()?.roamingData?.filterSpec;
	const s = JSON.parse(JSON.stringify(typeof raw === 'string' ? JSON.parse(raw) : raw));
	s.strSearchText = '';
	s.filterGroups = s.filterGroups.map((g, i) => ({ rgOptions: [], bAcceptUnion: i === 0 }));
	if (tagGroup) s.filterGroups[DYN_TAG_GROUP] = { rgOptions: tagGroup.opts, bAcceptUnion: tagGroup.union };
	return s;
}

function uniqueName(base) {
	const taken = new Set((store()?.userCollections || []).map(c => c.displayName));
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) {
		const n = `${base} (${i})`;
		if (!taken.has(n)) return n;
	}
}

// Static: exactly the apps on screen (S19's tested path). Dynamic: Steam's filter class.
async function createCollection(name, mode, st, plan) {
	const cs = store();
	if (mode === 'static') {
		const c = cs.NewUnsavedCollection(name, undefined, []);
		c.AsDragDropCollection().AddApps(st.view.map(r => r.app));
		await c.Save();
		return cs.GetUserCollectionsByName(name)?.[0] || null;
	}
	const Filter = cs.userCollections.find(x => x.internalAppFilter).internalAppFilter.constructor;
	const c = cs.NewUnsavedCollection(name, new Filter(dynSpec(plan.tagGroup)), []);
	await c.Save();
	return cs.GetUserCollectionsByName(name)?.[0] || null;
}

function closeDialog() {
	dialog?.remove();
	dialog = null;
}

function openCollectionDialog() {
	const api = mounted;
	if (!api || !api.state.view.length) return;
	closeDialog();
	const st = api.state;
	const plan = dynPlan(st);
	const haveDyn = (store()?.userCollections || []).some(c => c.bIsDynamic) && (store()?.userCollections || []).some(c => c.internalAppFilter);
	const defaultName = activeLabels(st).join(' · ') || 'All games';
	let mode = 'static';
	dialog = h('div', 'lc-fx-dialog');
	dialog.innerHTML = `
		<header class="lc-fx-head"><h2>Save as collection</h2><button type="button" class="lc-fx-x" data-act="close" aria-label="Close">×</button></header>
		<div class="lc-fx-dlg">
			<label class="lc-fx-dlg-name"><span>Name</span><input type="text" maxlength="48" spellcheck="false" value="${esc(defaultName)}"></label>
			<div class="lc-fx-modes">
				<button type="button" data-mode="static" class="on" aria-pressed="true">Static</button>
				<button type="button" data-mode="dynamic" aria-pressed="false"${haveDyn && plan.tagGroup ? '' : ' disabled'}>Dynamic</button>
			</div>
			<p class="lc-fx-dlg-info"></p>
			<div class="lc-fx-dlg-actions"></div>
			<p class="lc-fx-dlg-status" role="status"></p>
		</div>`;
	document.body.append(dialog);

	const paint = () => {
		const info = dialog.querySelector('.lc-fx-dlg-info');
		const acts = dialog.querySelector('.lc-fx-dlg-actions');
		for (const b of dialog.querySelectorAll('[data-mode]')) {
			const on = b.dataset.mode === mode;
			b.classList.toggle('on', on);
			b.setAttribute('aria-pressed', String(on));
		}
		if (mode === 'static') {
			info.textContent = `${st.view.length.toLocaleString()} apps: exactly the list on screen now. Later changes in Steam do not update it.`;
			acts.innerHTML = '<button type="button" data-act="save" data-kind="static" class="lc-fx-go">Save static</button>';
			return;
		}
		const keeps = plan.tagGroup ? `Steam keeps tags (${plan.tagGroup.union ? 'any of' : 'all of'}): ${(plan.tagGroup.union ? plan.or : plan.and).join(', ')}.` : 'Steam keeps none of these filters.';
		if (!plan.dropped.length) {
			info.textContent = `${keeps} Nothing is dropped.`;
			acts.innerHTML = '<button type="button" data-act="save" data-kind="dynamic" class="lc-fx-go">Save dynamic</button>';
			return;
		}
		info.textContent = `${keeps} These filters can't be kept in a dynamic collection: ${plan.dropped.join(' · ')}.`;
		acts.innerHTML = plan.tagGroup
			? '<button type="button" data-act="save" data-kind="dynamic" class="lc-fx-go">Save dynamic without them</button><button type="button" data-act="save" data-kind="static" class="lc-fx-go">Save static instead</button>'
			: '<button type="button" data-act="save" data-kind="static" class="lc-fx-go">Save static instead</button>';
	};

	dialog.addEventListener('click', async e => {
		const modeBtn = e.target.closest('[data-mode]');
		if (modeBtn && !modeBtn.disabled) { mode = modeBtn.dataset.mode; paint(); return; }
		const act = e.target.closest('[data-act]');
		if (!act) return;
		if (act.dataset.act === 'close') { closeDialog(); return; }
		if (act.dataset.act === 'save') await saveCollectionFrom(act.dataset.kind);
	});
	dialog.addEventListener('keydown', e => {
		if (e.key === 'Enter' && e.target.matches('.lc-fx-dlg-name input')) { e.preventDefault(); saveCollectionFrom(mode); }
	});

	// The dialog has its own buttons; a second save after success is blocked by disabling them.
	const saveCollectionFrom = async kind => {
		const btns = dialog?.querySelectorAll('.lc-fx-dlg-actions button');
		const status = dialog?.querySelector('.lc-fx-dlg-status');
		if (!btns || !status) return;
		const base = dialog.querySelector('.lc-fx-dlg-name input').value.trim().slice(0, 48) || 'Collection';
		const name = uniqueName(base);
		btns.forEach(b => { b.disabled = true; });
		status.textContent = 'Saving…';
		try {
			const c = await createCollection(name, kind, mounted.state, dynPlan(mounted.state));
			status.textContent = `Saved "${name}": ${(c?.allApps?.length ?? mounted.state.view.length).toLocaleString()} apps.`;
			if (syncCollections()) mounted.renderTabs();
		} catch (err) {
			status.textContent = `Save failed: ${err?.message || err}`;
			btns.forEach(b => { b.disabled = false; });
		}
	};
	paint();
	dialog.querySelector('.lc-fx-dlg-name input')?.focus();
}

/* -------------------------------------------------- document listeners */

function onDocDown(e) {
	if (editor && !editor.contains(e.target) && !editorAnchor?.contains?.(e.target)) closeEditor();
	if (flyout && !flyout.contains(e.target) && !more?.contains(e.target)) closeFlyout();
}

function onDocKey(e) {
	if (e.key !== 'Escape') return;
	if (dialog) { e.stopPropagation(); closeDialog(); }
	else if (editor) { e.stopPropagation(); closeEditor(); }
	else if (flyout) { e.stopPropagation(); closeFlyout(); }
}

/* ----------------------------------------------------- strip and fit */

// ops.js re-renders the strip on every tab change, so the segments are put back.
function ensureChrome() {
	if (!nav) return;
	mo?.disconnect();
	nav.append(more, filterBtn);
	mo?.observe(nav, { childList: true });
	fit();
}

// Tabs that do not fit go into MORE. Measured against the controls row, with
// the collection selector and a minimum search field kept in view.
function fit() {
	if (!nav || !ctrl || !filterBtn || !more) return;
	const btns = [...nav.querySelectorAll('[data-tab]')];
	for (const b of btns) b.hidden = false;
	more.hidden = true;
	if (!nav.offsetParent) return; // compact mode hides the strip
	const cs = getComputedStyle(ctrl);
	const inner = ctrl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
	const avail = inner - (coll?.offsetWidth || 0) - SEARCH_MIN - GAP * 2;
	const widths = btns.map(b => b.offsetWidth + GAP);
	const total = widths.reduce((a, b) => a + b, 0);
	const fixed = filterBtn.offsetWidth + GAP;
	if (total + fixed <= avail) return;
	more.hidden = false;
	const moreW = more.offsetWidth + GAP;
	const budget = avail - fixed - moreW;
	let acc = 0;
	let cut = btns.length;
	for (let i = 0; i < btns.length; i++) {
		if (acc + widths[i] > budget) { cut = i; break; }
		acc += widths[i];
	}
	btns.forEach((b, i) => { b.hidden = i >= cut; });
	const rest = btns.slice(cut);
	more.querySelector('i').textContent = rest.length || '';
	more.classList.toggle('on', rest.some(b => b.classList.contains('on')));
	if (!rest.length) closeFlyout();
}

function toggleFlyout() {
	if (flyout) closeFlyout();
	else openFlyout();
}

function openFlyout() {
	if (!nav || !more) return;
	const hidden = [...nav.querySelectorAll('[data-tab]')].filter(b => b.hidden);
	if (!hidden.length) return;
	closeEditor();
	flyout = h('div', 'lc-fx-flyout');
	flyout.innerHTML = hidden.map(b => {
		const id = b.dataset.tab;
		const t = registry.tabs.get(id);
		return `<button type="button" data-tab="${esc(id)}" class="${b.classList.contains('on') ? 'on' : ''}"><span>${esc(t?.label || id)}</span><i>${esc(b.querySelector('i')?.textContent || '')}</i></button>`;
	}).join('');
	flyout.addEventListener('click', e => {
		const x = e.target.closest('[data-tab]');
		if (!x) return;
		const id = x.dataset.tab;
		closeFlyout();
		nav?.querySelector(`[data-tab="${CSS.escape(id)}"]`)?.click();
	});
	document.body.append(flyout);
	const r = more.getBoundingClientRect();
	flyout.style.top = `${r.bottom + 6}px`;
	flyout.style.left = `${Math.max(12, r.right - flyout.offsetWidth)}px`;
	more.setAttribute('aria-expanded', 'true');
}

function closeFlyout() {
	flyout?.remove();
	flyout = null;
	more?.setAttribute('aria-expanded', 'false');
}

/* ------------------------------------------------------- tab editor */

export function openTabEditor(anchorEl) {
	if (editor) { closeEditor(); return; }
	if (!mounted) return;
	closeFlyout();
	editor = h('div', 'lc-fx-editor');
	editor.innerHTML = `
		<header class="lc-fx-head"><h2>Tabs</h2><button type="button" class="lc-fx-x" aria-label="Close">×</button></header>
		<div class="lc-fx-list"></div>
		<footer class="lc-fx-editor-foot"><button type="button" class="lc-fx-reset">Defaults</button><span>Labels up to 10 characters</span></footer>`;
	editor.addEventListener('click', onEditorClick);
	editor.addEventListener('change', onEditorChange);
	editor.addEventListener('pointerdown', onGripDown);
	editor.addEventListener('pointermove', onGripMove);
	editor.addEventListener('pointerup', onGripUp);
	editor.addEventListener('pointercancel', onGripUp);
	document.body.append(editor);
	editorAnchor = anchorEl || null;
	renderEditor();
	placeEditor(anchorEl);
}

function closeEditor() {
	editor?.remove();
	editor = null;
	editorAnchor = null;
	drag = null;
}

function placeEditor(anchorEl) {
	const r = anchorEl?.getBoundingClientRect?.();
	const w = editor.offsetWidth;
	const hh = editor.offsetHeight;
	const left = r ? r.right - w : window.innerWidth - w - 24;
	const top = r ? r.bottom + 8 : 96;
	editor.style.left = `${Math.max(12, Math.min(left, window.innerWidth - w - 12))}px`;
	editor.style.top = `${Math.max(12, Math.min(top, window.innerHeight - hh - 12))}px`;
}

function rowHTML(id, isOn, over) {
	const t = registry.tabs.get(id);
	const base = bases.get(id) || t?.label || id;
	const preset = t?.group === 'preset';
	return `<div class="lc-fx-row ${isOn ? 'on' : 'off'}" data-id="${esc(id)}">
		<button type="button" class="lc-fx-lamp" data-act="toggle" aria-pressed="${isOn}" aria-label="Show ${esc(base)} on the strip"></button>
		<span class="lc-fx-src"><b>${esc(base)}</b><small>${esc(KIND[t?.group] || 'Built-in')}</small></span>
		<input type="text" class="lc-fx-short" maxlength="10" value="${esc(over || '')}" placeholder="${esc(base.toUpperCase().slice(0, 10))}" aria-label="Short label for ${esc(base)}" spellcheck="false">
		${preset ? '<button type="button" class="lc-fx-del" data-act="delete" aria-label="Delete preset">×</button>' : ''}
		${isOn ? '<b class="lc-fx-grip" aria-hidden="true" title="Drag to reorder"></b>' : ''}
	</div>`;
}

function renderEditor() {
	const list = editor?.querySelector('.lc-fx-list');
	if (!list) return;
	const over = prefs.get('tablabels', {}) || {};
	const ids = currentTabIds();
	const rest = [...registry.tabs.keys()].filter(id => !ids.includes(id));
	list.innerHTML = [...ids, ...rest].map(id => rowHTML(id, ids.includes(id), over[id])).join('');
}

function toggleTab(id) {
	const ids = currentTabIds();
	const at = ids.indexOf(id);
	if (at >= 0) {
		if (ids.length === 1) return; // the strip always keeps one tab
		ids.splice(at, 1);
	} else {
		ids.push(id);
	}
	prefs.set('tabs', ids);
	renderEditor();
}

// Right-click on a strip tab: Steam's native menu, like the bank's Millennium button.
function onTabMenu(e) {
	const button = e.target.closest('[data-tab]');
	if (!button) return;
	e.preventDefault();
	const id = button.dataset.tab, t = registry.tabs.get(id);
	const api = host().MILLENNIUM_API, h = host().SP_REACT.createElement;
	const items = [h(api.MenuItem, { key: 'edit', onClick: () => openTabEditor(button) }, 'Edit tabs…')];
	if (currentTabIds().length > 1) items.unshift(h(api.MenuItem, { key: 'hide', onClick: () => toggleTab(id) }, 'Remove from strip'));
	if (t?.group === 'preset') items.unshift(h(api.MenuItem, { key: 'delete', onClick: () => deletePreset(id) }, 'Delete saved tab'));
	beep('nav');
	api.showContextMenu(h(api.Menu, { label: t?.label || 'Tab' }, ...items), button, { bForcePopup: true, bOverlapHorizontal: false, bOverlapVertical: true });
}

function deletePreset(id) {
	const name = id.slice('preset:'.length);
	prefs.set('presets', presetList().filter(p => p.name !== name));
	syncPresets();
	prefs.set('tabs', currentTabIds());
	renderEditor();
}

function onEditorClick(e) {
	const x = e.target.closest('button');
	if (!x) return;
	if (x.classList.contains('lc-fx-x')) { closeEditor(); return; }
	if (x.classList.contains('lc-fx-reset')) { prefs.set('tabs', null); renderEditor(); return; }
	const row = x.closest('.lc-fx-row');
	if (!row) return;
	if (x.dataset.act === 'toggle') toggleTab(row.dataset.id);
	else if (x.dataset.act === 'delete') deletePreset(row.dataset.id);
}

function onEditorChange(e) {
	const input = e.target;
	if (!input.classList?.contains('lc-fx-short')) return;
	const id = input.closest('.lc-fx-row').dataset.id;
	const v = input.value.trim().slice(0, 10).toUpperCase();
	const over = { ...(prefs.get('tablabels', {}) || {}) };
	if (v) over[id] = v;
	else delete over[id];
	prefs.set('tablabels', Object.keys(over).length ? over : null);
	applyLabels();
	mounted?.renderTabs();
	input.value = v;
}

// Drag to reorder the on-rows. The row follows the pointer; on release the
// others slide into place with element.animate (FLIP), then the order saves.
function onGripDown(e) {
	const grip = e.target.closest('.lc-fx-grip');
	if (!grip || e.button !== 0) return;
	e.preventDefault();
	const row = grip.closest('.lc-fx-row');
	try { grip.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer: drag still tracks on the editor */ }
	drag = { row, y0: e.clientY };
	row.classList.add('dragging');
}

function onGripMove(e) {
	if (!drag) return;
	drag.row.style.transform = `translateY(${e.clientY - drag.y0}px)`;
}

function onGripUp() {
	if (!drag) return;
	const { row } = drag;
	drag = null;
	const list = row.parentElement;
	const rows = [...list.querySelectorAll('.lc-fx-row.on')];
	const from = rows.indexOf(row);
	const centre = el => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; };
	const others = rows.filter(x => x !== row);
	const mid = centre(row);
	const to = others.filter(x => centre(x) < mid).length;
	const first = new Map(rows.map(x => [x, x.getBoundingClientRect()]));
	row.style.transform = '';
	row.classList.remove('dragging');
	if (to === from) return;
	if (to < others.length) others[to].before(row);
	else others[others.length - 1].after(row);
	if (!reduced()) {
		for (const x of rows) {
			const a = first.get(x);
			const b = x.getBoundingClientRect();
			const dx = a.left - b.left;
			const dy = a.top - b.top;
			if (dx || dy) x.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' });
		}
	}
	prefs.set('tabs', [...list.querySelectorAll('.lc-fx-row.on')].map(x => x.dataset.id));
}

/* ----------------------------------------------------------- mounting */

function mountDom(api) {
	nav = api.root.querySelector('.lc-ops-tabs');
	ctrl = api.root.querySelector('.lc-ops-controls');
	coll = api.root.querySelector('.lc-ops-coll');
	slot = api.root.querySelector('.lc-ops-slot-under-tabs');
	if (!nav || !ctrl || !slot) { nav = ctrl = coll = slot = null; return; }

	nav.addEventListener('contextmenu', onTabMenu);
	filterBtn = h('button', 'lc-fx-filter', 'Filter<i></i>');
	filterBtn.type = 'button';
	filterBtn.setAttribute('aria-expanded', 'false');
	filterBtn.addEventListener('click', toggleDrawer);
	// ops.js swallows Enter on the root; a focused segment still toggles.
	filterBtn.addEventListener('keydown', e => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		e.stopPropagation();
		toggleDrawer();
	});

	more = h('button', 'lc-fx-more', '▸ More<i></i>');
	more.type = 'button';
	more.hidden = true;
	more.setAttribute('aria-haspopup', 'true');
	more.setAttribute('aria-expanded', 'false');
	more.addEventListener('click', toggleFlyout);

	wrap = h('div', 'lc-fx-wrap');
	readout = h('div', 'lc-fx-readout', '<span class="lc-fx-text"></span><button type="button" class="lc-fx-clear">Clear</button>');
	readout.hidden = true;
	readoutText = readout.querySelector('.lc-fx-text');
	readout.querySelector('.lc-fx-clear').addEventListener('click', clearFilters);
	wrap.append(readout);

	mo = new MutationObserver(ensureChrome);
	ro = new ResizeObserver(() => fit());
	ro.observe(ctrl);
	ensureChrome();
	onRefresh();
}

function unmountDom() {
	closeEditor();
	closeFlyout();
	closeDialog();
	mo?.disconnect();
	ro?.disconnect();
	mo = ro = null;
	clearTimeout(closeTimer);
	clearTimeout(sliderTimer);
	drawer?.remove();
	drawer = null;
	wrap?.remove();
	filterBtn?.remove();
	more?.remove();
	nav = ctrl = coll = slot = filterBtn = more = wrap = readout = readoutText = null;
	filledSrc = null;
}

// Watches for the ops register; re-mounts when ops rebuilds its api.
function sync() {
	const api = apiNow();
	if (api === mounted) return;
	unmountDom();
	mounted = api;
	if (!api) return;
	syncCollections();
	syncPresets();
	api.renderTabs();
	mountDom(api);
}

function onRefresh() {
	const api = mounted;
	if (!api || !nav) return;
	if (syncCollections()) api.renderTabs();
	fit();
	const st = api.state;
	const active = GROUPS.filter(g => st.filters.get(g.id)?.length).length;
	filterBtn.querySelector('i').textContent = active || '';
	renderReadout(st);
	if (drawer && !drawer.classList.contains('closing')) {
		if (filledSrc !== st.all) { fillGroups(DYN); filledSrc = st.all; }
		recount(st);
		updateChips(st);
	}
	syncSlot();
}

/* -------------------------------------------------------- lifecycle */

function teardown() {
	clearInterval(poll);
	poll = 0;
	for (const off of unsubs) off();
	unsubs = [];
	document.removeEventListener('keydown', onDocKey, true);
	document.removeEventListener('pointerdown', onDocDown, true);
	unmountDom();
	mounted = null;
	for (const g of GROUPS) registry.filters.delete(g.id);
	for (const id of [...registry.tabs.keys()]) {
		if (/^(sys|uc|preset):/.test(id)) registry.tabs.delete(id);
	}
	// Restore built-in labels that a short-label override may have changed.
	for (const [id, base] of bases) {
		if (registry.tabs.has(id)) registry.tabs.get(id).label = base;
	}
	bases.clear();
	memo.clear();
	predCache.clear();
	collSig = '';
	registry.tools.delete('tabs');
	registry.tools.delete('filter');
	registry.tools.delete('collection');
	delete window[KEY];
}

export function install() {
	window[KEY]?.stop();
	for (const [id, label, test] of SYS_TABS) putTab(id, label, 'system', test);
	registerGroups();
	syncCollections();
	syncPresets();
	applyLabels();
	registry.tools.set('tabs', { label: 'Tabs', run: openTabEditor });
	registry.tools.set('filter', { label: 'Filter', run: toggleDrawer });
	registry.tools.set('collection', { label: 'Save as collection', run: openCollectionDialog });
	unsubs = [on('afterRefresh', onRefresh)];
	document.addEventListener('keydown', onDocKey, true);
	document.addEventListener('pointerdown', onDocDown, true);
	poll = setInterval(sync, 400);
	window[KEY] = { stop: teardown };
	Promise.resolve(host().App?.WaitForServicesInitialized?.())
		.then(() => { storeReady = true; syncCollections(); syncPresets(); mounted?.renderTabs(); sync(); })
		.catch(() => {});
	sync();
}
