<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

const props = defineProps<{
  content: string
  streaming?: boolean
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

const rendered = computed(() => {
  let text = props.content ?? ''
  text = replaceFace(text)
  return (marked.parse(text, { breaks: true }) as string).trimEnd()
})
</script>

<template>
  <div class="markdown-text" v-html="rendered"></div>
  <span v-if="streaming" class="streaming-cursor">|</span>
</template>

<style scoped>
.markdown-text { white-space: normal; word-break: break-word; }
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
