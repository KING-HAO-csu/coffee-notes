const assert=require('node:assert/strict'),test=require('node:test'),C=require('./core.js');
test('样例完整，水粉比与日期有效',()=>{const s=C.seed();assert.equal(C.validateState(s),'');assert.equal(C.ratio(15,225),'1:15');assert.equal(C.ratio(0,200),'未记录');assert.equal(C.validDate('2026-02-30'),false);assert.equal(C.duration(174),'2:54');});
test('补记必填水量、实际用时和喜欢程度；阶段可不完整',()=>{const s=C.seed(),r=C.clone(s.records[0]);r.water=null;r.duration=null;r.rating=0;assert.deepEqual(Object.keys(C.validateRecord(r,s)).sort(),['duration','rating','stages','water']);r.water=225;r.duration=174;r.rating=5;r.stages=[{time:null,water:30},{time:null,water:null}];assert.deepEqual(C.validateRecord(r,s),{});});
test('累计水量不倒退、不超过总量，阶段开始时间不倒退',()=>{const s=C.seed(),r=C.clone(s.records[0]);r.stages=[{time:30,water:80},{time:20,water:70}];assert.ok(C.validateRecord(r,s).stages);r.stages=[{time:0,water:226}];assert.ok(C.validateRecord(r,s).stages);r.stages=[{time:175,water:100}];assert.ok(C.validateRecord(r,s).stages);});
test('三个研磨模式及数值范围',()=>{const g=C.seed().gear[0];assert.equal(C.validateConfig(g),'');assert.equal(C.grindLabel({mode:'turns',turns:1,clicks:2}),'1 圈 2 格');Object.assign(g,{mode:'level',min:1,max:2,step:.5});assert.deepEqual(C.levelOptions(g),[1,1.5,2]);g.step=0;assert.ok(C.validateConfig(g));Object.assign(g,{mode:'particle',values:[400,600],unit:'µm'});assert.equal(C.validateConfig(g),'');g.values=[400,NaN];assert.ok(C.validateConfig(g));});
test('上一杯和最高评分同豆对照不包括自身及到店品饮',()=>{const s=C.seed(),r=s.records[0];assert.equal(C.reference(s,r,'previous').id,'brew_1');assert.equal(C.reference(s,r,'best').id,'brew_1');s.records[1].deletedAt=Date.now();assert.equal(C.reference(s,r,'best').id,'brew_2');});
test('损坏的存储保留原文，不自动覆盖',()=>{let writes=0;const raw='{broken',fake={getItem:()=>raw,setItem:()=>writes++};const result=C.read(fake);assert.equal(result.blocked,true);assert.equal(result.raw,raw);assert.equal(writes,0);});
test('拒绝畸形备份并保持旧资料；配额失败不报告成功',()=>{const s=C.seed(),bad=C.clone(s);bad.records[0].stages={bad:true};assert.ok(C.validateState(bad));const old=JSON.stringify(s);let stored=old;const fake={setItem:(k,v)=>{stored=v;}};assert.equal(C.write(fake,bad).ok,false);assert.equal(stored,old);const quota={setItem:()=>{throw Object.assign(new Error(),{name:'QuotaExceededError'});}};assert.equal(C.write(quota,s).ok,false);assert.match(C.write(quota,s).message,/填写内容已保留/);});
test('文本转义防止备注形成 HTML',()=>{assert.equal(C.escape('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');assert.equal(C.photo('javascript:alert(1)'),false);});
test('恶意备份的评级、日期、阶段、草稿和嵌套字段被拒绝且不覆盖旧记录',()=>{
  const payload='"><img src=x onerror="globalThis.injected=true">';
  const mutations=[
    s=>s.shops[0].rating=payload,
    s=>s.reviews.push({id:'review_attack',beanId:'bean_1',date:payload}),
    s=>s.records.find(r=>r.kind==='cafe').stages=[{water:payload,time:0}],
    s=>s.records[0].snapshot={grinder:{toString:payload}},
    s=>s.records[0].beanInfo={producer:{toString:payload}},
    s=>s.drafts.push({id:'draft_attack',kind:'brew',date:payload}),
    s=>s.gear[0].clicks=payload,
    s=>s.settings.theme=payload,
    s=>s.records[0].beanId=payload,
    s=>s.recipes[0].dose=payload,
    s=>s.beans[0].photo='data:image/svg+xml;base64,PHN2Zz4=',
  ];
  for(const mutate of mutations){const s=C.seed();mutate(s);let writes=0;assert.notEqual(C.validateState(s),'');assert.equal(C.write({setItem:()=>writes++},s).ok,false);assert.equal(writes,0);}
});
test('普通文字中的标点与合法未完成草稿仍可备份',()=>{
  const s=C.seed();s.beans[0].notes='<花香> & "甜感"';
  s.drafts.push({id:'draft_valid',recordId:'cup_new',kind:'brew',date:C.today(),rating:0,dose:null,water:null,duration:null,stages:[{water:30,time:null}],grind:{mode:'turns',turns:1},flavors:[],editorExisting:false});
  assert.equal(C.validateState(s),'');assert.equal(C.validateState(C.clone(s)),'');
});
test('主题色支持旧备份、五种配色往返恢复，并拒绝未知或注入值',()=>{
  const legacy=C.seed();delete legacy.settings.accent;assert.equal(C.validateState(legacy),'');
  assert.equal(C.ACCENTS.length,5);
  for(const accent of C.ACCENTS){for(const theme of ['light','dark']){const s=C.clone(legacy);s.settings.accent=accent.id;s.settings.theme=theme;let saved;assert.equal(C.write({setItem:(key,value)=>saved=value},s).ok,true);const restored=C.read({getItem:()=>saved});assert.equal(restored.blocked,undefined);assert.equal(restored.state.settings.accent,accent.id);assert.equal(restored.state.settings.theme,theme);assert.deepEqual(restored.state.records,legacy.records);}}
  for(const invalid of ['unknown','"><img src=x>',{},null,1]){const s=C.clone(legacy);s.settings.accent=invalid;assert.notEqual(C.validateState(s),'');}
});
