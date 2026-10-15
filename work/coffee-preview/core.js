(function (root) {
  'use strict';
  const VERSION = 1;
  const ACCENTS = [{id:'forest',name:'森林绿'},{id:'coffee',name:'咖啡棕'},{id:'cream',name:'奶油米'},{id:'blue',name:'雾霾蓝'},{id:'berry',name:'莓果紫'}];
  const KEY = 'coffee-notes-preview-v1';
  const ROASTS = ['浅烘', '中浅烘', '中烘', '中深烘', '深烘', '不清楚'];
  const FLAVORS = {
    '酸感': ['明亮','活泼','多汁','柔和','圆润','尖锐'],
    '甜感': ['清甜','甜感饱满','甜感持久'],
    '苦感': ['柔和','尖锐','短暂','持久'],
    '口感': ['轻盈','醇厚','丝滑','奶油感','油润','粗糙','干涩','收敛'],
    '余韵': ['短暂','绵长','甜韵','苦味残留','干涩残留'],
    '花香与茶香': ['茉莉','玫瑰','洋甘菊','红茶','乌龙茶'],
    '果香': ['柑橘','柠檬','橙子','莓果','蓝莓','苹果','桃子','葡萄','热带水果','果干'],
    '坚果与可可': ['杏仁','榛子','花生','可可','黑巧克力'],
    '甜香': ['蜂蜜','焦糖','红糖','香草','枫糖'],
    '其他风味': ['麦芽','肉桂','酒香','发酵香','烟熏','木质','纸味','金属味']
  };
  const TYPES = ['手冲','美式','浓缩','拿铁','卡布奇诺','澳白','Dirty','摩卡','冷萃','创意特调'];
  const ORIGINS = ['埃塞俄比亚','哥伦比亚','巴西','肯尼亚','危地马拉','巴拿马','哥斯达黎加','中国云南','印度尼西亚','卢旺达','布隆迪','秘鲁','也门','萨尔瓦多','洪都拉斯','墨西哥','厄瓜多尔','尼加拉瓜','坦桑尼亚','乌干达','印度','越南','泰国','老挝','巴布亚新几内亚'];
  const METHODS = ['水洗','日晒','蜜处理','湿刨'];
  const WATER_TYPES = ['纯净水','矿泉水','过滤水','自来水','自配水','其他'];
  const clone = x => JSON.parse(JSON.stringify(x));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = prefix => prefix + '_' + (root.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  const number = x => x === '' || x === null || x === undefined ? null : (Number.isFinite(Number(x)) ? Number(x) : null);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate()-n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const duration = value => number(value) === null ? '未记录' : `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;
  const ratio = (dose, water) => number(dose)>0 && number(water)>0 ? `1:${+(water/dose).toFixed(2)}` : '未记录';
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s+'T12:00:00').toISOString().slice(0,10)===s;
  const active = state => state.records.filter(r => !r.deletedAt);
  const sorted = records => records.slice().sort((a,b) => b.date.localeCompare(a.date) || (b.createdAt||0)-(a.createdAt||0));
  const byId = (list,id) => list.find(x=>x.id===id);
  const photo = s => typeof s==='string' && s.length<850000 && /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(s);
  const object = value => value!==null && typeof value==='object' && !Array.isArray(value);
  const finite = value => typeof value==='number' && Number.isFinite(value);
  const optionalNumber = value => value===undefined || value===null || value==='' || finite(value);
  const referenceId = value => value===undefined || value==='' || (typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value));
  function validateOptionalData(item) {
    for(const key of ['dose','water','duration','referenceDuration','temp','rating','price','volume','createdAt','updatedAt']) if(!optionalNumber(item[key])) return '备份中的数值格式无效';
    for(const key of ['beanId','shopId','grinderId','dripperId','waterId','recipeId','recordId','sourceId']) if(!referenceId(item[key])) return '备份中的关联编号无效';
    for(const key of ['intensity','beanInfo','snapshot']) {
      if(item[key]!==undefined && (!object(item[key]) || Object.values(item[key]).some(v=>typeof v!=='string'||v.length>5000))) return '备份中的补充文字资料格式无效';
    }
    if(item.flavors!==undefined && (!Array.isArray(item.flavors) || item.flavors.length>100 || item.flavors.some(v=>typeof v!=='string'||v.length>150))) return '备份中的风味格式无效';
    if(item.stages!==undefined && (!Array.isArray(item.stages) || item.stages.length>30 || item.stages.some(v=>!object(v)||!optionalNumber(v.water)||!optionalNumber(v.time)))) return '备份中的分段格式无效';
    if(item.grind!==undefined && item.grind!==null) {
      const g=item.grind;
      if(!object(g)||!['level','turns','particle'].includes(g.mode)) return '备份中的研磨格式无效';
      for(const key of ['value','turns','clicks']) if(!optionalNumber(g[key])) return '备份中的研磨数值无效';
      if(g.unit!==undefined&&(typeof g.unit!=='string'||g.unit.length>200)) return '备份中的研磨单位无效';
    }
    if(item.photo!==undefined && item.photo!=='' && !photo(item.photo)) return '备份中图片格式不受支持';
    return '';
  }
  function validateRecord(r, state) {
    const e = {};
    if (!object(r)) return {record:'记录格式无效'};
    const optionalError=validateOptionalData(r);
    if(optionalError) return {record:optionalError};
    if (r.stages!==undefined && (!Array.isArray(r.stages) || r.stages.length>30 || r.stages.some(s=>!s || typeof s!=='object'))) return {stages:'分段注水格式无效'};
    if (r.flavors!==undefined && (!Array.isArray(r.flavors) || r.flavors.length>100 || r.flavors.some(s=>typeof s!=='string'||s.length>150))) return {flavors:'风味格式无效'};
    for (const key of ['dose','water','duration','temp','rating','price','volume']) if(r[key]!==undefined&&r[key]!==null&&r[key]!==''&&(typeof r[key]!=='number'||!Number.isFinite(r[key]))) e[key]='请填写有效数值';
    if(r.grind && (typeof r.grind!=='object'||!['level','turns','particle'].includes(r.grind.mode))) e.grind='研磨数据格式无效';
    if(r.grind?.mode==='turns' && (![r.grind.turns,r.grind.clicks].every(v=>Number.isInteger(v)&&v>=0))) e.grind='请完整选择圈数和格数，或留空不记录';
    if(r.grind && r.grind.mode!=='turns' && !(typeof r.grind.value==='number'&&Number.isFinite(r.grind.value))) e.grind='请选择有效的研磨数值';
    if (!['brew','cafe'].includes(r.kind)) e.kind = '请选择记录类型';
    if (!validDate(r.date)) e.date = '请选择有效日期';
    if (!Number.isInteger(number(r.rating)) || r.rating<1 || r.rating>5) e.rating = '请选择 1～5 星喜欢程度';
    if (r.kind==='brew') {
      if (!byId(state.beans,r.beanId)) e.beanId = '请选择一款豆子，或先建立豆子档案';
      if (!(number(r.dose)>0 && r.dose<=1000)) e.dose = '请填写大于 0 的粉量（克）';
      if (!(number(r.water)>0 && r.water<=20000)) e.water = '请填写大于 0 的总水量（克）';
      if (!Number.isInteger(number(r.duration)) || !(r.duration>0 && r.duration<3600)) e.duration = '请选择实际总用时，至少 1 秒';
      if (number(r.temp)!==null && !(r.temp>=0 && r.temp<=100)) e.temp = '水温请填 0～100 ℃，也可以留空';
      let lastAmount = 0, lastTime = -1;
      for (const [i,s] of (r.stages||[]).entries()) {
        if([s.water,s.time].some(v=>v!==undefined&&v!==null&&v!==''&&(typeof v!=='number'||!Number.isFinite(v)))) {e.stages='分段注水请使用有效的数值和时间';continue;}
        if (number(s.water)===null && number(s.time)===null) continue;
        if (number(s.water)===null || s.water<0 || s.water>r.water || s.water<lastAmount) e.stages = `第 ${i+1} 段累计水量应不小于前段，且不超过总水量`;
        if (number(s.water)!==null) lastAmount=s.water;
        if (number(s.time)!==null) {
          if (!Number.isInteger(s.time) || s.time<0 || s.time>r.duration || s.time<lastTime) e.stages='分段开始时间应依次增加，并不超过总用时';
          lastTime=s.time;
        }
      }
    } else {
      if (!byId(state.shops,r.shopId)) e.shopId='请选择咖啡店，或先新增店铺';
      if (!String(r.name||'').trim()) e.name='请填写菜单名称或你自己的叫法';
      if (number(r.price)!==null && r.price<0) e.price='价格不能小于 0';
    }
    return e;
  }
  function validateConfig(g) {
    if(!object(g)||!['grinder','dripper'].includes(g.kind)) return '请选择有效的器具种类';
    if (!String(g.name||'').trim()) return '请填写器具名称';
    if (g.kind!=='grinder') return '';
    if (!['level','turns','particle'].includes(g.mode)) return '请选择研磨度计量方式';
    if (g.mode==='level' && (![g.min,g.max,g.step].every(finite) || !(g.step>0) || g.max<g.min || (g.max-g.min)/g.step>500)) return '请设置有效的刻度范围和步长，选项最多 501 个';
    if (g.mode==='turns' && (!Number.isInteger(g.clicks) || g.clicks<1 || g.clicks>200 || !Number.isInteger(g.turns) || g.turns<0 || g.turns>30)) return '每圈格数须为 1～200 的整数，可选圈数为 0～30';
    if (g.mode==='particle' && (!Array.isArray(g.values) || !g.values.length || g.values.length>200 || g.values.some(v=>!finite(v)||v<=0) || typeof g.unit!=='string'||!g.unit.trim())) return '请按你的对照卡填写粒径数值和单位';
    return '';
  }
  function levelOptions(g) { const e=validateConfig(g); if(e) return []; const n=Math.floor((g.max-g.min)/g.step)+1; return Array.from({length:n},(_,i)=>+(g.min+i*g.step).toFixed(5)); }
  function grindLabel(grind) {
    if (!grind || !grind.mode) return '未记录';
    if (grind.mode==='turns') return `${grind.turns} 圈 ${grind.clicks} 格`;
    if (grind.mode==='particle') return `${grind.value} ${grind.unit}`;
    return `${grind.value} 级`;
  }
  function reference(state, record, type) {
    const others=sorted(active(state).filter(r=>r.kind==='brew'&&r.beanId===record.beanId&&r.id!==record.id));
    if(type==='best') return others.sort((a,b)=>b.rating-a.rating||b.date.localeCompare(a.date)||(b.createdAt||0)-(a.createdAt||0))[0]||null;
    const earlier=others.filter(r=>r.date<record.date || (r.date===record.date && r.createdAt<record.createdAt));
    return earlier[0]||null;
  }
  function seed() {
    const beans=[
      {id:'bean_1',name:'花园日晒',brand:'周末烘焙',origin:'埃塞俄比亚',region:'西达摩',variety:'当地品种',processing:'日晒',roast:'浅烘',notes:'花果香清楚，适合周末慢慢喝。',photo:''},
      {id:'bean_2',name:'山间水洗',brand:'周末烘焙',origin:'哥伦比亚',variety:'波旁',processing:'水洗',roast:'中浅烘',notes:'喜欢这款豆子的甜感。',photo:''},
      {id:'bean_3',name:'日常拼配',brand:'街角烘焙',origin:'巴西',variety:'拼配',processing:'日晒',roast:'中烘',notes:'奶咖里也很好喝。',photo:''}
    ];
    const gear=[{id:'gear_1',kind:'grinder',name:'我的手摇磨豆机',type:'手摇',brand:'',model:'',mode:'turns',clicks:12,turns:4,min:1,max:30,step:1,values:[],unit:'µm',notes:'示例格数，请按自己的器具修改。'}, {id:'gear_2',kind:'dripper',name:'常用锥形滤杯',material:'树脂',brand:'',model:'',notes:''}];
    const shops=[{id:'shop_1',name:'周末咖啡',location:'街角的小店 · 示例店铺',rating:5,revisit:true,notes:'采光好，想再试试当季手冲。'}, {id:'shop_2',name:'街角咖啡',location:'散步路上的店 · 示例店铺',rating:4,revisit:false,notes:'奶咖顺滑，座位不多。'}];
    const waters=[{id:'water_1',type:'过滤水',name:'家里的过滤水',notes:''}];
    const specs=[['bean_1',0,5,92,174,14,['酸感:多汁','花香与茶香:茉莉','果香:柑橘']],['bean_1',1,4,93,185,16,['酸感:明亮','甜香:蜂蜜']],['bean_1',3,3,94,198,17,['苦感:持久','果香:柑橘']],['bean_2',2,4,91,168,12,['甜感:清甜','甜香:焦糖']],['bean_2',5,4,92,178,13,['口感:丝滑','坚果与可可:可可']]];
    const records=specs.map((s,i)=>({id:'brew_'+i,kind:'brew',beanId:s[0],date:daysAgo(s[1]),rating:s[2],dose:15,water:225,temp:s[3],duration:s[4],grinderId:'gear_1',dripperId:'gear_2',waterId:'water_1',grind:{mode:'turns',turns:1,clicks:s[5]-12},stages:[{time:0,water:30},{time:30,water:120},{time:75,water:225}],flavors:s[6],intensity:{acid:'中',sweet:'中',bitter:i===2?'中':'弱'},notes:i===0?'今天这杯花香更清楚，喝起来很轻盈。':'',createdAt:Date.now()-s[1]*86400000-i*1000}));
    records.push({id:'visit_1',kind:'cafe',name:'燕麦奶拿铁',shopId:'shop_1',beanId:'bean_3',date:daysAgo(1),rating:5,type:'拿铁',milk:'燕麦奶',price:28,temperature:'热',flavors:['口感:丝滑','甜香:焦糖'],notes:'甜感自然，下次还想点。',createdAt:Date.now()-86400000+500,beanInfo:{}}, {id:'visit_2',kind:'cafe',name:'花园日晒手冲',shopId:'shop_1',beanId:'bean_1',date:daysAgo(4),rating:4,type:'手冲',price:38,milk:'',flavors:['花香与茶香:茉莉','果香:橙子'],notes:'豆卡上的花香很明显。',createdAt:Date.now()-4*86400000,beanInfo:{}}, {id:'visit_3',kind:'cafe',name:'招牌 Dirty',shopId:'shop_2',beanId:'bean_3',date:daysAgo(6),rating:4,type:'Dirty',milk:'牛奶',price:26,temperature:'冰',flavors:['坚果与可可:黑巧克力','口感:奶油感'],notes:'冷热交融，巧克力味明显。',createdAt:Date.now()-6*86400000,beanInfo:{}});
    const recipes=[{...clone(records[0]),id:'recipe_1',name:'花园日晒 · 15 g',referenceDuration:174,duration:null,rating:0,flavors:[],notes:'记住这一杯的花香。',sourceId:'brew_0'}];
    return {version:VERSION,beans,gear,shops,waters,records,recipes,drafts:[],reviews:[],settings:{grinderId:'gear_1',dripperId:'gear_2',waterId:'water_1',theme:'light'},demo:true};
  }
  function validateState(s) {
    if(!object(s) || s.version!==VERSION) return '备份格式或版本不匹配';
    for(const key of ['beans','gear','shops','waters','records','recipes','drafts','reviews']) {
      if(!Array.isArray(s[key]) || s[key].length>10000) return '备份中的资料列表不完整或过大';
      const ids=new Set();
      for(const row of s[key]) { if(!object(row) || typeof row.id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) || ids.has(row.id)) return '备份中存在无效或重复的记录编号'; ids.add(row.id); }
    }
    if(!s.settings || typeof s.settings!=='object'||Array.isArray(s.settings)) return '备份缺少设置';
    if(s.settings.theme!==undefined&&!['light','dark'].includes(s.settings.theme)) return '备份中的外观设置无效';
    if(s.settings.accent!==undefined&&!ACCENTS.some(a=>a.id===s.settings.accent)) return '备份中的主题色无效';
    for(const [key,kind,collection] of [['grinderId','grinder',s.gear],['dripperId','dripper',s.gear],['waterId',null,s.waters]]) {
      const id=s.settings[key];
      if(!referenceId(id)) return '备份中的默认器具或水设置无效';
      if(id && !collection.some(row=>row.id===id&&(!kind||row.kind===kind))) return '备份中的默认器具或水不存在';
    }
    for(const collection of [s.beans,s.gear,s.shops,s.waters,s.records,s.recipes,s.drafts,s.reviews]) for(const item of collection) {
      for(const val of Object.values(item)) if(typeof val==='string' && val.length>850000) return '备份中的文本或图片过大';
      for(const key of ['name','roast','brand','origin','region','variety','processing','notes','type','milk','milkBrand','ingredients','temperature','location','material','model','unit','conclusion','next']) if(item[key]!==undefined&&typeof item[key]!=='string') return '备份中的文字资料格式无效';
      const optionalError=validateOptionalData(item);if(optionalError)return optionalError;
      if(item.deletedAt!==undefined&&(!Number.isFinite(item.deletedAt)||item.deletedAt<=0)) return '备份中的删除时间无效';
      if(item.flavors!==undefined && (!Array.isArray(item.flavors) || item.flavors.some(v=>typeof v!=='string'))) return '备份中的风味格式无效';
      if(item.stages!==undefined && (!Array.isArray(item.stages)||item.stages.some(v=>!v||typeof v!=='object'))) return '备份中的分段格式无效';
      if(item.intensity!==undefined && (!item.intensity||typeof item.intensity!=='object'||Array.isArray(item.intensity))) return '备份中的强度格式无效';
      if(item.beanInfo!==undefined && (!item.beanInfo||typeof item.beanInfo!=='object'||Array.isArray(item.beanInfo))) return '备份中的豆子资料格式无效';
    }
    for(const b of s.beans) if(typeof b.name!=='string' || !b.name.trim() || typeof b.roast!=='string' || !b.roast.trim()) return '备份中豆子缺少名称或烘焙程度';
    for(const row of [...s.shops,...s.waters,...s.recipes]) if(typeof row.name!=='string'||!row.name.trim()) return '备份中的档案缺少名称';
    for(const shop of s.shops) {
      if(shop.rating!==undefined&&shop.rating!==null&&(!Number.isInteger(shop.rating)||shop.rating<0||shop.rating>5)) return '备份中的店铺评价无效';
      if(shop.revisit!==undefined&&typeof shop.revisit!=='boolean') return '备份中的店铺状态无效';
    }
    for(const review of s.reviews) if(!validDate(review.date)) return '备份中的复盘日期无效';
    for(const draft of s.drafts) {
      if(!['brew','cafe'].includes(draft.kind)) return '备份中的草稿类型无效';
      if(draft.date!==undefined&&draft.date!==''&&!validDate(draft.date)) return '备份中的草稿日期无效';
      if(draft.editorExisting!==undefined&&typeof draft.editorExisting!=='boolean') return '备份中的草稿状态无效';
    }
    for(const r of s.recipes) if(!byId(s.beans,r.beanId)) return '备份中的配方缺少关联豆子';
    for(const r of s.recipes) if(Object.keys(validateRecord({...r,kind:'brew',rating:1,duration:r.referenceDuration},s)).length) return '备份中的配方参数无效';
    for(const g of s.gear) if(validateConfig(g)) return '备份中器具的计量设置无效';
    for(const r of s.records) if(Object.keys(validateRecord(r,s)).length) return '备份中的咖啡记录含有不完整或无效的必填数据';
    for(const collection of [s.beans,s.shops,s.records,s.gear]) for(const item of collection) if(item.photo && !photo(item.photo)) return '备份中图片格式不受支持';
    return '';
  }
  function read(storage) {
    let raw=null;
    try { raw=storage.getItem(KEY); if(raw===null) return {state:seed(),error:'',raw:null,persistent:true}; const parsed=JSON.parse(raw); const error=validateState(parsed); if(error) return {state:seed(),error,raw,persistent:true,blocked:true}; return {state:parsed,error:'',raw,persistent:true}; }
    catch(e) { return {state:seed(),error:e instanceof SyntaxError?'本地记录格式暂时无法读取':'当前浏览器暂时无法保存数据',raw,persistent:false,blocked:raw!==null}; }
  }
  function write(storage,state) {
    try { const error=validateState(state); if(error) return {ok:false,message:error}; storage.setItem(KEY,JSON.stringify(state)); return {ok:true}; }
    catch(e) { return {ok:false,message:e?.name==='QuotaExceededError'?'保存空间不足。请先导出备份或减少图片，填写内容已保留。':'暂时无法保存到浏览器，填写内容已保留。请导出备份后重试。'}; }
  }
  const API={VERSION,KEY,ACCENTS,ROASTS,FLAVORS,TYPES,ORIGINS,METHODS,WATER_TYPES,clone,escape,uid,number,today,daysAgo,duration,ratio,validDate,active,sorted,byId,photo,validateRecord,validateConfig,levelOptions,grindLabel,reference,seed,validateState,read,write};
  if(typeof module!=='undefined'&&module.exports) module.exports=API; else root.CoffeeCore=API;
})(globalThis);
