const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const dir=__dirname,output=path.resolve(dir,'../../outputs/coffee-preview');fs.mkdirSync(output,{recursive:true});
let html=fs.readFileSync(path.join(dir,'index.template.html'),'utf8');
for(const [marker,file] of [['STYLES','styles.css'],['CORE','core.js'],['APP','app.js']])html=html.replace('/* '+marker+' */',()=>fs.readFileSync(path.join(dir,file),'utf8').replace(/\r\n?/g,'\n').replace(/<\/script/gi,'<\\/script'));
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>"'sha256-"+crypto.createHash('sha256').update(match[1]).digest('base64')+"'");
if(scripts.length!==2)throw new Error('Unexpected script count');
const policy="default-src 'none'; script-src "+scripts.join(' ')+"; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none';";
html=html.replace('<!-- CSP -->','<meta http-equiv="Content-Security-Policy" content="'+policy+'">');
fs.writeFileSync(path.join(output,'index.html'),html);console.log('Built standalone preview:',output);
