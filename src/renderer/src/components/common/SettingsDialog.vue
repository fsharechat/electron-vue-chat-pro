<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useTranscriptStore } from '@/stores/useTranscriptStore'

const emit = defineEmits<{ (e: 'close'): void }>()
const transcriptStore = useTranscriptStore()
const { autoTranscribe } = storeToRefs(transcriptStore)
</script>

<template>
  <n-modal :show="true" @update:show="emit('close')" title="设置" preset="dialog" style="width:400px">
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-title">自动转文字</div>
        <div class="setting-desc">收到语音消息时自动转成文字显示在气泡下方</div>
      </div>
      <n-switch :value="autoTranscribe" @update:value="transcriptStore.setAutoTranscribe" />
    </div>
  </n-modal>
</template>

<style scoped>
.setting-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 0;
}
.setting-title { font-size: 14px; color: var(--text-primary); }
.setting-desc { margin-top: 4px; font-size: 12px; color: var(--text-muted); }
</style>
