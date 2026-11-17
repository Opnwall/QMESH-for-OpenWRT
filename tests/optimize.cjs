const assert = require('node:assert/strict');
const fs = require('node:fs');
const { recommend } = new Function('baseclass', fs.readFileSync('controller/www/luci-static/resources/qmesh/optimize.js', 'utf8'))({extend: x => x});
const now = Math.floor(Date.now()/1000);
const node = { survey: `rai:${now}:36~-40~3,149~-90~1`, radios: 'rai:36,40,149,153', widths: 'rai:20,40,80' };
assert.equal(recommend(node,'rai','5g','36').ready,true);
assert.notEqual(recommend(node,'rai','5g','36').channel,'36');
assert.equal(recommend(node,'rai','5g','36').power,'-');
assert.equal(recommend(node,'rai','5g','36').width,'20');
assert.equal(recommend({...node,survey:`rai:${now-601}:36~-40~3`},'rai','5g','36').ready,false);
assert.equal(recommend({...node,survey:''},'rai','5g','36').ready,false);
assert.equal(recommend({...node,radios:'rai:52,56,60,64'},'rai','5g','64').ready,false);
assert.ok(['1','6','11'].includes(recommend({survey:`ra:${now}:8~-30~3`,radios:'ra:1,6,11',widths:'ra:20,40'},'ra','2g','8').channel));
console.log('optimization policy checks passed');

assert.equal(recommend({...node,backhaul_radio:'rai'},'rai','5g','36').ready,false);
