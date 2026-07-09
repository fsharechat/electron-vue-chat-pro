# 聊天图片消息：气泡缩略图 + 左右切换预览

## 背景

聊天气泡中的图片消息（`content.type === 3`）用 naive-ui 的 `n-image` 展示。当前实现：

```html
<n-image
  :src="thumbnailSrc || message.content.remoteMediaUrl"
  :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
  width="160" style="border-radius:4px;display:block"
/>
```

- `thumbnailSrc` 来自消息自带的 `binaryContent`（发送方在 `ImageMessageContent` 中把本地生成的小图 base64 编码进 `payload.binaryContent` 一起发出）。
- 当消息没有 `binaryContent`（对端未带缩略图，或历史消息同步时字段缺失）时，`:src` 直接退化为 `remoteMediaUrl` 原图 URL。此时 `n-image` 只设置了 `width="160"`，没有限制高度，长截图等极端长宽比图片会把消息气泡撑得很高（如用户截图所示）。
- 每张 `n-image` 各自独立展示，点击放大后没有左右切换能力，无法在同一会话的多张图片间浏览。

## 目标

1. 气泡内的图片展示统一表现为「缩略图」：等比缩放到一个最大尺寸的盒子内，不裁剪内容，不因为原图分辨率或长宽比把气泡撑得过高/过宽。
2. 点击图片弹出大图预览后，可以左右切换，浏览范围为**当前会话内已经加载到消息列表中的所有图片消息**（含上滑加载的历史消息，不含尚未加载的更早历史）。
3. 不引入后端缩略图接口、不做客户端 canvas 生成/缓存缩略图。气泡内缩略图数据源优先级维持现状：`thumbnailSrc`（消息自带 base64 小图）优先，没有则退化到 `remoteMediaUrl` 原图 URL（原图请求成功后，气泡内展示的就是这张原图，只是被 CSS 限制在缩略图尺寸内，不会占用超额空间）。

## 方案

### 1. 气泡缩略图尺寸（`src/renderer/src/components/chat/MessageBubble.vue`）

去掉 `n-image` 上的 `width="160"` 定宽 prop（会把尺寸固定加到 `<img>` 而不限制高度），改用 `img-props.style` 直接约束 `<img>`：

```html
<n-image
  v-else-if="isImage"
  :src="thumbnailSrc || message.content.remoteMediaUrl"
  :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
  :img-props="{ style: 'max-width:200px;max-height:200px;width:auto;height:auto;object-fit:contain;border-radius:4px;display:block' }"
  lazy
/>
```

- `max-width/max-height: 200px` + `width/height: auto`：图片在 200×200 的上限内等比缩放，不裁剪、不留白（区别于固定盒子 + `object-fit:contain` 会产生的空白留边）。正常比例图片显示效果与之前的 `width:160` 接近；极端长图/宽图会被压缩到 200px 以内，气泡不会再被撑高。
- `border-radius` 直接放在 `img-props.style` 上而不是原来的外层 `style` 属性——之前的写法落到了 `n-image` 外层包裹 `div` 上（naive-ui 把未声明的 attrs 转发给外层 div），由于 div 没有 `overflow:hidden`，圆角其实并未生效；这次顺带修正。
- 新增 `lazy`：naive-ui 原生懒加载支持，图片消息多的会话滚动到可视区域外时不预先加载原图，减轻网络与渲染压力。这是免费的小优化，不改变行为逻辑。
- `:src` / `:preview-src` 的取值逻辑不变。

### 2. 左右切换预览（`src/renderer/src/components/chat/MessageList.vue`）

把渲染消息气泡的 `v-for` 区块包一层 naive-ui 的 `<n-image-group>`（全局已通过 `app.use(naive)` 注册，无需额外 import）：

```html
<div class="messages-scroll" ref="listRef" @scroll="onScroll">
  <div v-if="isLoading" class="loading-tip">...</div>
  <n-image-group>
    <MessageBubble
      v-for="(msg, idx) in selectedChat.protoMessages"
      ...
    />
  </n-image-group>
</div>
```

- `n-image-group` 不引入额外布局包裹（渲染上不产生影响滚动/flex 布局的 DOM 容器），可以直接包在现有滚动容器内部。
- 组内的每个 `n-image` 在挂载时自动向组注册，预览态弹出时左右箭头按注册顺序（即消息在列表中的先后顺序）在组内所有已挂载的图片间切换。非图片消息不渲染 `n-image`，天然被排除在分组之外。
- 上滑触发 `onScroll` 加载更多历史消息后，新的图片消息挂载，自动并入同一个组，无需手动维护图片列表或索引状态。
- 预览态仍然使用各自的 `preview-src`（原图 URL），保证点开看到的是完整分辨率原图，与本次改动前一致。

## 不在本次范围内

- 不对接任何后端缩略图/图片处理接口。
- 不做客户端 canvas 生成缩略图或本地缓存。
- 不改变图片消息的发送/上传/下载流程。
- 不处理"跨会话"或"未加载的更早历史消息"的图片浏览（滚动到顶部之前只在已加载消息范围内切换）。

## 测试

当前代码库没有针对 `MessageBubble.vue` / `MessageList.vue` 图片消息渲染的自动化测试，本次改动不新增测试，仅手动验证：
  1. 一张有 `binaryContent` 缩略图的图片消息，气泡内显示效果与之前一致（不明显变化）。
  2. 一张没有 `binaryContent`、只有 `remoteMediaUrl` 的长截图（极端长宽比）消息，气泡不再被撑得过高。
  3. 同一会话内多张图片消息，点击任意一张打开预览后，可以左右切换到同会话的其他图片；上滑加载更多历史图片消息后新图片能被切换到。
