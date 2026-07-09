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
3. 带内嵌缩略图（`binaryContent`）的图片消息，气泡滑入可视区域后，后台预加载对应的 `remoteMediaUrl` 原图，加载完成后把气泡内显示自动升级为原图（仍受第 1 点的最大尺寸约束，不会变大），而不是永远停留在内嵌小图的清晰度。不带内嵌缩略图的消息本来就是直接用 `remoteMediaUrl` 渲染，不需要额外处理。
4. 不引入后端缩略图接口、不做客户端 canvas 生成/缓存缩略图。

## 方案

### 1. 气泡缩略图尺寸（`src/renderer/src/components/chat/MessageBubble.vue`）

去掉 `n-image` 上的 `width="160"` 定宽 prop（会把尺寸固定加到 `<img>` 而不限制高度），改用 `img-props.style` 直接约束 `<img>`：

```html
<n-image
  v-else-if="isImage"
  :src="bubbleImageSrc"
  :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
  :img-props="{ style: 'max-width:200px;max-height:200px;width:auto;height:auto;object-fit:contain;border-radius:4px;display:block' }"
  lazy
  @load="onThumbnailLoad"
/>
```

- `max-width/max-height: 200px` + `width/height: auto`：图片在 200×200 的上限内等比缩放，不裁剪、不留白（区别于固定盒子 + `object-fit:contain` 会产生的空白留边）。正常比例图片显示效果与之前的 `width:160` 接近；极端长图/宽图会被压缩到 200px 以内，气泡不会再被撑高。
- `border-radius` 直接放在 `img-props.style` 上而不是原来的外层 `style` 属性——之前的写法落到了 `n-image` 外层包裹 `div` 上（naive-ui 把未声明的 attrs 转发给外层 div），由于 div 没有 `overflow:hidden`，圆角其实并未生效；这次顺带修正。
- 新增 `lazy`：naive-ui 原生懒加载支持（底层用 `<img loading="lazy">`），图片消息多的会话滚动到可视区域外时不预先加载，减轻网络与渲染压力。
- `:src` 从原来的 `thumbnailSrc || message.content.remoteMediaUrl` 静态表达式改成 `bubbleImageSrc` computed（见第 2 节），`:preview-src` 取值逻辑不变。

### 2. 可见后台升级为原图（`src/renderer/src/components/chat/MessageBubble.vue`）

目的：带内嵌缩略图的消息，缩略图气泡滑入可视区域后才在后台预加载原图，加载完成后把 `:src` 切到原图，仍受第 1 节的最大尺寸约束——既不会因为一次性打开长会话就对几十张历史图片同时发起原图请求（复用 `lazy` 的可见性语义），也不会让带缩略图的消息永远停留在低清晰度上。

```js
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

```html
<n-image v-else-if="isImage"
  :src="bubbleImageSrc"
  :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
  :img-props="{ style: 'max-width:200px;max-height:200px;width:auto;height:auto;border-radius:4px;display:block' }"
  lazy
  :intersection-observer-options="{}"
  @load="onThumbnailLoad"
/>
```

- `onThumbnailLoad` 绑定在 `n-image` 的 `@load` 上，触发条件依赖 `:intersection-observer-options="{}"`：**修正**——最初设计以为单独一个 `lazy` prop 就足够让 `@load` 只在气泡真正可见时触发，实测（读 `node_modules/naive-ui/es/image/src/Image.mjs`）发现不成立：`lazy` 单独使用时，naive-ui 只是给 `<img>` 加原生 `loading="lazy"` 属性，`:src` 仍然是立即赋值的；原生 `loading="lazy"` 只延迟网络请求，对带内嵌缩略图消息用的 `data:` base64 URI 完全不生效（本地解码不需要网络，浏览器不会延迟），导致 `@load` 在挂载后几乎立刻触发，可见性判断形同虚设——打开一个有很多带缩略图历史消息的长会话，会瞬间对所有这些消息发起原图预加载请求，正是当初想避免的问题。修复：同时传 `:intersection-observer-options="{}"`，这会激活 naive-ui `n-image` 内部真正基于 `IntersectionObserver` 的可见性判断（`lazy && intersectionObserverOptions` 都为真时才走这条路径），只有元素真正进入可视区域，`:src` 才会被赋值、`@load` 才会触发。这仍然是复用 naive-ui 自带的能力，不是我们自己写 `IntersectionObserver`，但底层确实会创建一个真实的 `IntersectionObserver` 实例——**因此下方"不在本次范围内"里"不引入 IntersectionObserver"这条约束已废止**，改为"不自己实现 IntersectionObserver，只通过 naive-ui 的 `intersection-observer-options` 选项使用它内置的实现"。
- `watch` 同时依赖 `hasBecomeVisible` 和 `remoteMediaUrl`：覆盖两种到达顺序——(a) 消息一开始就有原图 URL，只是气泡还没滑入可视区域，等滑入触发 `onThumbnailLoad` 后再预加载；(b) 气泡早就可见（缩略图已经加载完成），但当时是自己刚发送、还在上传中，`remoteMediaUrl` 还没写回消息，等上传完成后 `remoteMediaUrl` 变为可用值时自动补触发预加载。
- 用 `new Image()` 在后台发起一次原图请求，不影响当前气泡的展示；`onload` 里才把 `upgradedSrc` 置为该 URL，`bubbleImageSrc` 随之切到原图，`n-image` 收到新的 `:src` 会更新 `<img>`（此时原图已经在浏览器缓存里，基本是本地读取，不会有第二次真实网络等待）。
- 不带 `binaryContent` 的消息：`thumbnailSrc` 恒为空字符串，`watch` 里 `!thumbnailSrc.value` 直接短路跳过，行为和现状一致——`bubbleImageSrc` 直接落到 `message.content.remoteMediaUrl`，由 `n-image` 自己的懒加载机制去加载。
- 不做额外的取消/清理逻辑：组件卸载后 `new Image()` 对象失去引用会被浏览器正常回收，其请求即使继续完成也只是预热了浏览器缓存，没有副作用。
- `img-props.style` 里去掉了原先的 `object-fit:contain`：由于 `width/height` 都是 `auto`、只有 `max-width/max-height` 约束，`<img>` 的盒子必然和缩放后的图片尺寸完全一致，`object-fit` 不会有任何视觉效果（而且 naive-ui 自己的 `objectFit` prop 默认值 `'fill'` 会在渲染时追加在 `imgProps.style` 之后，静默覆盖掉它）——这行字符串纯属死代码，删掉即可，不用额外加 `object-fit="contain"` 这个 prop。

### 3. 左右切换预览（`src/renderer/src/components/chat/MessageList.vue`）

把渲染消息气泡的 `v-for` 区块包一层 naive-ui 的 `<n-image-group>`（全局已通过 `app.use(naive)` 注册，无需额外 import）：

```html
<div class="messages-scroll" ref="listRef" @scroll="onScroll">
  <div v-if="isLoading" class="loading-tip">...</div>
  <n-image-group :key="selectTarget">
    <MessageBubble
      v-for="(msg, idx) in selectedChat.protoMessages"
      ...
    />
  </n-image-group>
