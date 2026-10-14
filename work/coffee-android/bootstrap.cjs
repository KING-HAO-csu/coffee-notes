/* Prepare the pinned official Android SDK packages on Windows. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const root = __dirname;
const tools = path.join(root, 'toolchain');
const repository = 'https://dl.google.com/android/repository/';
const packages = [
  {
    label: 'Android SDK Build-Tools 35.0.0',
    file: 'build-tools_r35_windows.zip',
    size: 59878107,
    sha1: 'af059bb67cf7786f45ee0db85e2d24985df1b4b6',
    directory: 'build-tools-35',
    required: [
      'android-15/aapt2.exe',
      'android-15/lib/d8.jar',
      'android-15/zipalign.exe',
      'android-15/lib/apksigner.jar',
    ],
  },
  {
    label: 'Android SDK Platform 35',
    file: 'platform-35_r02.zip',
    size: 64273788,
    sha1: '0bb560a90a7a2cbd0dd8348224d518b638fe7949',
    directory: 'platform-35',
    required: ['android-35/android.jar'],
  },
];

fs.mkdirSync(tools, { recursive: true });

function checksum(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

function archiveIsValid(file, metadata) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  return stat.isFile() && stat.size === metadata.size && checksum(file) === metadata.sha1;
}

function extractionIsValid(directory, metadata) {
  return metadata.required.every(relative => fs.existsSync(path.join(directory, relative)));
}

function removeToolDirectory(directory) {
  const resolved = path.resolve(directory);
  const relative = path.relative(path.resolve(tools), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('拒绝清理工具目录之外的路径。');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runPowerShell(script, environment, timeout) {
  const result = cp.spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...environment },
    },
  );
  if (result.error || result.status !== 0) {
    const details = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(details || `PowerShell 退出码 ${result.status}`);
  }
}

function verifyCachedMetadata() {
  const file = path.join(tools, 'repository.xml');
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, 'utf8');
  for (const metadata of packages) {
    const expected = [
      `<size>${metadata.size}</size>`,
      `<checksum>${metadata.sha1}</checksum>`,
      `<url>${metadata.file}</url>`,
    ];
    if (!expected.every(value => xml.includes(value))) {
      throw new Error(`repository.xml 中的 ${metadata.label} 元数据与固定校验值不一致。`);
    }
  }
  console.log('已核对缓存中的 Google 官方仓库元数据。');
}

function download(metadata) {
  const target = path.join(tools, metadata.file);
  if (archiveIsValid(target, metadata)) {
    console.log(`复用已校验缓存：${metadata.file}`);
    return target;
  }

  const partial = `${target}.partial`;
  fs.rmSync(partial, { force: true });
  console.log(`正在从 Google 官方仓库下载 ${metadata.label}……`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    'for ($attempt = 1; $attempt -le 3; $attempt++) {',
    '  try {',
    '    if (Test-Path -LiteralPath $env:COFFEE_SDK_DEST) { Remove-Item -LiteralPath $env:COFFEE_SDK_DEST -Force }',
    '    Invoke-WebRequest -UseBasicParsing -Uri $env:COFFEE_SDK_URL -OutFile $env:COFFEE_SDK_DEST',
    '    exit 0',
    '  } catch {',
    '    if ($attempt -eq 3) { Write-Error $_; exit 1 }',
    '    Start-Sleep -Seconds 2',
    '  }',
    '}',
  ].join('\n');

  try {
    runPowerShell(script, {
      COFFEE_SDK_URL: repository + metadata.file,
      COFFEE_SDK_DEST: partial,
    }, 15 * 60 * 1000);
    if (!archiveIsValid(partial, metadata)) {
      throw new Error(`大小或 SHA-1 不符合 Google 官方元数据（应为 ${metadata.size} 字节，${metadata.sha1}）。`);
    }
    fs.rmSync(target, { force: true });
    fs.renameSync(partial, target);
    console.log(`下载并校验完成：${metadata.file}`);
    return target;
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw new Error(`${metadata.label} 下载失败：${error.message}`);
  }
}

function extract(archive, metadata) {
  const destination = path.join(tools, metadata.directory);
  if (extractionIsValid(destination, metadata)) {
    console.log(`复用已解压工具：${metadata.directory}`);
    return;
  }

  const staging = `${destination}.partial`;
  removeToolDirectory(staging);
  fs.mkdirSync(staging, { recursive: true });
  console.log(`正在解压 ${metadata.label}……`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Expand-Archive -LiteralPath $env:COFFEE_SDK_ARCHIVE -DestinationPath $env:COFFEE_SDK_DEST -Force',
  ].join('\n');

  try {
    runPowerShell(script, {
      COFFEE_SDK_ARCHIVE: archive,
      COFFEE_SDK_DEST: staging,
    }, 10 * 60 * 1000);
    if (!extractionIsValid(staging, metadata)) {
      throw new Error(`解压后缺少必要文件：${metadata.required.join('、')}`);
    }
    removeToolDirectory(destination);
    fs.renameSync(staging, destination);
    console.log(`解压完成：${metadata.directory}`);
  } catch (error) {
    removeToolDirectory(staging);
    throw new Error(`${metadata.label} 解压失败：${error.message}`);
  }
}

try {
  verifyCachedMetadata();
  for (const metadata of packages) {
    extract(download(metadata), metadata);
  }
  console.log('Android 35 构建工具准备完成。');
} catch (error) {
  console.error(`Android 工具准备失败：${error.message}`);
  process.exitCode = 1;
}
