# 聊天图片消息：气泡缩略图 + 左右切换预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 聊天气泡内的图片消息统一按最大 200×200 等比缩放展示（不裁剪、不撑高气泡），带内嵌缩略图的消息滑入可视区域后在后台自动升级为原图，点击后弹出的大图预览支持在当前会话已加载的图片消息间左右切换。

**Architecture:** 三处改动均为已有组件内的小改动，不涉及新组件、新 IPC：
1. `MessageBubble.vue` 里 `n-image` 的尺寸约束从 `width="160"` 改为 `img-props.style` 的 `max-width/max-height` + `object-fit:contain`。
2. `MessageBubble.vue` 新增一段 `ref`/`watch`/`computed`：复用 `n-image` 的 `lazy` + `@load` 语义判断「气泡是否已可见」，可见后在后台用 `new Image()` 预加载原图，加载完成后把 `:src` 切到原图。
3. `MessageList.vue` 里把渲染 `MessageBubble` 的 `v-for` 区块包一层 naive-ui 内置的 `<n-image-group>`，组内左右切换是 naive-ui 自带能力，不需要自己维护索引状态。

**Tech Stack:** Vue 3 + naive-ui ^2.38.0（package.json 声明的版本范围，实际安装/解析到的是 2.44.1）（`n-image` / `n-image-group`，全局通过 `app.use(naive)` 注册，模板里直接用不需要 import）。

## Global Constraints

- 不引入后端缩略图接口、不做客户端 canvas 生成/缓存缩略图（spec 已确认，气泡内 `thumbnail`/`binaryContent` 已够用）。
- `:preview-src`（点开大图）的数据来源优先级不变：`remoteMediaUrl ?? thumbnailSrc`。
- 原图预加载只用 `new Image()` 预热浏览器缓存，不引入 `IntersectionObserver`、不做本地持久化缓存、不做「降级回缩略图」的入口。
- 当前代码库没有针对 `MessageBubble.vue` / `MessageList.vue` 的自动化测试，本次不新增测试文件，每个任务用「跑通已有测试套件 + 手动验证」代替 TDD 红绿循环。
- 参考文档：`docs/superpowers/specs/2026-07-09-chat-image-thumbnail-preview-design.md`。

---

### Task 1: 气泡缩略图等比缩放（不裁剪、不撑高气泡）

**Files:**
- Modify: `src/renderer/src/components/chat/MessageBubble.vue:290-294`

**Interfaces:**
- Consumes: 组件内已有的 `thumbnailSrc`（computed，`MessageBubble.vue:102-105`）与 `message.content.remoteMediaUrl`（`ProtoMessageContent.remoteMediaUrl`，`src/renderer/src/types/index.ts:32`）。
- Produces: 无新增导出，仅修改模板内 `n-image` 的尺寸相关 props。Task 2 会在此基础上继续修改同一个 `n-image` 块（把 `:src` 从这里的静态表达式换成 computed，并加 `@load`），Task 3 只要求图片消息仍然通过 `n-image` 渲染（这样 `n-image-group` 才能收集到它）。

- [ ] **Step 1: 确认当前代码现状**

Read: `src/renderer/src/components/chat/MessageBubble.vue:290-294`，确认现状与下方 old_string 完全一致（若行号因中间提交发生偏移，以内容匹配为准）：

```html
          <n-image v-else-if="isImage"
            :src="thumbnailSrc || message.content.remoteMediaUrl"
            :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
            width="160" style="border-radius:4px;display:block"
          />
```

- [ ] **Step 2: 替换为最大 200×200 等比缩放 + 懒加载**

用 Edit 工具把上面的 old_string 替换为：

```html
          <n-image v-else-if="isImage"
            :src="thumbnailSrc || message.content.remoteMediaUrl"
            :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
            :img-props="{ style: 'max-width:200px;max-height:200px;width:auto;height:auto;object-fit:contain;border-radius:4px;display:block' }"
            lazy
          />
```

