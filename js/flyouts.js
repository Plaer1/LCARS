// LCARSv2 bank flyouts. Steam positions its root and SuperNav menus as if
// their buttons lived in a horizontal top bar: below the button, left-aligned.
// In the side bank that drops the menu over the very buttons you are aiming
// for. Steam keeps one menu instance per button (retained, created hidden);
// we flip that instance's options to open beside the button, top-aligned, and
// report the button's right edge as the bank's right edge, so every menu
// flies out past the bank whichever bank column its button sits in.

const BUTTONS = '.lc-bank ._2UyOBeiSdBayaFdRa39N2O, .lc-bank ._7AlhCx3XGzBeIrQaCneUD';
const GAP = 6;

function menuInstance(el) {
	const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
	let fiber = key && el[key];
	for (let depth = 0; fiber && depth < 6; depth++, fiber = fiber.return) {
		for (let hook = fiber.memoizedState; hook; hook = hook.next) {
			const v = hook.memoizedState;
			if (v && typeof v === 'object' && v.current && typeof v.current.Show === 'function' && v.current.m_options) return v.current;
		}
	}
	return null;
}

function patchButton(el) {
	const inst = menuInstance(el);
	if (inst && !inst.__lcFlyout) {
		Object.assign(inst.m_options, { bOverlapHorizontal: false, bOverlapVertical: true, bGrowToElementWidth: false });
		inst.__lcFlyout = true;
	}
	if (!el.__lcRect) {
		el.__lcRect = true;
		// Steam measures the anchor with getBoundingClientRect when it shows the
		// menu. Report the real box, stretched to the bank's right edge.
		el.getBoundingClientRect = function () {
			const r = Element.prototype.getBoundingClientRect.call(this);
			const bank = this.closest('.lc-bank');
			if (!bank) return r;
			const right = Element.prototype.getBoundingClientRect.call(bank).right + GAP;
			return new DOMRect(r.left, r.top, Math.max(r.width, right - r.left), r.height);
		};
	}
}

export function syncFlyouts() {
	for (const el of document.querySelectorAll(BUTTONS)) patchButton(el);
}
