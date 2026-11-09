// LCARSv2 popup windows (round 6). Steam tells the main window about every window it
// opens, so any one without a theme of its own (Friends, Recordings & Screenshots,
// Special Offers, game Properties, Millennium's dialogs, ...) gets the LCARS skin here
// rather than a title patch per window, and toasts get theirs. It also adds the
// restart and reload commands to the account menu, which lives in its own window.

import { host } from './data.js';

const KEY = '__lcarsV2PopupsV1';
const SHEET = name => new URL(`../css/${name}`, import.meta.url).href;
const ITEM = '.contextMenuItem, [class*="contextMenuItem"]';

const isToast = name => /^notificationtoasts_/.test(name);
const isMenu = (name, doc) => /^contextmenu_/.test(name) || doc.documentElement.classList.contains('MillenniumWindow_ContextMenu');

function skin(popup) {
	const win = popup.window || popup.m_popup;
	const doc = win?.document;
	if (!doc?.head) return;
	const name = popup.GetName?.() || win.name || '';
	window.__lcarsSfxAttach?.(win); // Settings, menus and other popups sound like the main window
	// Windows with a theme patch (the main window, Settings, Sign in, menus) have their own sheet.
	if (/^SP /.test(name) && !isToast(name)) return;
	const skinned = doc.getElementById('lc-popup-skin');
	// A game's Properties has Settings' layout (page bank + content), so it gets Settings' skin.
	if (skinned && doc.querySelector('._2kwFFHckg8jvnwJfg9-la8') && !doc.documentElement.classList.contains('lc-settings')) {
		doc.documentElement.classList.add('lc-settings');
		skinned.href = SHEET('settings.css');
		const script = doc.createElement('script');
		script.type = 'module';
		script.src = new URL('./settings.js', import.meta.url).href;
		doc.head.append(script);
	}
	if (isMenu(name, doc) || skinned) return;
	if ([...doc.querySelectorAll('link[rel~="stylesheet"]')].some(l => l.href.includes('/themes/LCARSv2/css/') && !/palettes|clock|jingle/.test(l.href))) return;
	const link = doc.createElement('link');
	link.id = 'lc-popup-skin';
	link.rel = 'stylesheet';
	link.href = SHEET(isToast(name) ? 'toasts.css' : 'client-windows.css');
	doc.head.append(link);
	if (isToast(name)) window.__lcarsBeep?.('notify');
	doc.documentElement.classList.add('lc-window');
}

// Steam re-renders the menu's items, so this checks on every change inside it.
function accountItems(doc) {
	const sample = [...doc.querySelectorAll(ITEM)].find(n => /sign out|change account/i.test(n.textContent));
	if (!sample || doc.querySelector('.lc-acct-item')) return;
	const add = (label, run) => {
		const item = doc.createElement('div');
		item.className = `${sample.className} lc-acct-item`;
		item.textContent = label;
		item.addEventListener('click', run);
		sample.parentElement.append(item);
	};
	const sc = () => host().SteamClient;
	add('Reload Steam UI', () => sc().Browser.RestartJSContext());
	add('Restart Steam', () => sc().User.StartRestart(false));
}

export function install() {
	window[KEY]?.stop();
	const manager = host().g_PopupManager;
	if (!manager) return;
	const each = () => {
		for (const popup of manager.GetPopups?.() || []) {
			try {
				skin(popup);
				const doc = (popup.window || popup.m_popup)?.document;
				if (doc?.title === 'Account Menu') accountItems(doc);
				// Steam opens this one far taller than its messages need; the page fits this height
				// (css/store.css). Polled because the title arrives after the window does.
				if (doc?.title === 'Special Offers' && !doc.documentElement.dataset.lcSized) {
					doc.documentElement.dataset.lcSized = '1';
					(popup.window || popup.m_popup).SteamClient?.Window?.ResizeTo?.(706, 700, true);
				}
			} catch (_) {
				// A window closing under us.
			}
		}
	};
	const created = manager.AddPopupCreatedCallback?.(() => setTimeout(each, 0));
	const timer = setInterval(each, 1000); // menus re-render and windows load without telling us
	each();
	window[KEY] = {
		stop() {
			clearInterval(timer);
			created?.unregister?.();
			delete window[KEY];
		},
	};
}
