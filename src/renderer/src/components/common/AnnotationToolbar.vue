<script setup lang="ts">
export type AnnotationTool = 'rect' | 'arrow' | 'text' | 'mosaic'

const COLORS = ['#f5222d', '#fa8c16', '#fadb14', '#52c41a', '#1890ff', '#722ed1', '#ffffff', '#000000']

defineProps<{
  activeTool: AnnotationTool | null
  activeColor: string
  canUndo: boolean
}>()

const emit = defineEmits<{
  selectTool: [tool: AnnotationTool]
  selectColor: [color: string]
  undo: []
  save: []
  cancel: []
  confirm: []
}>()
</script>

<template>
  <div class="ann-toolbar" @click.stop>
    <!-- 工具 -->
    <div class="ann-group">
      <button :class="['ann-btn', { active: activeTool === 'rect' }]" data-tool="rect" title="矩形" @click="emit('selectTool', 'rect')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/></svg>
      </button>
      <button :class="['ann-btn', { active: activeTool === 'arrow' }]" data-tool="arrow" title="箭头" @click="emit('selectTool', 'arrow')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>
      </button>
      <button :class="['ann-btn', { active: activeTool === 'text' }]" data-tool="text" title="文字" @click="emit('selectTool', 'text')">
        <span style="font-size:14px;font-weight:700">T</span>
      </button>
      <button :class="['ann-btn', { active: activeTool === 'mosaic' }]" data-tool="mosaic" title="马赛克" @click="emit('selectTool', 'mosaic')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="2" width="9" height="9"/><rect x="13" y="2" width="9" height="9"/><rect x="2" y="13" width="9" height="9"/><rect x="13" y="13" width="9" height="9"/></svg>
      </button>
    </div>

    <div class="ann-divider" />

    <!-- 颜色 -->
    <div class="ann-group ann-colors">
      <button
        v-for="c in COLORS"
        :key="c"
        class="color-dot"
        :class="{ selected: activeColor === c }"
        :data-color="c"
        :style="{ background: c, outline: c === '#ffffff' ? '1px solid #aaa' : 'none' }"
        :title="c"
        @click="emit('selectColor', c)"
      />
    </div>

    <div class="ann-divider" />

    <!-- 操作 -->
    <div class="ann-group">
      <button class="ann-btn" data-action="undo" title="撤销" :disabled="!canUndo" @click="emit('undo')">↺</button>
      <button class="ann-btn" data-action="save" title="保存到本地" @click="emit('save')">⬇</button>
      <button class="ann-btn ann-btn--cancel" data-action="cancel" title="取消" @click="emit('cancel')">✕</button>
      <button class="ann-btn ann-btn--confirm" data-action="confirm" title="确认" @click="emit('confirm')">✓</button>
    </div>
  </div>
</template>

<style scoped>
.ann-toolbar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10001;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(30, 30, 40, 0.92);
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  backdrop-filter: blur(8px);
  user-select: none;
}

.ann-group { display: flex; align-items: center; gap: 4px; }

.ann-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.2); margin: 0 4px; }

.ann-btn {
  width: 30px; height: 30px;
  border: none; border-radius: 5px;
  background: transparent;
  color: #e0e0e0;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
  transition: background 120ms;
}
.ann-btn:hover { background: rgba(255,255,255,0.15); }
.ann-btn.active { background: #1890ff; color: #fff; }
.ann-btn:disabled { opacity: 0.35; cursor: default; pointer-events: none; }
.ann-btn--cancel:hover { background: rgba(255,77,79,0.7); }
.ann-btn--confirm { background: #1890ff; color: #fff; }
.ann-btn--confirm:hover { background: #40a9ff; }

.ann-colors { gap: 5px; }
.color-dot {
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 120ms;
}
.color-dot:hover { transform: scale(1.2); }
.color-dot.selected { border-color: #fff; transform: scale(1.15); }
</style>
