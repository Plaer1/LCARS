// LCARSv2 annotator store (slice S18, worker Q). Browser storage only:
// key lcarsv2.annotator.v1 holds {seq, records}. Each origin keeps its own copy.
//
// Usage for worker R (menu and note manager):
// 1. import * as store from './store.js'; importing has no side effects.
// 2. store.list() returns copies of all records, oldest first. It returns [] when storage is corrupt.
// 3. store.add({...describePicked(el), note}) from picker.js returns the stored record.
//    A record is only what a fixer can't get by reading the page: {id, ts, route, selector, context, note, status}.
// 4. store.update(id, {note, status:'done'|'open'}) and store.remove(id) change one record.
// 5. store.clear() deletes the key. store.usage() gives {count, max, bytes, maxBytes, error} for a counter.
// 6. store.onChange(fn) calls fn(records) after local writes and after 'storage' events; it returns an unsubscribe.
// 7. Writes throw StoreError with .code: full (500 records), too-big (2 MB), quota, corrupt, invalid, missing. Show err.message.
// 8. exportTOON() throws on corrupt storage, and nothing is overwritten. It holds open notes, grouped by route.
// 9. store.import(text) takes JSON or TOON, replaces records with matching ids, adds the rest; if a check fails, nothing is written.
// 10. Remove a record only after the user confirms; there is no undo.

export const KEY = 'lcarsv2.annotator.v1';
export const MAX_RECORDS = 500;
export const MAX_BYTES = 2 * 1024 * 1024;
const CHANGED = 'lcars-annotator-changed'; // same-window notice; 'storage' only reaches other windows
const NEEDS_QUOTES = /[,":\\\r\n\t]|^\s|\s$/;

export class StoreError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'StoreError';
		this.code = code;
	}
}

const str = (value, fallback = '') => (value == null ? fallback : String(value));
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const newId = (seq) => `${seq}-${Math.random().toString(36).slice(2, 7)}`;
const fullMessage = () => `Annotator is full: ${MAX_RECORDS} records. Export, then delete notes you no longer need.`;
const blocked = () => new StoreError('unavailable', 'Browser storage is blocked for this page.');

// Which page a note belongs to. The main window's URL never changes (it is always
// /routes/library/home), so client windows go by their router; web pages by URL;
// menus and other windows with no router by their title.
export function pageKey() {
	if (location.protocol.startsWith('http') && location.host !== 'steamloopback.host') return location.host + location.pathname;
	try {
		const host = window.opener || window;
		const path = host.SteamUIStore?.WindowStore?.GetWindowInstanceFromWindow?.(window)?.m_history?.location?.pathname;
		// The main window showing a web page: the page in its web view is what's on screen.
		if (path?.startsWith('/browser')) {
			const url = new URL(host.MainWindowBrowserManager.m_URL);
			return url.host + url.pathname;
		}
		if (path) return path;
	} catch (_) {
		// Steam's stores aren't up yet: fall through to the title.
	}
	return document.title || location.pathname;
}

function normalize(src) {
	return {
		id: str(src.id),
		ts: num(src.ts) || Date.now(),
		route: str(src.route),
		selector: str(src.selector),
		context: str(src.context),
		note: str(src.note),
		status: src.status === 'done' ? 'done' : 'open',
	};
}

// Throws on corrupt data, so writers never overwrite unreadable storage.
function load() {
	let raw = null;
	try {
		raw = localStorage.getItem(KEY);
	} catch (_) {
		throw blocked();
	}
	if (!raw) return { seq: 0, records: [] };
	try {
		const data = JSON.parse(raw);
		if (data && Array.isArray(data.records)) return { seq: num(data.seq), records: data.records.map(normalize) };
	} catch (_) {
		// Fall through to the corrupt error below.
	}
	throw new StoreError('corrupt', `Stored annotations under ${KEY} are unreadable. Export or clear them; nothing was overwritten.`);
}

function write(data) {
	if (data.records.length > MAX_RECORDS) throw new StoreError('full', fullMessage());
	const text = JSON.stringify(data);
	if (new TextEncoder().encode(text).length > MAX_BYTES) {
		throw new StoreError('too-big', 'Annotator storage would pass 2 MB. Export, then delete notes you no longer need.');
	}
	try {
		localStorage.setItem(KEY, text);
	} catch (_) {
		throw new StoreError('quota', 'The browser refused to save the annotation (storage quota). Export, then delete notes.');
	}
	window.dispatchEvent(new Event(CHANGED));
}

export function list() {
	try {
		return structuredClone(load().records);
	} catch (_) {
		return [];
	}
}

export function add(rec) {
	const data = load();
	const stored = normalize({ route: pageKey(), ...rec, status: 'open', ts: Date.now() });
	if (!stored.selector) throw new StoreError('invalid', 'An annotation needs a selector.');
	data.seq += 1;
	stored.id = newId(data.seq);
	data.records.push(stored);
	write(data);
	return stored;
}

export function update(id, patch) {
	const data = load();
	const index = data.records.findIndex((rec) => rec.id === id);
	if (index < 0) throw new StoreError('missing', `No annotation with id ${id}.`);
	const current = data.records[index];
	const changes = { ...(patch || {}) };
	delete changes.id;
	delete changes.ts;
	data.records[index] = normalize({ ...current, ...changes, id: current.id, ts: current.ts });
	write(data);
	return data.records[index];
}

export function remove(id) {
	const data = load();
	const before = data.records.length;
	data.records = data.records.filter((rec) => rec.id !== id);
	if (data.records.length === before) throw new StoreError('missing', `No annotation with id ${id}.`);
	write(data);
	return true;
}

export function clear() {
	try {
		localStorage.removeItem(KEY);
	} catch (_) {
		throw blocked();
	}
	window.dispatchEvent(new Event(CHANGED));
}

