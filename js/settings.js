// LCARSv2 settings runtime: tags the popup, and mirrors the current page's
// title into the top rail as its title interruption (Steam's own header sits
// inside a clipped wrapper, so the rail copy is drawn at window level).

const KEY = '__lcarsV2SettingsV1';

function install() {
	if (window[KEY]) return;
	document.documentElement.classList.add('lc-settings');

	const title = document.createElement('div');
	title.className = 'lc-settings-title';
	title.setAttribute('aria-hidden', 'true');
	document.body.appendChild(title);

	let queued = false;
	const sync = () => {
		queued = false;
		if (!title.isConnected) document.body.appendChild(title);
		const text = document.querySelector('.DialogContent_InnerWidth > .DialogHeader')?.textContent.trim() || '';
		if (title.textContent !== text) title.textContent = text;
	};
	const observer = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(sync); } });
	observer.observe(document.body, { childList: true, subtree: true, characterData: true });
	window[KEY] = { stop() { observer.disconnect(); title.remove(); delete window[KEY]; } };
	sync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
