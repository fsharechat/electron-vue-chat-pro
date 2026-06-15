<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import AMapLoader from '@amap/amap-jsapi-loader'

const props = defineProps<{
  title: string
  thumbnail: string   // base64，不含 data:image/png;base64, 前缀
  lat: number
  long: number
}>()

const showMap = ref(false)
const mapRef = ref<HTMLElement>()
let mapInstance: any = null

const thumbnailSrc = `data:image/png;base64,${props.thumbnail}`

async function openMap() {
  showMap.value = true
  // 等 DOM 挂载
  await new Promise(r => setTimeout(r, 50))
  if (!mapRef.value) return
  try {
    const AMap = await AMapLoader.load({
      key: '4f611f19dee1fc6b89506aa88da5f522',
      version: '2.0',
      plugins: []
    })
    mapInstance = new AMap.Map(mapRef.value, {
      zoom: 14,
      center: [props.long, props.lat]
    })
    new AMap.Marker({
      position: [props.long, props.lat],
      map: mapInstance
    })
  } catch (e) {
    console.error('地图加载失败', e)
  }
}

function closeMap() {
  showMap.value = false
  mapInstance?.destroy()
  mapInstance = null
}

onUnmounted(() => {
  mapInstance?.destroy()
})
</script>

<template>
  <!-- 位置消息卡片 -->
  <div class="location-card" @click="openMap">
    <img class="location-thumb" :src="thumbnailSrc" alt="位置" />
    <div class="location-footer">
      <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" class="pin-icon">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>
      <span class="location-title">{{ title }}</span>
    </div>
  </div>

  <!-- 地图弹窗 -->
  <Teleport to="body">
    <div v-if="showMap" class="map-overlay" @click.self="closeMap">
      <div class="map-dialog">
        <div class="map-header">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" class="pin-icon">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
          </svg>
          <span class="map-title">{{ title }}</span>
          <button class="map-close" @click="closeMap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div ref="mapRef" class="map-container"></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── 消息气泡内的卡片 ────────────────────── */
.location-card {
  width: 180px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--border);
  transition: opacity 150ms;
}
.location-card:hover { opacity: 0.85; }

.location-thumb {
  width: 100%;
  height: 110px;
  object-fit: cover;
  display: block;
}

.location-footer {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 8px;
  background: var(--bg-elevated);
}
.pin-icon { color: var(--danger); flex-shrink: 0; }
.location-title {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 地图弹窗 ────────────────────────────── */
.map-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.map-dialog {
  width: 640px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0,0,0,0.4);
  background: #fff;
}

.map-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #eee;
}
.map-title {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.map-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: #999;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.map-close:hover { background: #f5f5f5; color: #333; }

.map-container {
  width: 100%;
  height: 420px;
}
</style>
