# Airline Simulator AOCC · Android 版

本地构建后，安装包输出到 `../exports/android/Airline-Simulator-AOCC-Android-1.0.0.apk`。

这是独立运行的 Android 应用。手机在本机建立游戏会话并保存同步数据。

## 环境与功能

- Android 9 / API 28 及以上；Android System WebView / Chrome 至少 110。旧内核会显示更新提示。
- 界面、离线矢量地图、机场与机型资料随 APK 打包。手机通过原生 HTTPS 传输直接连接已核实的游戏接口，不依赖电脑或本地服务器。
- 复用已有数据标准化、账户归属校验、分页、限流退避、游戏时钟、班表及客舱逻辑。Android 构建单独替换 Node 文件读取、JWT 解码、摘要和计时器边界；电脑构建不经过这些替换。
- 会话存储：Android Keystore AES-GCM；数据存储：应用私有 SQLite；禁止 Android 备份；仅申请网络权限。导入导出通过 Android 系统文件选择器，不申请共享存储权限。
- 前台默认 60 秒同步。后台暂停，恢复前台立即同步；安卓系统结束进程后，下次启动恢复缓存与加密会话。没有承诺常驻后台或全天候采样。
- 每航司/来源/小时保留最新完整样本，总上限 336 条或 64 MiB；图表与分析使用相同航司和来源的最近至多 168 个小时样本。日志至多 200 条。与电脑端逐分钟历史保留策略不同。
- Native 网络接口仅允许固定游戏主机及既有读取接口；除续期外只允许 GET；禁止跟随重定向。WebView 仅加载应用资产，外部 HTTPS 页面交给手机浏览器；禁用 file/content 访问和第三方 frame。
- Markdown、CSV、JSON、HTML 通过系统「保存」面板保存；打印 / PDF 使用 Android 系统打印服务。

## 手机授权

游戏没有公开的第三方应用 OAuth 回调。使用手机浏览器登录官方涂装编辑器，并由用户手动执行应用提供的授权书签，生成只含 access_token / refresh_token 的临时本地 JSON，再通过系统文件选择器导入。书签会检查精确官方 origin，不向网络发送会话、不创建自定义 OAuth 重定向、不要求 Google 密码。连接后应删除下载目录里的临时授权文件。

手机应重新登录建立独立会话，不能导入电脑端刷新令牌。客户端隔离不能代替游戏服务端的账户并行登录政策。官方页面布局、浏览器书签执行策略或游戏协议变化，可能需要重新适配。此版本尚未使用用户手机或用户真实账号验证安卓首次授权。

## 构建

在项目根目录：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File android/Build-Android.ps1
```

也可双击 `android/Build Android.cmd`。工具链位于 `android/toolchain/`：Temurin JDK 21、Android API 35 平台、35.0.0 Windows Build Tools。下载源为 Eclipse Adoptium 官方发布 API 和 Google SDK 官方仓库，已按发布的 SHA-256 / SHA-1 校验。工具链未修改系统 PATH、系统 Java 或全局 Android SDK。

构建按顺序执行 Vite、aapt2、javac、D8、zipalign 和 apksigner，并核对全部网页资产的 APK 路径；未使用云构建或上传源码。签名文件在 `android/private/`，请私下备份以便后续覆盖升级，勿分享、勿与 APK 一起发送。无需把工具链或签名密钥传到手机。APK 自签名，供个人侧载；不是应用商店发行包。

从源码构建时，请在本地准备工具链和签名配置。将 JDK 解压至 `toolchain/java/`、API 35 平台和 Windows build-tools 解压至 `toolchain/sdk/`；本脚本采用 Google 压缩包原目录名 `android-35` 和 `android-15`。

## 验证

```powershell
npm run check
node --test android/tests/runtime.test.mjs
node android/tests/browser.mjs
```

浏览器测试需要 `android/toolchain/browser` 中的 playwright-core，以及本机 Chrome。它仅用模拟手机桥接和模拟游戏服务，不读取 `.data/`；覆盖手机端真实生产构建、授权 JSON 校验、网络适配、恢复缓存、导出文件、系统打印入口、窄屏和脚本错误。Java 原生层已编译并打包，APK 签名与对齐校验通过；未将浏览器模拟验证表述为 Android 真机测试。

2026-10-20：原电脑端 119 项测试通过；手机逻辑 5 项测试通过；393 × 852 浏览器流程通过。详情见 `../exports/android/browser-validation.json`；预览图使用合成数据。APK 中不含测试模拟器。

参考：[Android 本地 WebView 内容](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)、[WebView 原生接口](https://developer.android.com/develop/ui/views/layout/webapps/webview)、[Google OAuth 政策](https://developers.google.com/identity/protocols/oauth2/policies)。