</div>
```

- `n-image-group` 不引入额外布局包裹（渲染上不产生影响滚动/flex 布局的 DOM 容器），可以直接包在现有滚动容器内部。
- 组内的每个 `n-image` 在挂载时自动向组注册，预览态弹出时左右箭头按注册顺序（即消息在列表中的先后顺序）在组内所有已挂载的图片间切换。非图片消息不渲染 `n-image`，天然被排除在分组之外。
- 上滑触发 `onScroll` 加载更多历史消息后，新的图片消息挂载，自动并入同一个组，无需手动维护图片列表或索引状态。**已知遗留问题**：注册顺序是"组件挂载时机"，不是"消息的可视顺序"——上滑加载出来的历史消息虽然显示在最上面，但因为是后挂载的，会被排到左右切换轮播的最后（不会丢失，切换仍能到达每一张图，只是顺序在这种场景下不完全对应视觉顺序）。真正修好需要改用 `n-image-group` 的 `src-list` + 手动 `toggleShow(index)` 这套受控模式（放弃 `n-image` 自带的点击预览，由父组件按消息顺序维护一份 URL 数组），是比这次改动大的架构调整，本次不做，留作后续优化项。
- **`:key="selectTarget"`**：`ChatPage.vue` 里 `<MessageList>` 外层是 `v-if="convStore.selectTarget"`，在两个会话间切换（target 都非空）时不会重新挂载 `MessageList`，`<n-image-group>` 会是同一个实例。而 naive-ui 2.44.1 的 `unregisterPreviewUrl` 有个反了的判断条件（`ImageGroup.mjs` 里 `if (!map.has(sid)) map.delete(sid)`，永远不会真正删除已注册的 URL），导致旧会话的图片 URL 会一直留在分组里，串进下一个会话的左右切换。加 `:key="selectTarget"` 让 Vue 在会话切换时销毁重建整个 `<n-image-group>`（`selectTarget` 是 `MessageList.vue` 里已有的 `storeToRefs(convStore)` 解构出的 ref），从根上避免残留。
- 预览态仍然使用各自的 `preview-src`（原图 URL），保证点开看到的是完整分辨率原图，与本次改动前一致。

## 不在本次范围内

- 不对接任何后端缩略图/图片处理接口。
- 不做客户端 canvas 生成缩略图或本地缓存。
- 不改变图片消息的发送/上传流程；不改变消息本身的下载/持久化逻辑（原图预加载只是渲染层的 `new Image()` 预热浏览器缓存，不写入任何本地存储）。
- 不处理"未加载的更早历史消息"的图片浏览（滚动到顶部之前只在已加载消息范围内切换）；"跨会话"通过第 3 节的 `:key="selectTarget"` 明确阻止，不是"不处理"，是必须阻止的边界。
- 不做已升级为原图后的"降级回缩略图"或手动控制清晰度的入口。
- 不自己实现 `IntersectionObserver`；只通过 naive-ui `n-image` 的 `intersection-observer-options` 选项使用它内置的实现（第 2 节已修正，原先"不引入 IntersectionObserver"的说法基于错误假设，已废止）。
- 不修复"上滑加载历史消息后左右切换顺序不完全对应视觉顺序"这个已知遗留问题（见第 3 节说明），需要时再单独立项。

## 测试

当前代码库没有针对 `MessageBubble.vue` / `MessageList.vue` 图片消息渲染的自动化测试，本次改动不新增测试，仅手动验证：
  1. 一张有 `binaryContent` 缩略图的图片消息，气泡内先展示内嵌小图，滑入可视区域后应在原图加载完成时无感切换为原图（尺寸不变，仅清晰度提升）。
  2. 一张没有 `binaryContent`、只有 `remoteMediaUrl` 的长截图（极端长宽比）消息，气泡不再被撑得过高。
  3. 长会话（几十条历史图片消息）打开时，不应在初始渲染瞬间对所有历史图片同时发起原图请求——只有滚动到可视区域的才会触发预加载（可用浏览器 DevTools 的 Network 面板观察请求时机）。
  4. 自己发送一张图片：发送中气泡展示本地生成的缩略图；上传完成、消息拿到 `remoteMediaUrl` 后，气泡应自动升级为原图。
  5. 同一会话内多张图片消息，点击任意一张打开预览后，可以左右切换到同会话的其他图片；上滑加载更多历史图片消息后新图片能被切换到。
