'use strict';
'require view';
'require rpc';
'require poll';
'require qmesh.sync as sync';
'require qmesh.optimize as optimize';

const setRole = rpc.declare({ object: 'mesh.control', method: 'set_role',
	params: ['role', 'id', 'url', 'pin', 'token', 'aps', 'batch'], reject: true });
const createJoinCode = rpc.declare({ object: 'mesh.control', method: 'join_code', reject: true });
const readJoinCode = rpc.declare({ object: 'mesh.control', method: 'active_join_code', reject: true });
const status = rpc.declare({ object: 'mesh.control', method: 'status', reject: true });
const save = rpc.declare({ object: 'mesh.control', method: 'save',
	params: ['ssid', 'key', 'roaming'], reject: true });
const readPassword = rpc.declare({object:'mesh.control',method:'password',reject:true});
const setBackhaul = rpc.declare({object:'mesh.control',method:'set_backhaul',params:['enabled'],reject:true});
const detect = rpc.declare({ object: 'mesh.control', method: 'detect', params: ['ids'], reject: true });
const setRadios = rpc.declare({ object: 'mesh.control', method: 'set_radios',
    params: ['id', 'changes'], reject: true });
const revoke = rpc.declare({ object: 'mesh.control', method: 'revoke', params: ['id'], reject: true });

const codePrefix = 'MESH2.';
const legacyCodePrefix = 'MESH1.';

