<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useMessage } from 'naive-ui'
import type { FriendInfo } from '@/types'
import webSocketClient from '@/websocket/websocketcli'

const props = defineProps<{ friend: FriendInfo }>()
const emit = defineEmits<{ (e: 'send-message'): void }>()
const message = useMessage()

const editing = ref(false)
const remarkInput = ref(props.friend.remark || '')

function fetchFriendInfo(wxid: string) {
  webSocketClient.getUserInfos([wxid])
}

onMounted(() => fetchFriendInfo(props.friend.wxid))
watch(() => props.friend.wxid, fetchFriendInfo)

function startEdit() {
  remarkInput.value = props.friend.remark || ''
  editing.value = true
}

async function saveRemark() {
  try {
    await webSocketClient.modifyFriendAlias(props.friend.wxid, remarkInput.value)
    editing.value = false
    message.success('备注已更新')
  } catch { message.error('更新失败') }
}
</script>

<template>
  <div class="friend-detail">
    <!-- 顶部标题栏 -->
    <div class="detail-header">
      <span class="header-name">{{ friend.nickname }}</span>
    </div>

    <!-- 头像 + 昵称区域 -->
    <div class="profile-section">
      <div class="profile-left">
        <div class="name-row">
          <span class="display-name">{{ friend.nickname }}</span>
          <svg v-if="friend.sex === 1" class="gender-icon male" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M9 11.75A2.25 2.25 0 1 0 9 16.25 2.25 2.25 0 0 0 9 11.75zM15 2l1.55 1.55-2.1 2.1A5.24 5.24 0 0 1 16 9.25c0 2.9-2.35 5.25-5.25 5.25S5.5 12.15 5.5 9.25 7.85 4 10.75 4c1.05 0 2.03.32 2.84.86L15.7 2.84 17.25 2H15zm-4.25 3.5c-2.07 0-3.75 1.68-3.75 3.75S8.68 13 10.75 13s3.75-1.68 3.75-3.75S12.82 5.5 10.75 5.5z"/>
          </svg>
          <svg v-else-if="friend.sex === 0" class="gender-icon female" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm1 2.06V13h2v2h-2v2h-2v-2H9v-2h2v-.94A7.002 7.002 0 0 1 12 2a7 7 0 0 1 1 13.06z"/>
          </svg>
        </div>
      </div>
      <img
        :src="friend.img || '/images/vue.jpg'"
        class="profile-avatar"
        onerror="this.src='/images/vue.jpg'"
      />
    </div>

    <div class="divider" />

    <!-- 详情信息 -->
    <div class="info-section">
      <div class="info-row">
        <span class="label">备　注</span>
        <div v-if="!editing" class="value-wrap">
          <span class="value">{{ friend.remark || '' }}</span>
          <button class="edit-btn" @click="startEdit">编辑</button>
        </div>
        <div v-else class="value-wrap editing">
          <n-input
            v-model:value="remarkInput"
            size="small"
            style="flex: 1"
            @keydown.enter="saveRemark"
          />
          <button class="edit-btn" @click="saveRemark">保存</button>
          <button class="edit-btn" @click="editing = false">取消</button>
        </div>
      </div>
      <div class="info-row">
        <span class="label">地　区</span>
        <span class="value">{{ friend.area || '' }}</span>
      </div>
      <div class="info-row">
        <span class="label">飞享号</span>
        <span class="value">{{ friend.wxid }}</span>
      </div>
      <div class="info-row">
        <span class="label">手机号</span>
        <span class="value">{{ friend.mobile || '' }}</span>
      </div>
      <div class="info-row">
        <span class="label">邮　箱</span>
        <span class="value">{{ friend.email || '' }}</span>
      </div>
    </div>

    <div class="divider" />

    <!-- 操作按钮 -->
    <div class="actions">
      <button class="send-btn" @click="emit('send-message')">发消息</button>
    </div>
  </div>
</template>

<style scoped>
.friend-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-base);
  overflow-y: auto;
}

/* ── 顶部标题栏 ─────────────────────────── */
.detail-header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.header-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

/* ── 主内容区 ────────────────────────────── */
.profile-section,
.divider,
.info-section,
.actions {
  margin-left: 48px;
  margin-right: 48px;
}
.profile-section { margin-top: 40px; }

/* ── 头像 + 昵称 ─────────────────────────── */
.profile-section {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 32px;
}

.profile-left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-top: 8px;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.display-name {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.2px;
}

.gender-icon {
  flex-shrink: 0;
  margin-top: 2px;
}
.gender-icon.male  { color: #5b8def; }
.gender-icon.female { color: #f27088; }

.profile-avatar {
  width: 90px;
  height: 90px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border);
}

/* ── 分隔线 ─────────────────────────────── */
.divider {
  height: 1px;
  background: var(--border);
  margin-top: 0;
  margin-bottom: 0;
}

/* ── 详情信息 ────────────────────────────── */
.info-section {
  padding: 8px 0;
}

.info-row {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 2px 0;
}

.label {
  width: 60px;
  font-size: 13px;
  color: var(--text-muted);
  flex-shrink: 0;
  letter-spacing: 1px;
}

.value-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.value-wrap.editing {
  gap: 6px;
}

.value {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
}

.edit-btn {
  padding: 3px 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: background var(--dur-normal), color var(--dur-normal);
}
.edit-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

/* ── 操作按钮 ────────────────────────────── */
.actions {
  display: flex;
  justify-content: center;
  padding: 28px 0 0;
}

.send-btn {
  width: 200px;
  height: 40px;
  border: none;
  border-radius: 6px;
  background: #07c160;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--dur-normal);
}
.send-btn:hover { background: #06ad56; }
.send-btn:active { background: #059a4c; }
</style>
