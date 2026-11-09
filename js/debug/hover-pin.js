// LCARSv2 annotator: keep hover styles on while Alt is held (ported from ATOMS'
// steam-annotation-input-lock.js). The picker marks the elements under the pointer with
// data-lc-hover and its document with data-lc-pin=<token>; this finds that document's
// DevTools target through Millennium's bridge and forces :hover on the marked elements
// (CSS.forcePseudoState), so a hover effect can be annotated after the pointer moves on.
// Runs where the bridge is (the main window and menu windows); web pages ask the main
// window to run it for them (js/debug/menu.js, op 'pin').

const pins = new Map(); // token -> { cdp, sessionId, nodeIds }

const bridge = () => (window.opener || window).MILLENNIUM_API?.ChromeDevToolsProtocol || null;

// Some of Steam's targets (hidden menus, parked pages) never answer: every call is capped.
const within = (promise, ms = 700) => Promise.race([promise, new Promise((_, fail) => setTimeout(() => fail(new Error('timeout')), ms))]);

async function findSession(cdp, token, url) {
	const { targetInfos } = await within(cdp.send('Target.getTargets', {}));
	const mark = `document.documentElement?.dataset.lcPin === ${JSON.stringify(token)}`;
	// The asking page's own URL first: it is nearly always the one.
	const pages = targetInfos.filter((t) => t.type === 'page').sort((a, b) => (b.url === url) - (a.url === url));
	for (const target of pages) {
		let sessionId;
		try {
			({ sessionId } = await within(cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })));
			const found = await within(cdp.send('Runtime.evaluate', { expression: mark, returnByValue: true }, sessionId));
			if (found.result?.value === true) return sessionId;
		} catch (_) {
			// A target that went away or refuses attachment: try the next one.
		}
		if (sessionId) cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
	}
	return null;
}

// Resolves true once :hover is pinned on the marked elements.
export async function pinHover(token, url = '') {
	const cdp = bridge();
	if (!cdp || pins.has(token)) return false;
	const pin = { cdp, sessionId: null, nodeIds: [] };
	pins.set(token, pin);
	try {
		pin.sessionId = await findSession(cdp, token, url);
		if (!pin.sessionId || !pins.has(token)) return false;
		const s = pin.sessionId;
		await within(cdp.send('DOM.enable', {}, s));
		await within(cdp.send('CSS.enable', {}, s));
		await within(cdp.send('DOM.getDocument', { depth: 0 }, s));
		const list = await within(cdp.send('Runtime.evaluate', { expression: "[...document.querySelectorAll('[data-lc-hover]')]", objectGroup: 'lc-pin' }, s));
		if (!list.result?.objectId) return false;
		const props = await within(cdp.send('Runtime.getProperties', { objectId: list.result.objectId, ownProperties: true }, s));
		await Promise.all(props.result.filter((p) => /^\d+$/.test(p.name) && p.value?.objectId).slice(0, 64).map(async (p) => {
			const { nodeId } = await within(cdp.send('DOM.requestNode', { objectId: p.value.objectId }, s));
			if (!nodeId) return;
			pin.nodeIds.push(nodeId);
			await within(cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] }, s));
		}));
		cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'lc-pin' }, s).catch(() => {});
		if (!pins.has(token)) { await unpin(pin); return false; } // let go while it was pinning
		return true;
	} catch (_) {
		return false;
	}
}

async function unpin(pin) {
	const { cdp, sessionId, nodeIds } = pin;
	if (!sessionId) return;
	await Promise.all(nodeIds.map((nodeId) => cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, sessionId).catch(() => {})));
	cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
}

export function unpinHover(token) {
	const pin = pins.get(token);
	if (!pin) return;
	pins.delete(token);
	unpin(pin);
}