function validControllerUrl(url) {
	return /^https:\/\/(?:[A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::[0-9]{1,5})?$/.test(url);
}

function encodeJoinCode(settings) {
	return codePrefix + btoa(JSON.stringify(settings)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalizeJoinCode(code) {
	return code.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
}

function decodeJoinCode(code) {
	code = normalizeJoinCode(code);
	const legacy = code.startsWith(legacyCodePrefix);
	const prefix = legacy ? legacyCodePrefix : codePrefix;
	const payload = code.slice(prefix.length);
	if (!code.startsWith(prefix) || code.length > 1024 || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(payload)) throw new Error();
	const settings = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
	if (!settings || typeof settings.url !== 'string' || !validControllerUrl(settings.url) ||
	    typeof settings.pin !== 'string' || !/^sha256\/\/[A-Za-z0-9+/]{43}=$/.test(settings.pin)) throw new Error();
	if (legacy) {
		if (typeof settings.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(settings.id) ||
		    typeof settings.token !== 'string' || !/^[a-f0-9]{64}$/.test(settings.token)) throw new Error();
		return { url: settings.url, pin: settings.pin, id: settings.id, token: settings.token };
	}
	if (typeof settings.batch !== 'string' || !/^[a-f0-9]{64}$/.test(settings.batch)) throw new Error();
	return { url: settings.url, pin: settings.pin, batch: settings.batch };
}

function card(title, body) {
	return E('section', { class: 'qm-card' }, [
		E('div', { class: 'qm-card-head' }, [E('h3', {}, title)]), body
	]);
}

function backhaulLabel(mode) {
    return ({wired:'有线优先', 'wired-relay':'有线（为对端中继）', wireless:'无线回传', isolated:'无线互联／上级断开', failed:'回传不可用', disabled:'有线', starting:'回传启动中'})[mode] || '有线';
}
function tile(label, value) {
	return E('div', { class: 'qm-tile' }, [E('span', {}, label), E('strong', {}, [typeof value === 'string' ? document.createTextNode(value) : value])]);
}

return view.extend({
	async load() {
		const state = await status();
		if (state.role === 'controller' && L.hasViewPermission()) {
			state.batchReadStarted = performance.now();
			state.currentBatch = await readJoinCode().catch(() => null);
		}
		return state;
	},
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render(initial) {
		const writable = L.hasViewPermission();
        const page = location.pathname.split('/').filter(Boolean).pop();
        const pageMode = ['nodes', 'tuning'].includes(page) ? page : 'general';
        let latestState = initial;
        let detectJob = null;
        const tuningSelected = new Set();
        const selectAll = E('input', {type:'checkbox', 'aria-label':'全选调优设备'});
        const selectionNote = E('span', {class:'qm-selection-note'});
        selectAll.addEventListener('change', () => {
            for (const node of latestState.nodes) {
                if (selectAll.checked) tuningSelected.add(node.id); else tuningSelected.delete(node.id);
            }
            renderTuning(latestState);
        });
        const detectButton = E('button', {type:'button', class:'qm-primary'}, '自动检测');
        const detectProgress = E('span', {role:'status', class:'qm-detect-progress'});
        detectButton.addEventListener('click', async () => {
            if (detectJob || !tuningSelected.size) return;
            detectButton.disabled = true;
            try {
                const result = await detect([...tuningSelected].join(' '));
                if (!result.ok) throw new Error(result.message);
                if (!result.count) {
                    detectProgress.textContent = '没有可检测的在线节点，或节点已有检测任务。';
                    detectButton.disabled = false;
                    return;
                }
                detectJob = { request:result.request, ids:result.ids.split(' '), started:result.started, deadline:Date.now()+120000 };
                detectButton.textContent = '检测中…';
                renderTuning(latestState);
                updateDetection(latestState);
            } catch (error) {
                detectProgress.textContent = error.message || '检测请求失败';
                detectButton.disabled = false;
            }
        });
        function updateDetection(state) {
            if (!detectJob) return;
            const selected = detectJob.ids.map(id => state.nodes.find(n => n.id === id));
            const done = selected.filter(n => n?.survey_ack === detectJob.request);
            const fresh = n => radiosOf(n).filter(([device])=>device!==n.backhaul_radio).length > 0 && radiosOf(n).filter(([device])=>device!==n.backhaul_radio).every(([device]) => {
                const sample = (n.survey || '').split(' ').find(s => s.startsWith(device+':'))?.split(':');
                return sample && Number(sample[1]) >= detectJob.started && !!sample[2];
            });
            detectProgress.textContent = '已完成 ' + done.length + ' / ' + selected.length + ' 台，正在重新采集…';
            if (done.length === selected.length || Date.now() >= detectJob.deadline) {
                const failures = selected.filter(n => !n || n.survey_ack !== detectJob.request || !fresh(n));
                detectProgress.textContent = failures.length
                    ? '检测结束，' + failures.length + ' 台失败、数据不足或超时；请检查节点后重试。'
                    : '检测完成，已根据最新数据更新调优方案。';
                detectButton.disabled = false;
                detectButton.textContent = '自动检测';
                detectJob = null;
                renderTuning(state);
            }
        }
        const tuningRows = E('div', { class: 'qm-tuning-list' });
        const tuningApply = E('button', { type: 'button', class: 'qm-primary' }, '应用调优方案');
        let tuningPlan = new Map();
		const notice = E('p', { class: 'qm-message', role: 'status', hidden: '' });
		const summary = E('div', { class: 'qm-summary' });
		const rows = E('tbody');
		const joinCode = E('input', { type: 'text', readonly: '', autocomplete: 'off' });
		const copyCode = E('button', { type: 'button', class: 'qm-remove qm-copy-code', disabled: '' }, '复制接入码');
		const countdown = E('span', { role: 'timer' });
		const credential = E('div', { hidden: '' }, [
			E('label', { class: 'qm-field' }, [E('span', {}, '接入码（含令牌）'), joinCode]),
			E('div', { class: 'qm-field' }, [
				E('span'), E('div', { class: 'qm-code-actions' }, [copyCode, countdown])
			])
		]);
		let deadline = 0;
		let countdownTimer;
		let copiedTimer;

		function updateCountdown() {
			const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
			const minutes = Math.floor(seconds / 60);
			countdown.textContent = seconds
				? '剩余 ' + minutes + ':' + String(seconds % 60).padStart(2, '0')
				: '已过期';
			copyCode.disabled = !seconds;
			if (!seconds) clearInterval(countdownTimer);
		}

		copyCode.addEventListener('click', async () => {
			updateCountdown();
			if (copyCode.disabled) return;
			try {
				if (!navigator.clipboard) throw new Error();
				await navigator.clipboard.writeText(joinCode.value);
			} catch {
				joinCode.focus();
				joinCode.select();
				let copied = false;
				try { copied = document.execCommand('copy'); } catch {}
				if (!copied) {
					report('接入码已选中，请手动复制。');
					return;
				}
			}
			clearTimeout(copiedTimer);
			copyCode.textContent = '✓ 已复制';
			copyCode.classList.add('qm-copied');
			copiedTimer = setTimeout(() => {
				copyCode.classList.remove('qm-copied');
				copyCode.textContent = '复制接入码';
			}, 1400);
			report('接入码已复制。');
		});

		function report(message) {
			notice.textContent = message;
			notice.hidden = !message;
		}

		async function act(button, action) {
			button.disabled = true;
			try {
				const result = await action();
				if (!result.ok) throw new Error(result.message);
				report(result.message || '注册令牌已生成。');
				await refresh();
			} catch (error) {
				report(error.message || 'MESH 请求失败。');
			} finally {
				button.disabled = false;
			}
		}

		const radioDrafts = new Map();
		const nodeNames = new Map();
		let submittingChannels = false;
		const applyChannels = E('button', { type: 'button', class: 'qm-primary',
			title: '应用无线参数时，受影响的 AP 可能短暂中断无线连接' }, '应用更改');

		function updateApplyChannels() {
			applyChannels.disabled = submittingChannels || !radioDrafts.size;
		}

        async function submitRadios(drafts) {
            if (submittingChannels || !drafts.size) return;
            if (!confirm('将向 ' + drafts.size + ' 个节点应用无线参数，受影响的无线连接可能短暂中断。继续？')) return;
            submittingChannels = true;
            updateApplyChannels(); tuningApply.disabled = true;
            const controls = [...content.querySelectorAll('select:enabled, button:enabled')];
            controls.forEach(control => control.disabled = true);
            const changes = [...drafts];
            const results = await Promise.allSettled(changes.map(async ([id, radios]) => {
                const encoded = [...radios].map(([device, values]) => [device, ...values].join(':')).join(',');
                const result = await setRadios(id, encoded);
                if (!result.ok) throw new Error(result.message);
                drafts.delete(id);
            }));
            const failures = results.flatMap((result, i) => result.status === 'rejected'
                ? [(nodeNames.get(changes[i][0]) || changes[i][0]) + '：' + (result.reason?.message || '提交失败')] : []);
            const submitted = results.length - failures.length;
            submittingChannels = false;
            controls.forEach(control => control.disabled = false);
            try { await refresh(); } catch (error) { failures.push(error.message); }
            updateApplyChannels();
            report('已提交 ' + submitted + ' 个节点，等待 AP 应用。' + failures.join('；'));
        }
        applyChannels.addEventListener('click', () => submitRadios(radioDrafts));
        tuningApply.addEventListener('click', () => {
            // Recompute before submission so a long-open page never applies stale scans.
            renderTuning(latestState);
            if (!tuningPlan.size) { report('没有可应用的有效调优方案，请等待新鲜检测数据。'); return; }
            submitRadios(tuningPlan);
        });
        function entries(raw, device) {
            return (raw || '').split(' ').find(entry => entry.startsWith(device + ':'))?.split(':') || [];
        }
        function radioValue(raw, device) {
            return (raw || '').split(' / ').filter(value => value.startsWith(device + ': '))
                .map(value => value.slice(device.length + 2)).join(' / ').replace(/（配置）/g, '');
        }
        function radiosOf(node) {
            return (node.radio_details || '').split(' ')
                .filter(entry => /^[A-Za-z0-9_]+:(?:2g|5g|6g)?:[0-9]*:[A-Za-z0-9]*$/.test(entry))
                .map(entry => entry.split(':'));
        }
        function frequency(band, device) {
            return ({'2g':'2.4 GHz','5g':'5 GHz','6g':'6 GHz'})[band] || device;
        }
        function renderChannels(node) {
            const draft = radioDrafts.get(node.id) || new Map();
            const disabled = submittingChannels || !node.online || node.channel_result === '等待 AP 应用';
            const rows = radiosOf(node).map(([device, band, current, country]) => {
                const label = frequency(band, device);
                const width = radioValue(node.width, device);
                const power = radioValue(node.power, device);
                const line = E('div', { class: 'qm-parameter-radio' }, [
                    E('strong', {}, label + ' · ' + (current || '—')),
                    E('span', {class:'qm-radio-meta'}, '频宽 ' + (width || '—') + ' · 国家 ' + (country || '—') + ' · 功率 ' + (power || '—'))
                ]);
                const meta = line.lastElementChild;
                if (!writable || !node.radio_bundle) return line;
                meta.remove();
                const values = entries(node.radios, device)[1]?.split(',') || [];
                const widths = entries(node.widths, device)[1]?.split(',') || [];
                const powers = entries(node.powers, device);
                const selectors = [];
                const form = E('div', { class: 'qm-opt-fields' });
                function field(name, list, suffix, index) {
                    const input = E('select', { 'aria-label': label + ' ' + name }, [
                        E('option', { value: '-' }, '保持当前'),
                        ...list.filter(Boolean).map(value => E('option', { value }, value + suffix))
                    ]);
                    input.value = draft.get(device)?.[index] || '-';
                    input.disabled = disabled || !list.length || node.backhaul_radio === device;
                    selectors.push(input);
                    input.addEventListener('change', () => {
                        const selected = selectors.map(s => s.value);
                        if (selected.some(v => v !== '-')) draft.set(device, selected);
                        else draft.delete(device);
                        if (draft.size) radioDrafts.set(node.id, draft); else radioDrafts.delete(node.id);
                        updateApplyChannels();
                    });
                    form.append(E('label', {}, [name, input]));
                }
                field('信道', values, '', 0);
                field('频宽', widths, ' MHz', 1);
                field('功率', powers[2]?.split(',') || [], powers[1] === '%' ? '%' : ' dBm', 2);
                const editor = E('details', {class:'qm-radio-editor'}, [
                    E('summary', {}, [meta, E('span', {class:'qm-adjust-label'}, draft.has(device) ? '调整参数 · 未应用' : '调整参数')]), form
                ]);
                for (const input of selectors) input.addEventListener('change', () => {
                    editor.querySelector('.qm-adjust-label').textContent = draft.has(device) ? '调整参数 · 未应用' : '调整参数';
                });
                line.append(editor);
                return line;
            });
            return E('div', { class: 'qm-radio-controls' }, rows.length ? rows : [node.channel || '—']);
        }
        function renderTuning(state) {
            const ids = new Set(state.nodes.map(node => node.id));
            for (const id of tuningSelected) if (!ids.has(id)) tuningSelected.delete(id);
            selectAll.checked = !!ids.size && tuningSelected.size === ids.size;
            selectAll.indeterminate = !!tuningSelected.size && tuningSelected.size < ids.size;
            selectAll.disabled = !!detectJob || submittingChannels;
            tuningPlan = new Map();
            const plans = state.nodes.map(node => {
                const proposed = new Map();
                const lines = radiosOf(node).map(([device, band, current]) => {
                    const advice = optimize.recommend(node, device, band, current);
                    const width = radioValue(node.width, device);
                    const currentWidth = width.match(/^(\d+)/)?.[1];
                    const channelChange = advice.ready && advice.channel !== current ? advice.channel : '-';
                    const widthChange = advice.ready && advice.width !== '-' && advice.width !== currentWidth ? advice.width : '-';
                    const applicable = node.online && node.radio_bundle && node.channel_result !== '等待 AP 应用';
                    if (applicable && advice.ready && (channelChange !== '-' || widthChange !== '-'))
                        proposed.set(device, [channelChange, widthChange, '-']);
                    return E('div', { class: 'qm-tuning-radio' }, [
                        E('strong', {}, frequency(band, device)),
                        E('p', {}, '当前：信道 ' + current + ' · 频宽 ' + (width || '—') + ' · 功率 ' + (radioValue(node.power, device) || '—')),
                        E('p', {}, advice.ready ? '建议：信道 ' + advice.channel + ' · 频宽 ' + (advice.width === '-' ? '保持' : advice.width + ' MHz') + ' · 功率保持当前' : '暂无可应用建议'),
                        E('small', {}, advice.reason),
                        ...(!applicable ? [E('small', {}, '节点离线、不支持批量参数，或正在等待 AP 应用；暂不加入方案。')] : [])
                    ]);
                });
                if (proposed.size && tuningSelected.has(node.id)) tuningPlan.set(node.id, proposed);
                const checkbox = E('input', {type:'checkbox', 'aria-label':'选择 ' + (node.host || node.id)});
                checkbox.checked = tuningSelected.has(node.id);
                checkbox.disabled = !!detectJob || submittingChannels || !writable;
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) tuningSelected.add(node.id); else tuningSelected.delete(node.id);
                    renderTuning(latestState);
                });
                return E('section', { class: 'qm-tuning-node' }, [
                    E('h4', {}, [E('label', {class:'qm-tuning-select'}, [checkbox, E('span', {}, (node.host || node.id) + ' · ' + (node.addr || '—'))])]),
                    ...(lines.length ? lines : [E('p', {}, '等待无线检测数据')])
                ]);
            });
            tuningRows.replaceChildren(...(plans.length ? plans : [E('p', {}, '暂无节点。')]));
            tuningApply.disabled = !!detectJob || submittingChannels || !tuningPlan.size || !writable;
            tuningApply.textContent = '应用调优方案（已选 ' + tuningSelected.size + ' 台）';
            selectionNote.textContent = '其中 ' + tuningPlan.size + ' 台有可应用的改动';
            detectButton.disabled = !!detectJob || !tuningSelected.size || submittingChannels;
        }

		function update(state) {
            latestState = state;
            renderTuning(state);
            updateDetection(state);
			const isAP = state.role === 'ap';
			controllerPanels.hidden = isAP;
			summary.replaceChildren(tile('本机角色', isAP ? 'AP' : '控制器'), tile('回传方式', backhaulLabel(state.backhaul)),
				isAP ? tile('连接状态', sync.label(state.ap_synced)) :
					tile('已注册节点', String(state.nodes.length)));
			const ids = new Set(state.nodes.map(node => node.id));
			for (const id of radioDrafts.keys()) {
				if (!ids.has(id)) radioDrafts.delete(id);
			}
			nodeNames.clear();
			const nodeRows = state.nodes.map(node => {
				const name = node.host || (node.seen ? node.id : '等待接入');
				nodeNames.set(node.id, name);
				const seen = node.seen ? new Date(node.seen * 1000) : null;
				const elapsed = seen ? Math.max(0, Math.floor((Date.now() - seen.getTime()) / 1000)) : 0;
				const age = elapsed < 60 ? elapsed + ' 秒前' : elapsed < 3600 ?
					Math.floor(elapsed / 60) + ' 分钟前' : elapsed < 86400 ?
						Math.floor(elapsed / 3600) + ' 小时前' : Math.floor(elapsed / 86400) + ' 天前';
				const values = [
					E('div', {}, [E('strong', {}, name),
						E('small', {}, node.addr || '—')]),
					renderChannels(node),
					document.createTextNode(String(node.clients ?? '—')),
					E('div', {}, [
						E('div', { class: 'qm-node-status' }, [sync.online(node.online),
							sync.label(!node.error && node.applied && node.applied === state.revision, node.error)]),
						E('small', seen ? { title: seen.toLocaleString() } : {}, seen ? '上报于 ' + age : '等待上报'),
                        ...(node.backhaul ? [E('small', {}, '回传：' + backhaulLabel(node.backhaul))] : [])
					])
				];
				if (writable) {
					const deleteButton = E('button', { type: 'button', class: 'qm-remove' }, '删除');
					deleteButton.disabled = submittingChannels;
					deleteButton.addEventListener('click', () => {
						if (confirm('删除节点 ' + name + '？删除后该节点需重新注册。')) {
							act(deleteButton, async () => {
								const result = await revoke(node.id);
								if (result.ok) {
									radioDrafts.delete(node.id);
									return { ...result, message: '节点 ' + name + ' 已删除。' };
								}
								return result;
							});
						}
					});
					values.push(E('div', { class: 'qm-node-actions' }, [
						deleteButton,
						...(node.channel_result ? [E('small', {}, node.channel_result)] : [])
					]));
				}
				const cells = values.map((value, index) => E('td', { 'data-label': columns[index] }, [value]));
				return E('tr', {}, cells);
			});
			rows.replaceChildren(...(nodeRows.length ? nodeRows : [
				E('tr', {}, [E('td', { colspan: columns.length, class: 'qm-empty' }, '暂无节点。生成接入码后，在无线节点上配置 MESH Agent。')])
			]));
			updateApplyChannels();
		}

		async function refresh() {
			update(await status());
		}

		function form(fields, title, submit) {
			const button = E('button', { type: 'submit', class: 'qm-primary' }, title);
			const element = E('form', { class: 'qm-body' }, [...fields, E('div', { class: 'qm-form-actions' }, [button])]);
			element.addEventListener('submit', event => {
				event.preventDefault();
				submit(button);
			});
			return element;
		}

		const ssid = E('input', { type: 'text', value: initial.ssid, maxlength: 32, required: '' });
		const key = E('input', { id:'qm-wpa2-key', type: 'password', minlength: 8, maxlength: 63, autocomplete: 'new-password', placeholder:initial.has_key ? '********' : '', required:initial.has_key ? null : '' });
        let savedKeyUntouched = !!initial.has_key;
        key.addEventListener('input', () => { savedKeyUntouched = false; });
        const eye = E('button', {type:'button', class:'qm-password-eye', 'aria-label':'显示密码', 'aria-pressed':'false', title:'显示密码'});
        function updateEye() {
            const visible = key.type === 'text';
            eye.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
            eye.setAttribute('aria-pressed', String(visible));
            eye.title = visible ? '隐藏密码' : '显示密码';
            eye.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' + (visible ? '<path d="m3 3 18 18"/>' : '') + '</svg>';
        }
        eye.addEventListener('click', async () => {
            eye.disabled = true;
            try {
                if (key.type === 'password' && savedKeyUntouched && !key.value) {
                    const result = await readPassword();
                    if (!result.ok) throw new Error(result.message);
                    key.value = result.key;
                }
                key.type = key.type === 'password' ? 'text' : 'password'; updateEye();
            } catch(error) { report(error.message || '读取密码失败'); }
            finally {eye.disabled=false;}
        });
        updateEye();
		const roaming = E('input', { type: 'checkbox', role: 'switch' });
		roaming.checked = initial.roaming;

		const profile = form([
			E('label', { class: 'qm-field' }, [E('span', {}, 'SSID'), ssid]),
			E('div', { class: 'qm-field' }, [E('label', {for:'qm-wpa2-key'}, 'WPA2 密码'), E('div', {class:'qm-password-wrap'}, [key, eye])]),
			E('label', { class: 'qm-field' }, [E('span', {}, ['无缝漫游', E('small', {}, '启用 802.11r / k / v')]),
				E('span', { class: 'qm-switch' }, [roaming, E('span', { class: 'qm-track', 'aria-hidden': 'true' })])])
		], '同步配置', button => {
			if (confirm('同步后，已注册节点会更新所选 AP 的无线配置。继续？'))
				act(button, async () => {
					const result = await save(ssid.value, key.value, roaming.checked);
					if (result.ok) { key.value = ''; key.type = 'password'; key.placeholder='********'; key.required=false; savedKeyUntouched=true; updateEye(); }
					return result;
				});
		});

		function showJoinCode({ url, pin, batch, remaining }, started) {
			joinCode.value = encodeJoinCode({ url, pin, batch });
			credential.hidden = false;
			clearInterval(countdownTimer);
			deadline = started + remaining * 1000;
			countdownTimer = setInterval(() => {
				if (credential.isConnected) updateCountdown();
				else clearInterval(countdownTimer);
			}, 1000);
			updateCountdown();
		}

		const registration = form([credential], '生成接入码', button => act(button, async () => {
			const started = performance.now();
			const result = await createJoinCode();
			if (!result.ok) return result;
			showJoinCode(result, started);
			return { ok: true, message: '批量接入码已生成，可复制到多台 AP。' };
		}));
		if (initial.currentBatch?.ok && initial.currentBatch.remaining > 0)
			showJoinCode(initial.currentBatch, initial.batchReadStarted);

		function roleField(label, input) {
			return E('label', { class: 'qm-field' }, [E('span', {}, label), input]);
		}

		const role = E('select', {}, [
			E('option', { value: 'controller' }, '控制器'),
			E('option', { value: 'ap', disabled: !initial.agent_installed || !initial.available_aps ? '' : null }, 'AP')
		]);
		role.value = initial.role;
		let joinSettings;
		const pastedCode = E('input', { type: 'password', autocomplete: 'off',
			placeholder: initial.agent_id ? '留空沿用已保存的接入资料' : '粘贴控制器生成的接入码' });
		pastedCode.required = !initial.agent_id;
		function validatePastedCode() {
			joinSettings = undefined;
			pastedCode.setCustomValidity('');
			const code = normalizeJoinCode(pastedCode.value);
			if (!code) {
				report('');
				return;
			}
			try {
				joinSettings = decodeJoinCode(code);
				report('接入码有效，请勾选无线接口后应用角色。');
			} catch {
				pastedCode.setCustomValidity('接入码无效，请重新复制完整接入码。');
				report(pastedCode.validationMessage);
			}
		}
		pastedCode.addEventListener('input', validatePastedCode);
		pastedCode.addEventListener('paste', event => {
			const text = event.clipboardData?.getData('text/plain');
			if (!text) return;
			event.preventDefault();
			pastedCode.value = normalizeJoinCode(text);
			validatePastedCode();
		});
		const available = initial.available_aps.split(/\s+/).filter(Boolean);
		const selectedAps = (initial.agent_aps || '').split(/\s+/);
		const apOptions = available.map(iface => {
			const box = E('input', { type: 'checkbox', value: iface });
			box.checked = selectedAps.includes(iface);
			return box;
		});
		const apFields = E('div', {}, [
			roleField('接入码', pastedCode),
			E('div', { class: 'qm-field' }, [E('span', {}, '无线接口'),
				E('div', { class: 'qm-ap-options' }, apOptions.map(box =>
					E('label', {}, [box, document.createTextNode(' ' + box.value)])))])
		]);
		const updateRoleFields = () => {
			apFields.hidden = role.value !== 'ap';
			for (const input of apFields.querySelectorAll('input')) input.disabled = apFields.hidden;
		};
		role.addEventListener('change', updateRoleFields);
		updateRoleFields();
		const roleForm = form([
			roleField('角色', role),
			...(!initial.available_aps ? [E('p', {}, '本机没有已启用的无线 AP 接口。')] :
				!initial.agent_installed ? [E('p', {}, '安装 MESH Agent 后可切换为 AP。')] : []),
			apFields
		], '应用角色', button => {
			const selected = role.value;
			const aps = apOptions.filter(box => box.checked).map(box => box.value).join(' ');
			if (selected === 'ap' && !aps) {
				report('请至少选择一个无线接口。');
				return;
			}
			if (selected !== initial.role && !confirm(selected === 'ap'
				? '切换为 AP 后，本机将停止给其他节点下发配置，并接收上级控制器的配置。继续？'
				: '切换为控制器后，本机将停止接收上级控制器的配置。继续？')) return;
			act(button, async () => {
				const { id = '', url = '', pin = '', token = '', batch = '' } = selected === 'ap' ? joinSettings || {} : {};
				const result = await setRole(selected, id, url, pin, token, aps, batch);
				if (result.ok) {
					initial.role = selected;
                    if (selected !== 'controller') { location.replace(L.url('admin/network/qmesh/general') + '?mesh_role=' + selected + '&_=' + Date.now()); return result; }
                    location.replace(L.url('admin/network/qmesh/general') + '?mesh_role=' + selected + '&_=' + Date.now());
					pastedCode.value = '';
					pastedCode.setCustomValidity('');
					joinSettings = undefined;
					if (selected === 'ap') {
						pastedCode.required = false;
						pastedCode.placeholder = '留空沿用已保存的接入资料';
					}
				}
				return result;
			});
		});

		const backhaulSwitch = E('input', {type:'checkbox', role:'switch'});
        backhaulSwitch.checked = !!initial.backhaul_enabled;
        const backhaulForm = form([
            E('label', {class:'qm-field'}, [E('span', {}, '有线优先双回传'), E('span', {class:'qm-switch'}, [backhaulSwitch, E('span', {class:'qm-track', 'aria-hidden':'true'})])]),
            E('p', {}, '本机已配置配对的 2.4 GHz 无线备用链路。有线端口断开时切到无线，稳定恢复后切回有线；关闭前须恢复有线连接。')
        ], '应用设置', button => act(button, () => setBackhaul(backhaulSwitch.checked)));
        const columns = ['节点' , '无线参数', '客户端', '状态'];
		if (writable) columns.push('操作');
        const nodePanel = card('节点列表', E('div', { class: 'qm-table' }, [
            E('table', { class: 'qm-node-table qm-node-list' }, [E('thead', {}, [E('tr', {}, columns.map(column => E('th', { scope:'col', 'data-label':column }, column)))]), rows]),
            ...(writable ? [E('div', { class: 'qm-node-footer' }, [applyChannels])] : [])
        ]));
        const tuningPanel = card('设备调优方案', E('div', { class:'qm-body' }, [
            ...(writable ? [E('div', {class:'qm-detect-toolbar'}, [E('label', {class:'qm-tuning-select'}, [selectAll, E('span', {}, '全选')]), detectButton, detectProgress])] : []),
            E('p', {}, '根据最新检测数据提出方案，仅在点击应用后下发。功率缺少覆盖证据时保持当前；可能影响无线连接，请核对后再应用。'),
            tuningRows, ...(writable ? [E('div', { class:'qm-form-actions' }, [selectionNote, tuningApply])] : [])
        ]));
        const controllerPanels = E('div', {}, pageMode === 'general'
            ? [...(writable ? [card('无线配置', profile), card('节点注册', registration)] : [])]
            : [pageMode === 'nodes' ? nodePanel : tuningPanel]);
        const content = E('div', { class:'qmesh ' + sync.themeClass() }, [
            E('link', { rel:'stylesheet', href:L.resource('qmesh/style.css', '?v=0.1.63') }),
            notice, summary,
            ...(pageMode === 'general' && writable ? [card('本机角色', roleForm), ...(initial.backhaul_available ? [card('双回传', backhaulForm)] : [])] : []),
            controllerPanels,
            ...(pageMode !== 'general' && initial.role === 'ap' ? [E('p', {}, '本机为 AP，请到上级控制器管理节点和调优方案。')] : [])
        ]);
		update(initial);
		poll.add(() => {
			if (submittingChannels || radioDrafts.size || rows.querySelector('.qm-radio-editor[open]') || document.activeElement?.matches('.qm-radio-controls select')) return;
			return refresh().catch(error => report(error.message || '无法刷新节点状态。'));
		}, 10);
		return E('div', { class: 'cbi-map', id: 'cbi-qmesh' }, [
			E('h2', { name:'content' }, 'QMESH - ' + ({general:'常规设置',nodes:'节点列表',tuning:'设备调优'})[pageMode]), content
		]);
	}
});