说明：
- 去掉 `width="160"` 和外层 `style="border-radius:4px;display:block"`（后者之前被 naive-ui 转发到 `n-image` 外层 `div` 上，因为 div 没有 `overflow:hidden` 并未产生视觉圆角效果，属于失效样式）。
- `img-props.style` 直接作用在内部 `<img>` 标签上：`max-width/max-height:200px` 配合 `width/height:auto` 让图片等比缩小到 200px 上限内，不裁剪、不留白；`border-radius` 挪到这里后才会真正在图片上生效；`display:block` 消除 `<img>` 默认的 inline 底部空隙。
- 新增 `lazy`（naive-ui `n-image` 原生懒加载 prop），图片消息多的会话滚动到可视区域外的图片不会提前加载原图。

- [ ] **Step 3: 跑通已有测试套件，确认没有破坏其他用例**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm test`
Expected: 所有既有用例通过（无 `MessageBubble.vue` 专属用例，本次改动不应引入新的失败）。

- [ ] **Step 4: 构建产物做模板/类型健全性检查**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm run build`
Expected: 构建成功，无 Vue 模板编译错误、无 TS 报错。

- [ ] **Step 5: 手动验证（开发模式）**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm run dev`

在应用内打开一个有图片消息的会话，检查：
1. 一张有本地缩略图（`binaryContent`，通常是自己刚发送、还带缩略图缓存的图片）的消息，气泡内展示效果与改动前基本一致（正常比例的图不应该变得明显更小或更大）。
2. 一张只有 `remoteMediaUrl`（对端发来的、没有内嵌缩略图字段）的**极端长宽比截图**（比如手机长截图），气泡不再被撑得很高，最长边被限制在 200px 左右。
3. 图片四角有可见圆角。

确认无误后关闭 dev 进程。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/chat/MessageBubble.vue
git commit -m "fix: 图片消息气泡按最大200x200等比缩放，避免长截图撑高气泡"
```

---

### Task 2: 带缩略图的消息滑入可视区域后后台升级为原图

**Files:**
- Modify: `src/renderer/src/components/chat/MessageBubble.vue`（`<script setup>` 内 import 与 `thumbnailSrc` 附近；模板内 Task 1 改过的 `n-image` 块）

**Interfaces:**
- Consumes: Task 1 完成后的 `n-image` 块（`MessageBubble.vue` 里 `v-else-if="isImage"` 那一段）；组件内已有的 `thumbnailSrc` computed（`MessageBubble.vue:102-105`）与 `props.message.content.remoteMediaUrl`。
- Produces: 新增 `bubbleImageSrc`（computed<string>）与 `onThumbnailLoad`（`() => void`），供本任务自己的模板绑定使用。不对外暴露、不影响 Task 3。

- [ ] **Step 1: 确认当前代码现状**

Read: `src/renderer/src/components/chat/MessageBubble.vue:1-2` 和 `:102-105`，确认与下方两处 old_string 一致。

import 部分（`MessageBubble.vue:2`）：

```ts
import { computed, ref, onMounted } from 'vue'
```

`thumbnailSrc` 定义（`MessageBubble.vue:102-105`）：

```ts
const thumbnailSrc = computed(() => {
  const b = props.message.content.binaryContent
  return b ? `data:image/png;base64,${b}` : ''
})
```

- [ ] **Step 2: 给 `<script setup>` 加上 `watch` 导入**

用 Edit 工具把上面的 import old_string 替换为：

```ts
import { computed, ref, watch, onMounted } from 'vue'
```

- [ ] **Step 3: 在 `thumbnailSrc` 后面新增可见性判断 + 后台预加载 + 升级后的 src**

用 Edit 工具把上面的 `thumbnailSrc` old_string 替换为：

