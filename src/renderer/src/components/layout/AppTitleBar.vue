<script setup lang="ts">
function minimize() { window.electronAPI?.windowControl('minimize') }
function maximize() { window.electronAPI?.windowControl('maximize') }
function close()    { window.electronAPI?.windowControl('close') }
</script>

<template>
  <div class="title-bar">
    <div class="title-bar__drag" />
    <div class="title-bar__controls">
      <button data-action="minimize" class="ctrl-btn" title="最小化" @click="minimize">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button data-action="maximize" class="ctrl-btn" title="最大化" @click="maximize">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="none" stroke="currentColor"/></svg>
      </button>
      <button data-action="close" class="ctrl-btn ctrl-btn--close" title="关闭" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor"/>
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--bg-sidebar, #1e1e2e);
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
}

.title-bar__drag {
  flex: 1;
}

.title-bar__controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.ctrl-btn {
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #888);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  padding: 0;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.ctrl-btn--close:hover {
  background: #e81123;
  color: #fff;
}
</style>
