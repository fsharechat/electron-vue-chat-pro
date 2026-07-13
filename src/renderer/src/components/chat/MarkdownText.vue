<script lang="ts">
// 超长消息(如系统通知日报)折叠阈值:超过则默认只显示纯文本摘要,
// 点击「展开全文」才解析 Markdown 并渲染完整 DOM,避免大表格拖垮会话切换
const COLLAPSE_THRESHOLD = 600
const PREVIEW_LENGTH = 280

// marked.parse 结果的 LRU 缓存:切回会话时组件全部重新挂载,避免重复解析
// 注意必须放在普通 <script> 块(模块作用域),<script setup> 顶层代码是每实例执行的
const MAX_CACHE_SIZE = 100
const parseCache = new Map<string, string>()

// 「展开全文」状态按消息持久(虚拟列表卸载重挂时恢复)
const expandedIds = new Set<string>()
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { marked } from 'marked'

const props = defineProps<{
  content: string
  streaming?: boolean
  messageId?: string
  emojis?: { file: string; code: string; reg: RegExp }[]
}>()

function replaceFace(text: string) {
  if (!text.includes('/:') || !props.emojis) return text
  let result = text
  for (const emoji of props.emojis) {
    result = result.replace(emoji.reg, `<img src="/emoji/${emoji.file}" style="vertical-align:middle;width:24px;height:24px" alt="" />`)
  }
  return result
}

const isCollapsible = computed(() => !props.streaming && (props.content?.length ?? 0) > COLLAPSE_THRESHOLD)
// streaming 中挂载的消息(AI 流式回复)保持展开,结束后也不突然收起;
// 非 streaming 时从模块级 Set 恢复上次的展开状态
const expanded = ref(!!props.streaming || (props.messageId ? expandedIds.has(props.messageId) : false))
watch(expanded, (v) => {
  if (!props.messageId) return
  if (v) expandedIds.add(props.messageId)
  else expandedIds.delete(props.messageId)
})
const collapsed = computed(() => isCollapsible.value && !expanded.value)

const previewText = computed(() => (props.content ?? '').slice(0, PREVIEW_LENGTH) + '…')

const rendered = computed(() => {
  const raw = props.content ?? ''
  // streaming 内容每个 token 都在变化,缓存无意义且会污染缓存
  if (!props.streaming) {
    const cached = parseCache.get(raw)
    if (cached !== undefined) {
      // LRU:命中后移到末尾
      parseCache.delete(raw)
      parseCache.set(raw, cached)
      return cached
    }
  }
  const html = (marked.parse(replaceFace(raw), { breaks: true }) as string).trimEnd()
  if (!props.streaming) {
    if (parseCache.size >= MAX_CACHE_SIZE) {
      parseCache.delete(parseCache.keys().next().value as string)
    }
    parseCache.set(raw, html)
  }
  return html
})
</script>

<template>
  <template v-if="collapsed">
    <div class="markdown-text preview-text">{{ previewText }}</div>
    <button class="md-expand-btn" @click.stop="expanded = true">展开全文</button>
  </template>
  <template v-else>
    <div class="markdown-text" v-html="rendered"></div>
    <button v-if="isCollapsible" class="md-expand-btn" @click.stop="expanded = false">收起</button>
    <span v-if="streaming" class="streaming-cursor">|</span>
  </template>
</template>

<style scoped>
.markdown-text { white-space: normal; word-break: break-word; }
.preview-text { white-space: pre-wrap; }
.md-expand-btn {
  display: block;
  margin-top: 6px;
  padding: 0;
  border: none;
  background: none;
  font-size: 12.5px;
  color: var(--accent);
  cursor: pointer;
}
.bubble-self .md-expand-btn { color: rgba(255, 255, 255, 0.85); text-decoration: underline; text-underline-offset: 2px; }
.streaming-cursor { display: inline-block; margin-left: 2px; animation: blink 0.8s step-start infinite; }
@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
.markdown-text :deep(a) { color: var(--accent); word-break: break-all; }
.markdown-text :deep(code) {
  background: rgba(0, 0, 0, 0.15);
  color: inherit;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
}
.markdown-text :deep(pre) {
  background: rgba(0, 0, 0, 0.15);
  color: inherit;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}
.markdown-text :deep(pre code) {
  background: none;
  padding: 0;
}
.markdown-text :deep(p) { margin: 0; }
.markdown-text :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-table);
  margin: 8px 0;
}
.markdown-text :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 6px 0;
  font-size: 0.9em;
}
.markdown-text :deep(th),
.markdown-text :deep(td) {
  border: 1px solid var(--border-table);
  padding: 5px 10px;
  text-align: left;
}
.markdown-text :deep(th) {
  background: rgba(0, 0, 0, 0.18);
  font-weight: 600;
}
.markdown-text :deep(tr:nth-child(even) td) {
  background: rgba(0, 0, 0, 0.10);
}
</style>