```ts
const thumbnailSrc = computed(() => {
  const b = props.message.content.binaryContent
  return b ? `data:image/png;base64,${b}` : ''
})

const hasBecomeVisible = ref(false)
const upgradedSrc = ref('')

function onThumbnailLoad() {
  hasBecomeVisible.value = true
}

watch(
  [hasBecomeVisible, () => props.message.content.remoteMediaUrl],
  ([visible, url]) => {
    if (!visible || !thumbnailSrc.value || !url || upgradedSrc.value === url) return
    const img = new Image()
    img.onload = () => { upgradedSrc.value = url }
    img.src = url
  },
  { immediate: true }
)

const bubbleImageSrc = computed(() =>
  upgradedSrc.value || thumbnailSrc.value || props.message.content.remoteMediaUrl
)
```

说明：
- `onThumbnailLoad` 挂到 `n-image` 的 `@load` 上（下一步）。因为 `n-image` 已经在 Task 1 里加了 `lazy`，`@load` 只会在这张图片的当前 `:src` 真正进入可视区域并加载完成后才触发，不需要自己实现 `IntersectionObserver`。
- `watch` 同时依赖 `hasBecomeVisible` 和 `remoteMediaUrl`：覆盖「先有原图 URL、后滑入可视区域」和「先可见（自己刚发的图，缩略图已渲染）、上传完成后才补上 `remoteMediaUrl`」两种到达顺序。
- `!thumbnailSrc.value` 短路：没有内嵌缩略图的消息本来就是直接用 `remoteMediaUrl` 渲染，不需要走这条升级逻辑。
- 组件卸载后 `new Image()` 失去引用会被浏览器正常回收，不需要额外清理。

- [ ] **Step 4: 把 `n-image` 的 `:src` 换成 `bubbleImageSrc`，绑定 `@load`**

Read: `src/renderer/src/components/chat/MessageBubble.vue`，定位 Task 1 改完后的 `n-image` 块，确认与下方 old_string 一致：

```html
          <n-image v-else-if="isImage"
            :src="thumbnailSrc || message.content.remoteMediaUrl"
            :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
            :img-props="{ style: 'max-width:200px;max-height:200px;width:auto;height:auto;object-fit:contain;border-radius:4px;display:block' }"
            lazy
          />
```

用 Edit 工具替换为：

```html
          <n-image v-else-if="isImage"
            :src="bubbleImageSrc"
            :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
            :img-props="{ style: 'max-width:200px;max-height:200px;width:auto;height:auto;object-fit:contain;border-radius:4px;display:block' }"
            lazy
            @load="onThumbnailLoad"
          />
```

- [ ] **Step 5: 跑通已有测试套件**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm test`
Expected: 全部通过。

- [ ] **Step 6: 构建产物做模板/类型健全性检查**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm run build`
Expected: 构建成功，无报错（`watch` 的类型推断依赖 TS 严格模式下 tuple 解构，确认无 TS 报错）。

- [ ] **Step 7: 手动验证（开发模式）**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm run dev`

打开 DevTools（`Cmd+Option+I` 或菜单里的开发者工具）的 Network 面板，筛选 Img 类型请求，在应用内检查：

1. 打开一个有若干张带内嵌缩略图的历史图片消息的会话：初始渲染时 Network 面板不应该同时出现所有历史图片的原图请求；只有滚动到可视区域内的图片，才会看到对应原图 URL 的请求。
2. 等对应图片的原图请求完成后，气泡内图片应无感切换为原图（尺寸不变，仔细看清晰度有提升；肉眼不易分辨时可以对比切换前后 Elements 面板里 `<img src>` 的值确实变成了 `remoteMediaUrl`）。
3. 自己发一张新图片：发送中气泡先展示本地缩略图；发送成功、消息拿到 `remoteMediaUrl` 后，气泡应自动升级为原图，不需要刷新或重新打开会话。
4. 没有内嵌缩略图（只有 `remoteMediaUrl`）的消息，行为和 Task 1 验证时一致，不受本任务影响。

确认无误后关闭 dev 进程。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/chat/MessageBubble.vue
git commit -m "feat: 带缩略图的图片消息滑入可视区域后后台升级为原图"
```