export function usage() {
	let count = 0;
	let bytes = 0;
	let error = null;
	try {
		bytes = new TextEncoder().encode(localStorage.getItem(KEY) || '').length;
		count = load().records.length;
	} catch (err) {
		error = err.message;
	}
	return { count, max: MAX_RECORDS, bytes, maxBytes: MAX_BYTES, error };
}

const listeners = new Set();
let attached = null;

function notify() {
	const records = list();
	for (const fn of [...listeners]) {
		try {
			fn(records);
		} catch (err) {
			console.error('[lcars annotator] listener failed', err);
		}
	}
}

// Modules that were hot-reloaded share one window event, so no listener goes stale.
export function onChange(fn) {
	listeners.add(fn);
	if (!attached) {
		attached = (event) => {
			if (event.type === CHANGED || event.key === KEY || event.key === null) notify();
		};
		window.addEventListener(CHANGED, attached);
		window.addEventListener('storage', attached);
	}
	return () => {
		listeners.delete(fn);
		if (!listeners.size && attached) {
			window.removeEventListener(CHANGED, attached);
			window.removeEventListener('storage', attached);
			attached = null;
		}
	};
}

const cell = (value) => {
	const text = str(value);
	if (text === '' || NEEDS_QUOTES.test(text)) {
		const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
		return `"${escaped}"`;
	}
	return text;
};

// What a fixer needs and nothing it can read off the page itself. One tabular
// array per route; a row's selector is the last step of its `at` context path.
export function exportTOON() {
	const groups = new Map();
	for (const rec of load().records) {
		if (rec.status !== 'open') continue;
		if (!groups.has(rec.route)) groups.set(rec.route, []);
		groups.get(rec.route).push(rec);
	}
	return [...groups.keys()].sort().flatMap((route) => {
		const rows = groups.get(route);
		return [
			`"${route.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"[${rows.length}]{id,at,note}:`,
			...rows.map((rec) => `  ${[rec.id, rec.context, rec.note].map(cell).join(',')}`),
		];
	}).join('\n');
}

// Splits one TOON row: comma-separated cells, double-quoted cells with \\ \" \n \r \t escapes.
function splitRow(line) {
	const cells = [];
	let i = 0;
	for (;;) {
		let value = '';
		if (line[i] === '"') {
			for (i += 1; i < line.length && line[i] !== '"'; i += 1) {
				if (line[i] !== '\\') {
					value += line[i];
					continue;
				}
				i += 1;
				value += { n: '\n', r: '\r', t: '\t' }[line[i]] ?? line[i];
			}
			if (i >= line.length) throw new StoreError('invalid', 'TOON row has an unclosed quote.');
			i += 1;
		} else {
			const comma = line.indexOf(',', i);
			const end = comma < 0 ? line.length : comma;
			value = line.slice(i, end);
			i = end;
		}
		cells.push(value);
		if (i >= line.length) return cells;
		if (line[i] !== ',') throw new StoreError('invalid', 'TOON row has text after a quoted value.');
		i += 1;
	}
}

const selectorOf = (context) => str(context).split(' > ').pop().replace(/:nth-child\(\d+\)$/, '');

// One or more `"route"[n]{fields}:` tables; also the older single `records[n]{fields}:`.
function parseTOON(text) {
	const out = [];
	let table = null;
	const finish = () => {
		if (table && table.seen !== table.size) throw new StoreError('invalid', `TOON table says ${table.size} rows; found ${table.seen}.`);
	};
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const head = /^(?:"((?:[^"\\]|\\.)*)"|records)\[(\d+)\]\{([^}]*)\}:$/.exec(line.trim());
		if (head) {
			finish();
			table = { route: head[1] == null ? null : head[1].replace(/\\(.)/g, '$1'), size: Number(head[2]), fields: head[3].split(',').map((name) => name.trim()), seen: 0 };
			continue;
		}
		if (!table) throw new StoreError('invalid', 'Import is neither JSON nor TOON note tables.');
		const cells = splitRow(line.trim());
		if (cells.length !== table.fields.length) {
			throw new StoreError('invalid', `TOON row has ${cells.length} values; expected ${table.fields.length}.`);
		}
		table.seen += 1;
		const rec = Object.fromEntries(table.fields.map((name, i) => [name, cells[i]]));
		if (table.route != null) rec.route = table.route;
		if (rec.at != null) {
			rec.context = rec.at;
			rec.selector = selectorOf(rec.at);
		}
		out.push(rec);
	}
	finish();
	if (!table) throw new StoreError('invalid', 'Nothing to import.');
	return out;
}

function parseImport(text) {
	if (!text) throw new StoreError('invalid', 'Nothing to import.');
	if (text[0] !== '{' && text[0] !== '[') return parseTOON(text);
	let data;
	try {
		data = JSON.parse(text);
	} catch (_) {
		throw new StoreError('invalid', 'Import is not valid JSON.');
	}
	const records = Array.isArray(data) ? data : data && data.records;
	if (!Array.isArray(records)) throw new StoreError('invalid', 'JSON import needs a records array.');
	return records;
}

// Named importText so the module can export it as import(); `import` is reserved.
function importText(text) {
	const incoming = parseImport(str(text).trim());
	const data = load();
	let seq = data.seq;
	for (const raw of incoming) {
		const rec = normalize(raw || {});
		if (!rec.selector) throw new StoreError('invalid', 'An imported record has no selector.');
		if (!rec.id) {
			seq += 1;
			rec.id = newId(seq);
		}
		const at = data.records.findIndex((existing) => existing.id === rec.id);
		if (at >= 0) data.records[at] = rec;
		else data.records.push(rec);
	}
	data.seq = seq;
	write(data);
	return incoming.length;
}

export { importText as import };
