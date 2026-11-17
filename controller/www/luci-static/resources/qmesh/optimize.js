'use strict';
'require baseclass';

// Conservative scan heuristic, not a measurement of room coverage or airtime.
function recommend(node, device, band, current) {
    if (node.backhaul_radio === device) return {ready:false, reason:'此频段用于无线回传，保持固定参数，不参与调优。'};
    const entry = (node.survey || '').split(' ').find(s => s.split(':')[0] === device);
    const parts = (entry || '').split(':');
    const age = Math.floor(Date.now() / 1000) - Number(parts[1]);
    const samples = (parts[2] || '').split(',').map(s => s.split('~').map(Number))
        .filter(s => s.length === 3 && s[0] > 0 && s[1] < 0 && s[1] >= -110 && s[2] > 0);
    if (!entry || age < 0 || age > 600 || !samples.length)
        return { ready: false, reason: '扫描数据不足或超过 10 分钟，保持当前设置。' };
    const values = (node.radios || '').split(' ').find(s => s.startsWith(device + ':'));
    let channels = (values?.split(':')[1] || '').split(',').map(Number).filter(n => n > 0);
    if (band === '2g') channels = channels.filter(n => [1, 6, 11].includes(n));
    else if (band === '5g') channels = channels.filter(n => [36, 40, 44, 48, 149, 153, 157, 161].includes(n));
    else return { ready: false, reason: '此频段暂不提供优化建议。' };
    const score = ch => samples.reduce((sum, [other, signal, count]) => {
        const overlap = band === '2g' ? Math.max(0, 1 - Math.abs(ch - other) / 5) : (ch === other ? 1 : 0);
        return sum + overlap * Math.pow(10, (signal + 100) / 10) * Math.min(count, 4);
    }, 0);
    channels.sort((a, b) => score(a) - score(b) || a - b);
    if (!channels.length) return { ready: false, reason: '没有可用的候选信道。' };
    const best = channels[0];
    const keep = channels.includes(Number(current)) && score(Number(current)) <= score(best) * 1.25 + 1;
    const channel = keep ? String(current) : String(best);
    const widths = ((node.widths || '').split(' ').find(s => s.startsWith(device + ':'))?.split(':')[1] || '').split(',');
    // Unknown neighbor widths: 20 MHz avoids claiming a clear 40/80 MHz block.
    const width = widths.includes('20') ? '20' : '-';
    return { ready: true, channel, width, power: '-',
        reason: '扫描 ' + samples.reduce((n, s) => n + s[2], 0) + ' 个邻居 BSS，' + age + ' 秒前采集。' +
            (keep ? '当前信道评分接近最优，建议保持。' : '候选信道 ' + channel + ' 的邻居干扰评分较低。') +
            '频宽建议 20 MHz，优先减少重叠；功率保持当前，缺少房间覆盖证据。邻居频宽与信道占用率未测得，建议仅供人工评估。' };
}
return baseclass.extend({ recommend });