---

### Task 3: 图片预览左右切换（会话内所有已加载图片消息）

**Files:**
- Modify: `src/renderer/src/components/chat/MessageList.vue:168-182`

**Interfaces:**
- Consumes: Task 1、Task 2 完成后的 `MessageBubble.vue`（图片消息仍通过 `n-image` 渲染，具体 props 不影响本任务）。
- Produces: 无新增导出。`<n-image-group>` 是 naive-ui 内置组件，模板里直接用，不需要 import、不需要在 `<script setup>` 里注册。

- [ ] **Step 1: 确认当前代码现状**

Read: `src/renderer/src/components/chat/MessageList.vue:168-182`，确认现状与下方 old_string 一致：

```html
    <div class="messages-scroll" ref="listRef" @scroll="onScroll">
      <div v-if="isLoading" class="loading-tip">
        <div class="loading-dot"></div>
        <div class="loading-dot" style="animation-delay:.15s"></div>
        <div class="loading-dot" style="animation-delay:.3s"></div>
      </div>
      <MessageBubble
        v-for="(msg, idx) in selectedChat.protoMessages"
        :key="(msg as any).messageId"
        :message="msg as any"
        :prev-message="idx > 0 ? (selectedChat.protoMessages[idx - 1] as any) : undefined"
        @contextmenu="(e: MouseEvent) => emit('context-menu', e, msg)"
        @avatar-click="onAvatarClick"
      />
    </div>
```

- [ ] **Step 2: 用 `<n-image-group>` 包裹 `MessageBubble` 列表**

用 Edit 工具把上面的 old_string 替换为：

```html
    <div class="messages-scroll" ref="listRef" @scroll="onScroll">
      <div v-if="isLoading" class="loading-tip">
        <div class="loading-dot"></div>
        <div class="loading-dot" style="animation-delay:.15s"></div>
        <div class="loading-dot" style="animation-delay:.3s"></div>
      </div>
      <n-image-group>
        <MessageBubble
          v-for="(msg, idx) in selectedChat.protoMessages"
          :key="(msg as any).messageId"
          :message="msg as any"
          :prev-message="idx > 0 ? (selectedChat.protoMessages[idx - 1] as any) : undefined"
          @contextmenu="(e: MouseEvent) => emit('context-menu', e, msg)"
          @avatar-click="onAvatarClick"
        />
      </n-image-group>
    </div>
```

说明：`n-image-group` 渲染时不产生影响布局的额外 DOM 容器，可以直接嵌在现有的滚动容器 `.messages-scroll` 内部而不影响滚动/间距。组内所有挂载的 `n-image`（也就是所有图片消息）会自动注册进同一个预览分组；非图片消息不渲染 `n-image`，天然不参与分组。上滑加载更多历史消息（`onScroll` 触发 `msgStore.addOldMessage`）后，新增的图片消息挂载时会自动并入同一个组。

- [ ] **Step 3: 跑通已有测试套件**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm test`
Expected: 全部通过。

- [ ] **Step 4: 构建产物做模板/类型健全性检查**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 5: 手动验证（开发模式）**

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm run dev`

在应用内打开一个至少有 2 张不同图片消息的会话，检查：
1. 点击任意一张图片，弹出大图预览，预览工具栏出现左右切换箭头（而不是改动前的单图无箭头预览）。
2. 点右箭头/左箭头，能切换到该会话内其他图片消息的大图，顺序与消息列表顺序一致。
3. 上滑触发历史消息加载、出现更早的图片消息后，重新打开预览，能切换到新加载出来的历史图片。
4. 切换到另一个会话，预览只在当前会话的图片间切换，不会串到别的会话。

确认无误后关闭 dev 进程。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/chat/MessageList.vue
git commit -m "feat: 图片消息大图预览支持会话内左右切换"
```
