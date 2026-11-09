// LCARSv2 sidebar (round 6). Outside the OPS home the library sidebar is
// Steam's own game list in both OPS and SHELVES (user, 2026-10-30), so it keeps
// its collections, filters, right-click menu and drag. This tags each row with
// its appid and status so css/sidebar.css can draw it like a register record.
// The list is virtualised and React reuses row nodes for other games while
// scrolling, so rows are re-read on every change, not tagged once.

import { host, statusOf } from './data.js';

const KEY = '__lcarsV2SidebarV1';
const LIST = '._9sPoVBFyE_vE87mnZJ5aB';
const ROW = '._2-O4ZG0KrnSrzISHBKctFQ';

// The row's list-item component, a few fibers up, carries the appid prop.
function appidOf(row) {
	const key = Object.keys(row).find(k => k.startsWith('__reactFiber$'));
	let f = key && row[key];
	for (let d = 0; f && d < 10; d++, f = f.return) {
		const id = f.memoizedProps?.appid;
		if (id) return id;
	}
	return 0;
}

export function install() {
	window[KEY]?.stop();
	let queued = 0;

	const tag = () => {
		queued = 0;
		const list = document.querySelector(LIST);
		if (!list) return;
		const store = host().appStore;
		for (const row of list.querySelectorAll(ROW)) {
			const id = appidOf(row);
			if (!id) continue;
			const ov = store?.GetAppOverviewByAppID?.(id);
			const tone = ov ? statusOf(ov).tone : 'off';
			// Data attributes are outside the observer's filter, so writing them cannot loop.
			if (row.dataset.appid !== String(id)) row.dataset.appid = id;
			if (row.dataset.tone !== tone) row.dataset.tone = tone;
		}
	};
	const queue = () => { if (!queued) queued = requestAnimationFrame(tag); };

	const observer = new MutationObserver(queue);
	observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
	const poll = setInterval(queue, 2000); // install/launch state changes don't always touch the DOM

	window[KEY] = {
		stop() {
			observer.disconnect();
			clearInterval(poll);
			if (queued) cancelAnimationFrame(queued);
			delete window[KEY];
		},
	};
	queue();
}
