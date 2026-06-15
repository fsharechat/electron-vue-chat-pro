<script setup lang="ts">
import { changelog } from '@/changelog'
const emit = defineEmits<{ (e: 'close'): void }>()
const show = true
const version = __APP_VERSION__
</script>

<template>
  <n-modal :show="show" @update:show="emit('close')" title="关于飞享" preset="dialog" style="width:440px">
    <div class="about-header">
      <img src="/favicon.ico" class="about-logo" />
      <p class="about-name">飞享.{{ version }}</p>
      <p class="about-desc">基于 fsharechat 的开源即时通讯 Web 客户端</p>
      <p class="about-desc">Vue3 + TypeScript + Naive UI 重写版本</p>
    </div>

    <div class="changelog">
      <div class="changelog-title">更新日志</div>
      <div class="changelog-scroll">
        <div v-for="(entry, idx) in changelog" :key="entry.version" class="changelog-entry">
          <div class="entry-header">
            <span class="entry-version">v{{ entry.version }}</span>
            <span v-if="idx === 0" class="entry-badge">最新</span>
            <span class="entry-date">{{ entry.date }}</span>
          </div>
          <ul class="entry-items">
            <li v-for="item in entry.items" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.about-header {
  text-align: center;
  padding: 12px 0 16px;
}
.about-logo {
  width: 64px; height: 64px; border-radius: 12px;
  margin: 0 auto 12px; display: block;
}
.about-name {
  font-size: 16px; font-weight: 600; color: var(--text-primary);
}
.about-desc {
  font-size: 12px; color: var(--text-muted); margin-top: 4px;
}

.changelog {
  border-top: 1px solid var(--border);
  padding-top: 14px;
  margin-top: 4px;
}
.changelog-scroll {
  max-height: 260px;
  overflow-y: auto;
  padding-right: 4px;
}
.changelog-scroll::-webkit-scrollbar { width: 4px; }
.changelog-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.changelog-scroll::-webkit-scrollbar-track { background: transparent; }
.changelog-title {
  font-size: 12px; font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}
.changelog-entry {
  margin-bottom: 14px;
}
.changelog-entry:last-child { margin-bottom: 0; }

.entry-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
}
.entry-version {
  font-size: 13px; font-weight: 600; color: var(--text-primary);
}
.entry-badge {
  font-size: 10px; font-weight: 600;
  background: var(--accent); color: #fff;
  padding: 1px 6px; border-radius: 8px;
}
.entry-date {
  font-size: 11px; color: var(--text-muted);
  margin-left: auto;
}
.entry-items {
  list-style: none; padding: 0; margin: 0;
}
.entry-items li {
  font-size: 12.5px; color: var(--text-secondary);
  padding: 2px 0 2px 14px;
  position: relative;
}
.entry-items li::before {
  content: '·';
  position: absolute; left: 4px;
  color: var(--accent);
  font-weight: 700;
}
</style>
