/* Rebuild the offline Android package with JDK 17 and the official Android SDK. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const zlib = require('node:zlib');

const root = __dirname;
const workspace = path.resolve(root, '../..');
const output = path.join(workspace, 'outputs/coffee-android');
const tools = process.env.COFFEE_ANDROID_TOOLS || path.join(root, 'toolchain');
const runDir = path.join(root, 'build', new Date().toISOString().replace(/[:.]/g, '-'));
const signing = process.env.COFFEE_ANDROID_SIGNING || path.join(root, 'signing');
const version = '0.1.2';
const versionCode = '3';
const appName = '咖啡手记';

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? files(target) : entry.isFile() ? [target] : [];
  });
}
function locate(name) {
  const result = files(tools).find(file => path.basename(file).toLowerCase() === name.toLowerCase());
  if (!result) throw new Error('Android SDK 缺少 ' + name + '，请先运行 bootstrap.cjs 并解压官方 SDK 包。');
  return result;
}
function run(command, args, options = {}) {
  const result = cp.spawnSync(command, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(path.basename(command) + ' 执行失败：\n' + (result.error?.message || '')
      + (result.stdout || '') + (result.stderr || ''));
  }
  return (result.stdout || '') + (result.stderr || '');
}
function javaTools() {
  if (process.env.JAVA_HOME) {
    const bin = path.join(process.env.JAVA_HOME, 'bin');
    if (fs.existsSync(path.join(bin, 'javac.exe'))) return bin;
  }
  const found = run('where.exe', ['javac.exe']).trim().split(/\r?\n/)[0];
  return path.dirname(found);
}

// Small dependency-free ZIP writer used only for the public source archive.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function sourceZip(destination) {
  const chosen = [];
  // Never traverse the workspace when publishing source. Browser profiles,
  // signing materials and future scratch files must remain outside the archive.
  const required = [
    'work/coffee-android/AndroidManifest.xml',
    'work/coffee-android/build.cjs',
    'work/coffee-android/bootstrap.cjs',
    'work/coffee-android/bridge-qa.cjs',
    'work/coffee-android/README.md',
    'work/coffee-android/.gitignore',
    'work/coffee-android/src/com/coffeenotes/personal/MainActivity.java',
    'work/coffee-android/res/drawable/icon_background.xml',
    'work/coffee-android/res/drawable/icon_foreground.xml',
    'work/coffee-android/res/mipmap-anydpi-v26/ic_launcher.xml',
    'work/coffee-android/res/values/styles.xml',
    'work/coffee-preview/index.template.html',
    'work/coffee-preview/styles.css',
    'work/coffee-preview/core.js',
    'work/coffee-preview/app.js',
    'work/coffee-preview/build.cjs',
    'work/coffee-preview/tests.cjs',
    'work/coffee-preview/browser-qa.cjs',
  ];
  const optional = ['README.md', 'LICENSE', '.gitignore'];
  for (const name of [...required, ...optional]) {
    const file = path.join(workspace, name);
    if (!fs.existsSync(file)) {
      if (optional.includes(name)) continue;
      throw new Error('源码包缺少必要文件：' + name);
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('源码包拒绝非常规文件：' + name);
    chosen.push({ name, file });
  }
  const chunks = [], central = [];
  let offset = 0;
  for (const entry of chosen.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = Buffer.from(entry.name, 'utf8');
    const original = fs.readFileSync(entry.file);
    const compressed = zlib.deflateRawSync(original, { level: 9 });
    const crc = crc32(original);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12); // 1980-01-01, deterministic metadata.
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(original.length, 22); local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, compressed);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x800, 8); header.writeUInt16LE(8, 10); header.writeUInt16LE(0x21, 14);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(original.length, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42); central.push(header, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(chosen.length, 8); end.writeUInt16LE(chosen.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(destination, Buffer.concat([...chunks, directory, end]));
  return chosen.length;
}

try {
  const bin = javaTools();
  const java = path.join(bin, 'java.exe'), javac = path.join(bin, 'javac.exe');
  const jar = path.join(bin, 'jar.exe'), keytool = path.join(bin, 'keytool.exe');
  const aapt = locate('aapt2.exe'), android = locate('android.jar');
  const d8 = locate('d8.jar'), align = locate('zipalign.exe'), signer = locate('apksigner.jar');
  fs.mkdirSync(runDir, { recursive: true }); fs.mkdirSync(output, { recursive: true });
  for (const name of ['assets', 'generated', 'classes', 'dex']) fs.mkdirSync(path.join(runDir, name));
  console.log('1/6 整合离线页面');
  run(process.execPath, [path.join(workspace, 'work/coffee-preview/build.cjs')]);
  fs.copyFileSync(path.join(workspace, 'outputs/coffee-preview/index.html'), path.join(runDir, 'assets/index.html'));
  console.log('2/6 编译图标、主题和应用资源');
  const compiled = path.join(runDir, 'resources.zip'), apk = path.join(runDir, 'unsigned.apk');
  run(aapt, ['compile', '--dir', path.join(root, 'res'), '-o', compiled]);
  run(aapt, ['link', '-o', apk, '-I', android, '--manifest', path.join(root, 'AndroidManifest.xml'),
    '--min-sdk-version', '26', '--target-sdk-version', '35', '-A', path.join(runDir, 'assets'),
    '--java', path.join(runDir, 'generated'), compiled]);
  console.log('3/6 编译 Android 功能');
  const sources = [...files(path.join(root, 'src')), ...files(path.join(runDir, 'generated'))].filter(x => x.endsWith('.java'));
  // JDK's Java 8 symbols include the lambda bootstrap method omitted by android.jar stubs.
  // D8 then desugars lambdas against the Android API library for minSdk 26.
  run(javac, ['-encoding', 'UTF-8', '--release', '8', '-classpath', android,
    '-d', path.join(runDir, 'classes'), ...sources]);
  run(java, ['-cp', d8, 'com.android.tools.r8.D8', '--min-api', '26', '--lib', android,
    '--output', path.join(runDir, 'dex'), ...files(path.join(runDir, 'classes')).filter(x => x.endsWith('.class'))]);
  const dexFiles = files(path.join(runDir, 'dex')).filter(x => x.endsWith('.dex'));
  if (!dexFiles.length) throw new Error('DEX 编译未生成输出。');
  run(jar, ['uf', apk, ...dexFiles.flatMap(file => ['-C', path.dirname(file), path.basename(file)])]);
  console.log('4/6 对齐与本地签名');
  const aligned = path.join(runDir, 'aligned.apk'), signed = path.join(runDir, 'signed.apk');
  run(align, ['-f', '-p', '4', apk, aligned]);
  fs.mkdirSync(signing, { recursive: true });
  const keyFile = path.join(signing, 'coffee-notes-release.p12');
  const passwordFile = path.join(signing, 'password.txt');
  const keyExists = fs.existsSync(keyFile), passwordExists = fs.existsSync(passwordFile);
  if (keyExists !== passwordExists) throw new Error('签名材料不完整，请恢复 signing 中对应的密钥和密码文件；不会更换已有密钥。');
  const password = passwordExists ? fs.readFileSync(passwordFile, 'utf8').trim() : crypto.randomBytes(32).toString('base64url');
  const signingEnv = { ...process.env, COFFEE_SIGNING_PASSWORD: password };
  if (!keyExists) {
    run(keytool, ['-genkeypair', '-keystore', keyFile, '-storetype', 'PKCS12', '-alias', 'coffee-notes',
      '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA', '-validity', '10000',
      '-dname', 'CN=Coffee Notes Personal, OU=Personal App', '-storepass:env', 'COFFEE_SIGNING_PASSWORD',
      '-keypass:env', 'COFFEE_SIGNING_PASSWORD'], { env: signingEnv });
    fs.writeFileSync(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
  }
  run(java, ['-jar', signer, 'sign', '--ks', keyFile, '--ks-key-alias', 'coffee-notes',
    '--ks-pass', 'env:COFFEE_SIGNING_PASSWORD', '--key-pass', 'env:COFFEE_SIGNING_PASSWORD',
    '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true',
    '--v4-signing-enabled', 'false', '--out', signed, aligned], { env: signingEnv });
  console.log('5/6 验证安装包签名与结构');
  const verify = run(java, ['-jar', signer, 'verify', '--verbose', '--print-certs', signed]);
  run(align, ['-c', '-p', '4', signed]);
  const badging = run(aapt, ['dump', 'badging', signed]);
  if (!badging.includes("name='com.coffeenotes.personal'")
      || !badging.includes("versionName='" + version + "'")
      || !badging.includes("versionCode='" + versionCode + "'")) {
    throw new Error('安装包应用标识或版本不匹配。');
  }
  const destination = path.join(output, appName + '-' + version + '.apk');
  fs.copyFileSync(signed, destination);
  const sum = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  fs.writeFileSync(path.join(output, 'SHA256.txt'), sum + '  ' + path.basename(destination) + '\n');
  fs.writeFileSync(path.join(output, '构建验证.txt'), '咖啡手记 ' + version + '\nAndroid 8.0+ (minSdk 26)\n'
    + '应用标识：com.coffeenotes.personal\nzipalign：通过\nSHA-256：' + sum + '\n\n' + verify
    + '\n' + badging);
  console.log('6/6 整理源码包');
  const count = sourceZip(path.join(output, '咖啡手记-Android源码.zip'));
  console.log('已生成：' + destination);
  console.log('签名、对齐验证通过；源码包包含 ' + count + ' 个文件，不包含私钥、密码或构建工具。');
} catch (error) {
  console.error('构建未完成：' + error.message);
  process.exitCode = 1;
}
