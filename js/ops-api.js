// LCARSv2 operations register: extension points. ops.js is the core (data,
// virtualised body, routing); everything else (extra columns, resize and
// reorder, tab editor, filter drawer, motion) registers through here so no
// two modules ever edit the same file.
//
//   registry.columns  id -> { label, width, min, align, cls, cell(r), cmp(a, b), dir, group }
//   registry.tabs     id -> { label, test(r) }
//   registry.filters  id -> { label, group, test(r, value) }      (value null = inactive)
//   registry.tools    id -> { label, run(anchorEl) }             (menu commands)
//   hooks             afterRefresh(view) select(r) open(r) modeWillChange(mode, appid) modeChange(mode, appid)
//                     headerRender(headerEl) rowsPainted(rowsEl)
//   prefs             JSON in localStorage under 'lcarsv2.ops.<key>', with change listeners

export const registry = {
	columns: new Map(),
	tabs: new Map(),
	filters: new Map(),
	// Commands other modules offer to menus: id -> { label, run(anchorEl) }
	// (e.g. 'columns' from ops-columns.js, 'tabs' / 'filter' from ops-filters.js).
	tools: new Map(),
};

const hooks = new Map();

export function on(hook, fn) {
	if (!hooks.has(hook)) hooks.set(hook, new Set());
	hooks.get(hook).add(fn);
	return () => hooks.get(hook).delete(fn);
}

export function emit(hook, ...args) {
	for (const fn of hooks.get(hook) || []) {
		try { fn(...args); } catch (e) { console.error('[lcarsv2 ops]', hook, e); }
	}
}

const PREFIX = 'lcarsv2.ops.';
const listeners = new Map();

export const prefs = {
	get(key, dflt) {
		try { const v = localStorage.getItem(PREFIX + key); return v == null ? dflt : JSON.parse(v); } catch (_) { return dflt; }
	},
	set(key, value) {
		try { value == null ? localStorage.removeItem(PREFIX + key) : localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) {}
		for (const fn of listeners.get(key) || []) {
			try { fn(value); } catch (e) { console.error('[lcarsv2 ops] pref', key, e); }
		}
	},
	on(key, fn) {
		if (!listeners.has(key)) listeners.set(key, new Set());
		listeners.get(key).add(fn);
		return () => listeners.get(key).delete(fn);
	},
};

// Column order and visibility: the saved list, with unknown ids dropped.
// Columns registered later (by other modules) stay hidden until chosen.
export const DEFAULT_COLUMNS = ['appid', 'name', 'status', 'minutes', 'last', 'size', 'review'];

export function visibleColumns() {
	const ids = prefs.get('cols', DEFAULT_COLUMNS).filter(id => registry.columns.has(id));
	return (ids.length ? ids : DEFAULT_COLUMNS.filter(id => registry.columns.has(id))).map(id => ({ id, ...registry.columns.get(id) }));
}

// grid-template-columns for the given columns, honouring saved widths (px).
// Every column keeps its set width, so resizing one moves no other, and the game
// card comes first (user, round 6). NAME's track is a variable: ops.js fit()
// narrows it when the card needs the room.
export const nameWidth = (c, widths = prefs.get('colw', {})) => Math.max(c.min || 160, widths.name || 340);
export const columnTrack = (c, widths = prefs.get('colw', {})) => (c.id === 'name'
	? `var(--lc-name-w, ${nameWidth(c, widths)}px)`
	: widths[c.id] ? `${Math.max(c.min || 40, widths[c.id])}px` : c.width);

export function columnTemplate(cols) {
	const widths = prefs.get('colw', {});
	return cols.map(c => columnTrack(c, widths)).join(' ');
}

export const DEFAULT_TABS = ['all', 'installed', 'recent', 'unplayed', 'missing'];

export function visibleTabs() {
	const ids = prefs.get('tabs', DEFAULT_TABS).filter(id => registry.tabs.has(id));
	return (ids.length ? ids : ['all']).map(id => ({ id, ...registry.tabs.get(id) }));
}
