// Untether: give a piece of UI a real Steam window of its own, so nothing in its owner
// window can cover it (not even the store/community web view, which Steam draws as a
// native layer above the whole main window). Built for the annotator pill
// (js/debug/menu.js); use it for anything a note says to "untether".
// What Steam's popups are like (found 2026-11-08, Linux):
// - They paint opaque whatever the flags (Composited + TransparentParentWindow too):
//   size the window to the content and paint the body to match.
// - Steam injects no theme and no Millennium into them: link tokens.css and import
//   your module yourself (untether does both).
// - The document can report itself hidden, and then requestAnimationFrame never fires:
//   use timers in there.
// - MoveTo(x, y, dpi) needs the DPI, or the point lands relative to the monitor.
// - window.screenX/screenY can read 0 in the owner; GetWindowDimensions() (async) is right.
// - GetMousePositionDetails() resolves "n&x=..&y=..": the same frame from every window, so
//   its deltas drive a drag (pointer screenX is wrong while screenX is).
// - The Change Window Params plugin ORs Composited | TransparentParentWindow into the flags.
// - A PopUpMenuHint popup is refused (CreatePopup returns {}).

export const FLAGS = {
	Hidden: 1 << 1, NoTaskbarIcon: 1 << 3, Resizable: 1 << 4, ApplyBrowserScaleToDimensions: 1 << 12,
	AlwaysOnTop: 1 << 13, NoWindowShadow: 1 << 14,
};
// Shown by the caller once it has drawn, so it never flashes empty.
export const FLOATING = FLAGS.Hidden | FLAGS.NoTaskbarIcon | FLAGS.ApplyBrowserScaleToDimensions | FLAGS.AlwaysOnTop | FLAGS.NoWindowShadow;

const TOKENS_HREF = new URL('../css/tokens.css', import.meta.url).href;

// Opens the window and runs `entry` from `module` inside it (a fresh copy of the module,
// in the popup's own realm). `hand` lands on the popup as window.__lcOwner: the owner's
// functions, the only way the popup reaches back. Returns the popup or null.
export function untether({ name, title, rect, module, entry, hand, flags = FLOATING }) {
	const shared = window.opener || window;
	let popup = null;
	try {
		popup = shared.g_PopupManager.constructor.CreatePopup(name, {
			title,
			dimensions: { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), top: Math.round(rect.top) },
			eCreationFlags: flags,
		})?.popup || null;
	} catch (err) {
		console.error('[lcars untether]', name, err);
	}
	if (!popup) return null;
	popup.__lcOwner = hand;
	const doc = popup.document;
	doc.title = title;
	doc.head.insertAdjacentHTML('beforeend', `<link rel="stylesheet" href="${TOKENS_HREF}">`
		+ '<style>html, body { margin: 0; overflow: hidden; background: var(--lc-black, #000); }</style>');
	const script = doc.createElement('script');
	script.type = 'module';
	script.textContent = `import(${JSON.stringify(module)}).then((m) => m[${JSON.stringify(entry)}]());`;
	doc.head.append(script);
	return popup;
}

// Inside the popup: move its own window, by screen pixels.
export function moveSelf(left, top) {
	window.SteamClient.Window.MoveTo(Math.round(left), Math.round(top), window.devicePixelRatio || 1);
}

export const windowRect = () => window.SteamClient.Window.GetWindowDimensions();

// The pointer, in Steam's screen frame (see above): { x, y } or null.
export async function mouseAt() {
	try {
		const text = String(await window.SteamClient.Window.GetMousePositionDetails());
		const x = Number(/x=([-\d.]+)/.exec(text)?.[1]);
		const y = Number(/y=([-\d.]+)/.exec(text)?.[1]);
		return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
	} catch (_) {
		return null;
	}
}
