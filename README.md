# 飞享IM Desktop (electron-vue-chat-pro)

基于 Electron 35 + Vue 3 + electron-vite 构建的跨平台即时通讯桌面客户端，支持 macOS / Windows / Linux。

---

## 常用开发命令

```bash
# 切换到 Node 20（必须）
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20

# 开发模式（同时启动 Electron + Vite HMR）
npm run dev

# 运行全部测试
npm test

# 生产构建（输出到 out/）
npm run build

# 本地打包安装包（输出到 release/）
npm run dist          # 当前平台
npm run dist:dir      # 仅构建目录，不打包，快速验证
```

---

## 发布新版本流程

### 第一步：更新版本号

修改 `package.json` 中的 `version` 字段，遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

```json
{
  "version": "1.3.2"
}
```

版本号规则：
- `x.y.z` → 修复 bug，递增 `z`
- `x.y.0` → 新增功能，递增 `y`，`z` 归零
- `x.0.0` → 破坏性变更，递增 `x`，`y`/`z` 归零

---

### 第二步：更新更新日志

在 `src/renderer/src/changelog.ts` 的数组**头部**追加新版本条目（保持倒序，最新版本在最前面）：

```ts
export const changelog: ChangelogEntry[] = [
  {
    version: '1.3.2',          // 与 package.json 保持一致
    date: '2026-06-20',        // 发布日期 YYYY-MM-DD
    items: [
      '修复后台心跳定时器被 Chromium 节流的问题，窗口隐藏时心跳不再延迟',
      // 每条描述一个变更，用户可读的语言
    ]
  },
  // 以下是已有历史版本，不要修改 ...
]
```

> 更新日志会在应用内「关于」对话框中展示，并在升级后自动提示用户查看。

---

### 第三步：本地验证打包（可选但推荐）

推送 tag 之前先本地跑一遍，确认构建产物正常：

```bash
# 仅构建目录（秒出，不打完整安装包）
npm run dist:dir

# 检查 release/ 目录下是否生成了正确的可执行文件
ls release/
```

---

### 第四步：提交代码

```bash
git add package.json src/renderer/src/changelog.ts
git commit -m "release: v1.3.2"
```

---

### 第五步：打 Tag 并推送触发 CI/CD

```bash
# 打 tag（必须以 v 开头）
git tag v1.3.2

# 推送 tag 到远程，触发 GitHub Actions
git push origin v1.3.2

# 同步推送提交（如果还没推）
git push origin main
```

> tag 名称必须匹配 `v*` 格式（如 `v1.3.2`），否则 GitHub Actions 不会触发。

---

### 第六步：等待 GitHub Actions 构建

推送 tag 后，`.github/workflows/release.yml` 自动触发三个并行 job：

| Job | Runner | 产物 |
|---|---|---|
| `build-mac` | `macos-latest` | `*.dmg`（x64 + arm64 两个文件）|
| `build-linux` | `ubuntu-latest` | `*.AppImage`、`*.deb` |
| `build-windows` | `windows-latest` | `*.exe`（x64 + ia32）|

在 GitHub 仓库的 **Actions** 页面可以实时查看构建进度。三个 job 全部成功后，安装包会自动上传到对应 tag 的 **Releases** 页面。

**整体触发链路：**

```
git push tag v1.3.2
       ↓
GitHub Actions 检测到 v* tag
       ↓
并行启动 mac / linux / windows 三个 job
       ↓
各 job 执行：npm ci → npm run build → electron-builder
       ↓
产物上传到 GitHub Release（v1.3.2）
```

---

## 常见问题

**Q：macOS 安装后提示「无法验证开发者」？**

当前构建包未经 Apple 代码签名，macOS Gatekeeper 会拦截从网络下载的未签名应用。两种绕过方式（任选其一）：

方式一：在 Finder 中 **右键单击** 应用图标 → 选「打开」→ 弹框中再次点「打开」（只需操作一次）

方式二：终端执行：
```bash
xattr -cr /Applications/飞享\ IM.app
```
然后正常双击启动。

---

**Q：推送 tag 后 Actions 没有触发？**
- 检查 tag 名称是否以 `v` 开头（如 `v1.3.2` ✓，`1.3.2` ✗）
- 确认已推送到 `origin` 而不是只打了本地 tag

**Q：macOS 打包报签名错误？**
- CI 已设置 `CSC_IDENTITY_AUTO_DISCOVERY: false`，跳过代码签名，无需证书
- 本地打包如遇签名问题同样可加此环境变量：`CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist`

**Q：想删除错误的 tag 重新发布？**
```bash
git tag -d v1.3.2              # 删除本地 tag
git push origin :refs/tags/v1.3.2  # 删除远程 tag
# 同时在 GitHub Releases 页面手动删除对应的 Release
```
