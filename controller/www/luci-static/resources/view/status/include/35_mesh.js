'use strict';
'require baseclass';
'require rpc';
'require qmesh.sync as sync';

const status = rpc.declare({ object: 'mesh.control', method: 'status', reject: true });

return baseclass.extend({
	title: 'MESH 列表',
	disableCache: true,

	load() {
		return status().catch(() => null);
	},

	render(state) {
		if (state?.role !== 'controller') return null;
		const columns = ['节点', '地址', '信道', '国家', '客户端', '在线状态', '最近上报', '同步状态'];
		const rows = (state.nodes || []).map(node => {
			const values = [
				node.host || (node.seen ? node.id : '等待接入'), node.addr || '—', node.channel || '—', node.country || '—',
				String(node.clients ?? '—'), sync.online(node.online),
				node.seen ? new Date(node.seen * 1000).toLocaleString() : '等待上报'
			];
			const cells = values.map((value, index) => E('td', { class: 'td', 'data-label': columns[index] }, [typeof value === 'string' ? document.createTextNode(value) : value]));
			cells.push(E('td', { class: 'td', 'data-label': '同步状态' }, [sync.label(!node.error && node.applied && node.applied === state.revision, node.error)]));
			return E('tr', { class: 'tr' }, cells);
		});
		if (!rows.length)
			rows.push(E('tr', { class: 'tr placeholder' }, [
				E('td', { class: 'td', colspan: columns.length }, '暂无已注册的 MESH 节点')
			]));
		const table = E('table', { class: 'table qm-node-table', id: 'mesh-overview-nodes' }, [
			E('thead', {}, [E('tr', { class: 'tr table-titles' }, columns.map(column =>
				E('th', { class: 'th', scope: 'col' }, column)))]),
			E('tbody', {}, rows)
		]);
		return E('div', { class: 'qm-overview ' + sync.themeClass() }, [E('link', { rel: 'stylesheet', href: L.resource('qmesh/style.css', '?v=0.1.50') }), table]);
	}
});
