/* Local publication checks. Nothing is sent to a remote scanning service. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const allowed=JSON.parse(fs.readFileSync(path.join(__dirname,'public-files.json'),'utf8'));
const issues=[];
const rules=[
 ['private-home-path',/[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9_.-]+/],
 ['private-unix-home',/\/(?:home|Users)\/[A-Za-z0-9_.-]+\//],
 ['email-address',/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['credential-token',/(?:ghp_|github_pat_|sk_live_)[A-Za-z0-9_]{20,}/],
 ['cloud-access-key',/AKIA[0-9A-Z]{16}/],
 ['phone-number',/(?<![\w])1[3-9]\d{9}(?![\w])/],
];
function checkText(name,text){for(const [rule,pattern] of rules)if(pattern.test(text))issues.push({file:name,rule});}
for(const name of allowed){
 const full=path.resolve(root,name);
 if(!full.startsWith(root+path.sep)||!fs.existsSync(full)){issues.push({file:name,rule:'missing-or-outside-root'});continue;}
 const stat=fs.lstatSync(full);
 if(!stat.isFile()||stat.isSymbolicLink()){issues.push({file:name,rule:'not-regular-file'});continue;}
 const bytes=fs.readFileSync(full);
 if(name.endsWith('.png')){
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  if(!bytes.subarray(0,8).equals(signature)){issues.push({file:name,rule:'not-png'});continue;}
  let pos=8;while(pos<bytes.length){const size=bytes.readUInt32BE(pos),type=bytes.toString('ascii',pos+4,pos+8);if(['tEXt','iTXt','zTXt','eXIf'].includes(type))issues.push({file:name,rule:'image-metadata'});pos+=size+12;}
 }else checkText(name,bytes.toString('utf8'));
}
const git=cp.spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',windowsHide:true});
if(git.status===0){
 for(const name of git.stdout.split('\0').filter(Boolean))if(!allowed.includes(name))issues.push({file:name,rule:'not-in-public-file-list'});
}
const manifest=fs.readFileSync(path.join(root,'work/coffee-android/AndroidManifest.xml'),'utf8');
if(/<uses-permission\b/.test(manifest))issues.push({file:'AndroidManifest.xml',rule:'unexpected-permission'});
if(issues.length){console.error(JSON.stringify({result:'FAIL',issues},null,2));process.exitCode=1;}
else console.log(JSON.stringify({result:'PASS',files:allowed.length,checks:'explicit file list, private-path/contact/credential patterns, PNG metadata, Android permissions'},null,2));
