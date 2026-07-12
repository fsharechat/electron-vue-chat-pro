---
name: verify
description: 运行并驱动本项目 Electron 应用做端到端验证——通过 CDP 连接开发实例,用 Playwright 驱动渲染进程 DOM、截图、测性能
---

# 验证本应用(Electron GUI)

## 启动可驱动的应用实例

直接跑构建产物不行:`is.dev`(= 未打包)会让主进程去加载 `localhost:9080`。
正确方式是启动 dev 模式并开 CDP 远程调试口:

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npx electron-vite dev -- --remote-debugging-port=9223   # 后台运行
# 就绪判据:curl -s http://127.0.0.1:9223/json/version 有响应
```

开发机的 dev 用户数据目录(`~/Library/Application Support/electron-vue-chat-pro`)
通常已有登录态,应用会直接进入会话列表,无需登录。

## 驱动(playwright-core,无需下载浏览器)

在 scratchpad `npm i playwright-core`,然后:

```js
import { chromium } from 'playwright-core'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
// 在 contexts().pages() 里找 url 含 localhost:9080 且不含 overlay=1 的页面(overlay 是截图蒙层窗口)
```

- 等 `text=系统通知` 出现 = 会话列表就绪;若超时说明未登录
- 消息滚动容器:`.messages-scroll`;消息行:`.message-row` / `.notification-bar`
- 切会话:`win.locator('text=<会话名>').first().click()`
- 贴底判据:`el.scrollHeight - el.scrollTop - el.clientHeight`(应 ≤ 1)
- 性能:先注册 `PerformanceObserver({ entryTypes: ['longtask'] })`,再点击切换,统计长任务

## 验证图片相关行为

- 会话最近消息可能全是文字,图片在历史上方——需在 `.messages-scroll` 里逐屏上滚触发懒加载
- 观察「缩略图→原图」替换:先 `Network.setCacheDisabled` + `Network.emulateNetworkConditions`
  限速(约 400KB/s,太狠原图加载不完测量无效),统计 img 的 src 从 `data:` 变 `http` 的次数
  作为测量有效性前提,再看尺寸是否变化

## 陷阱

- 只读操作(点会话、展开消息)安全;不要发送消息/撤回——连的是真实后端
- 对比基线:`git stash push <文件>` 后 Vite HMR 自动生效,测完 `git stash pop`
- `<script setup>` 顶层代码是每实例执行的,模块级单例要放普通 `<script>` 块
