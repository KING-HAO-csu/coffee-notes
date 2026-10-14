# 咖啡手记 Android 源码

离线个人咖啡记录应用。应用标识 `com.coffeenotes.personal`，当前版本 `0.1.1`，最低 Android 8.0（API 26），目标 API 35。

## 目录与构建

解压时保留 `work/coffee-android` 和 `work/coffee-preview` 的相对位置。需要 Windows、Node.js 22+、JDK 17，以及 Google 官方 Android SDK Build Tools 35.0.0 和 Android 35 Platform。无需 Gradle 或 npm 依赖。

1. 在 `work/coffee-android` 运行 `node bootstrap.cjs`。脚本通过 Windows PowerShell 的系统网络代理下载 Google 官方工具包，校验文件大小和 SHA-1 后自动解压；已经通过校验的缓存和已解压工具会直接复用。
2. 确认 JDK 17 的 `javac.exe` 在 PATH 中，或设置 `JAVA_HOME`。
3. 运行 `node build.cjs`。安装包及签名校验结果写入 `outputs/coffee-android`。

工具版本固定为 `build-tools_r35_windows.zip`（59,878,107 字节，SHA-1 `af059bb67cf7786f45ee0db85e2d24985df1b4b6`）与 `platform-35_r02.zip`（64,273,788 字节，SHA-1 `0bb560a90a7a2cbd0dd8348224d518b638fe7949`）。校验不符时脚本会停止，不会用未验证的文件构建 APK。

`COFFEE_ANDROID_TOOLS` 可指定另一个 SDK 工具目录。网页资产来自同级 `coffee-preview` 中的 HTML、CSS 与 JS；打包后内置到 APK。

首次构建会在 `work/coffee-android/signing` 创建该项目专用的签名密钥及随机密码。请私下妥善备份整个 signing 目录。以后升级应使用相同应用标识及同一签名密钥，并同步提高 AndroidManifest.xml 与 build.cjs 的版本号和 versionCode。不要分享签名文件或上传到公开仓库。公开源码包仅收录脚本列出的源文件，以及存在时的根 README、LICENSE 和 .gitignore，不扫描浏览器资料、签名材料或工具目录。收到源码包的人首次构建会创建不同的密钥，因此其 APK 不能直接覆盖原签名安装的应用。

## 使用与数据

应用界面运行于 Android 系统 WebView。页面内置在安装包，日常记录无需网络；照片和备份通过系统文件选择器处理。浏览器预览和 APK 分别保存数据，可通过应用内导出、导入备份迁移。卸载应用会清除应用数据，请先导出备份。

构建脚本验证编译、APK 签名、ZIP 对齐与应用标识。真机安装、系统返回键、照片选择和备份文件选择仍应在实际 Android 设备上验收。
