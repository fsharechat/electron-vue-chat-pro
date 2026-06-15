<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUIStore } from '@/stores/useUIStore'
import MyInfotype from '@/websocket/message/myInfoType'
import MessageContentMediaType from '@/websocket/message/messageContentMediaType'
import LocalStore from '@/websocket/store/localstore'
import webSocketClient from '@/websocket/websocketcli'
import { UPLOAD_BY_QINIU, SUCCESS_CODE } from '@/constant'

const props = defineProps<{ userId: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const authStore = useAuthStore()
const uiStore = useUIStore()

const nicknameEl = ref<HTMLElement | null>(null)
const extraEl = ref<HTMLElement | null>(null)
const avatarFileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const userInfo = computed(() => uiStore.userInfoList.find((u: any) => u.uid === props.userId))
const mobile = computed(() => userInfo.value?.mobile || '')

function preventEnter(e: KeyboardEvent) {
  if (e.key === 'Enter') e.preventDefault()
}

function saveNickname(e: FocusEvent) {
  const el = e.target as HTMLElement
  const newName = el.innerText.trim()
  const curName = userInfo.value?.displayName || authStore.user.name
  if (!newName || newName === curName) return
  if (newName.length > 10) {
    el.innerText = curName
    return
  }
  authStore.modifyMyInfo({ type: MyInfotype.Modify_DisplayName, value: newName })
  authStore.user.name = newName
  if (userInfo.value) userInfo.value.displayName = newName
}

function saveExtra(e: FocusEvent) {
  const el = e.target as HTMLElement
  const newExtra = el.innerText.trim()
  const curExtra = userInfo.value?.extra || ''
  if (newExtra === curExtra) return
  authStore.modifyMyInfo({ type: MyInfotype.Modify_Extra, value: newExtra })
  if (userInfo.value) userInfo.value.extra = newExtra
}

function openAvatarPicker() {
  avatarFileInput.value?.click()
}

async function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const key = `${MessageContentMediaType.Image}-${LocalStore.getUserId()}-${Date.now()}-${file.name}`
  uploading.value = true
  try {
    if (UPLOAD_BY_QINIU) {
      // qiniu 上传略，默认走 MinIO
    } else {
      const data = await webSocketClient.getMinioUploadUrl(MessageContentMediaType.Image, key)
      if (data?.code === SUCCESS_CODE) {
        await fetch(data.result.url, { method: 'PUT', body: file })
        const remotePath = `${data.result.domain}/${key}`
        authStore.user.img = remotePath
        authStore.modifyMyInfo({ type: MyInfotype.Modify_Portrait, value: remotePath })
        const userInfo = uiStore.userInfoList.find((u: any) => u.uid === props.userId)
        if (userInfo) userInfo.portrait = remotePath
      }
    }
  } finally {
    uploading.value = false
    input.value = ''
  }
}

function onClickOutside(e: MouseEvent) {
  const card = document.getElementById('personal-card-popup')
  if (card && !card.contains(e.target as Node)) {
    emit('close')
  }
}

onMounted(() => {
  if (nicknameEl.value) {
    nicknameEl.value.innerText = userInfo.value?.displayName || authStore.user.name
  }
  if (extraEl.value) {
    extraEl.value.innerText = userInfo.value?.extra || '备注无'
  }
  setTimeout(() => document.addEventListener('click', onClickOutside), 0)
})
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div class="personal-card" id="personal-card-popup">
    <div class="card-hd">
      <img
        :src="authStore.user.img || '/images/vue.jpg'"
        class="banner-img"
        :class="{ uploading }"
        title="点击更换头像"
        onerror="this.src='/images/vue.jpg'"
        @click="openAvatarPicker"
      />
      <input
        ref="avatarFileInput"
        type="file"
        accept="image/*"
        style="display:none"
        @change="onAvatarChange"
      />
    </div>
    <div class="card-bd">
      <div class="nickname-row">
        <p
          ref="nicknameEl"
          class="nickname"
          contenteditable="true"
          title="点击修改昵称，最长10个字符"
          @keydown="preventEnter"
          @blur="saveNickname"
        ></p>
      </div>
      <div class="meta-area">
        <div class="meta-item">
          <span class="label">备注：</span>
          <p
            ref="extraEl"
            class="value editable"
            contenteditable="true"
            @keydown="preventEnter"
            @blur="saveExtra"
          ></p>
        </div>
        <div v-if="mobile" class="meta-item">
          <span class="label">手机号：</span>
          <span class="value">{{ mobile }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.personal-card {
  position: absolute;
  left: 72px;
  top: 0;
  z-index: 200;
  background: var(--bg-secondary);
  width: 256px;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.22);
  border: 1px solid var(--border);
}

.banner-img {
  width: 256px;
  height: 220px;
  display: block;
  object-fit: cover;
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
  cursor: pointer;
  transition: filter 0.2s;
}
.banner-img:hover {
  filter: brightness(0.85);
}
.banner-img.uploading {
  opacity: 0.6;
  cursor: wait;
}

.card-bd {
  padding: 16px 20px 18px;
}

.nickname-row {
  margin-bottom: 8px;
  line-height: 1.6;
}

.nickname {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  outline: none;
  border-radius: 3px;
  padding: 0 4px;
  margin-left: -4px;
  cursor: text;
  transition: background var(--dur-normal);
}
.nickname:hover,
.nickname:focus {
  background: var(--bg-overlay);
}

.meta-area {
  line-height: 1.8;
}

.meta-item {
  display: flex;
  align-items: baseline;
  overflow: hidden;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.value {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value.editable {
  outline: none;
  border-radius: 3px;
  padding: 0 4px;
  margin-left: -4px;
  cursor: text;
  transition: background var(--dur-normal);
}
.value.editable:hover,
.value.editable:focus {
  background: var(--bg-overlay);
}
</style>
