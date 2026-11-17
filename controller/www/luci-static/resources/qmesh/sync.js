'use strict';
'require baseclass';

function indicator(positive, text) {
	return E('span', { class: positive ? 'qm-sync-ok' : 'qm-sync-failed' }, [
		document.createTextNode(text)
	]);
}

return baseclass.extend({
	themeClass() {
		// LuCI can use a different theme from the browser's color preference.
		const rgb = getComputedStyle(document.body).color.match(/\d+(?:\.\d+)?/g);
		if (!rgb || rgb.length < 3) return '';
		const [r, g, b] = rgb.map(Number);
		return .2126 * r + .7152 * g + .0722 * b > 160 ? 'qm-dark' : '';
	},

	label(synced, error) {
		const text = synced ? '已同步' : '未同步';
		return indicator(synced, error ? text + ' · ' + error : text);
	},

	online(online) {
		return indicator(online, online ? '在线' : '离线');
	}
});
