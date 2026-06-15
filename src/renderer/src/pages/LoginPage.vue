<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import {
  LOGIN_API, SNED_VERIFY_CODE_API,
  KEY_VUE_DEVICE_ID, KEY_VUE_USER_ID, KEY_VUE_TOKEN
} from '@/constant'
import { useMessage } from 'naive-ui'

const router = useRouter()
const message = useMessage()

const mobile = ref('')
const code = ref('')
const sendBtnText = ref('发送验证码')
const sendBtnDisabled = ref(true)
const loginBtnDisabled = ref(true)
const loginText = ref('登录')
let countDownTimer: ReturnType<typeof setInterval> | null = null

function validatePhoneOrEmail(input: string) {
  return /^1[3-9]\d{9}$/.test(input) || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(input)
}

function onMobileInput() {
  sendBtnDisabled.value = !(validatePhoneOrEmail(mobile.value) && sendBtnText.value === '发送验证码')
  onCodeInput()
}

function onCodeInput() {
  loginBtnDisabled.value = !(code.value && validatePhoneOrEmail(mobile.value))
}

async function sendVerifyCode() {
  if (!validatePhoneOrEmail(mobile.value)) { message.error('请输入正确的手机号或邮箱'); return }
  sendBtnDisabled.value = true
  try {
    const res = await axios.post(SNED_VERIFY_CODE_API, { mobile: mobile.value }, { headers: { 'Content-Type': 'application/json;charset=UTF-8' } })
    if (res.data.code === 0) {
      let count = 60
      countDownTimer = setInterval(() => {
        sendBtnText.value = `${--count}S`
        if (count === 0) {
          clearInterval(countDownTimer!); sendBtnDisabled.value = false; sendBtnText.value = '发送验证码'
        }
      }, 1000)
    } else { message.error(res.data.message) }
  } catch { message.error('发送失败，请重试') }
}

async function login() {
  let deviceId = localStorage.getItem(KEY_VUE_DEVICE_ID)
  if (!deviceId) { deviceId = uuidv4(); localStorage.setItem(KEY_VUE_DEVICE_ID, deviceId) }
  loginBtnDisabled.value = true; loginText.value = '登录中...'
  try {
    const res = await axios.post(LOGIN_API,
      { mobile: mobile.value, code: code.value, clientId: deviceId },
      { headers: { 'Content-Type': 'application/json;charset=UTF-8' } }
    )
    if (res.data.code === 0) {
      const { userId, token } = res.data.result
      localStorage.setItem(KEY_VUE_USER_ID, userId)
      localStorage.setItem(KEY_VUE_TOKEN, token)
      router.push('/conversation')
    } else {
      message.error(res.data.message)
      loginBtnDisabled.value = false; loginText.value = '登录'
    }
  } catch { message.error('登录失败，请重试'); loginBtnDisabled.value = false; loginText.value = '登录' }
}

function onEnter(e: KeyboardEvent) {
  if (e.key === 'Enter' && !loginBtnDisabled.value) login()
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">
        <div class="logo-wrap">
          <svg class="logo-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <h2>飞享</h2>
        <p class="subtitle">即时通讯 · 安全登录</p>
      </div>
      <div class="form-group">
        <label>手机号码 / 邮箱</label>
        <n-input v-model:value="mobile" placeholder="请输入手机号或邮箱" size="large" @input="onMobileInput" />
      </div>
      <div class="form-group">
        <label>验证码</label>
        <n-input-group>
          <n-input v-model:value="code" placeholder="请输入验证码" size="large" @input="onCodeInput" @keydown="onEnter" style="flex:1" />
          <n-button type="primary" :disabled="sendBtnDisabled" size="large" @click="sendVerifyCode" style="width:120px">
            {{ sendBtnText }}
          </n-button>
        </n-input-group>
      </div>
      <n-button type="primary" block :disabled="loginBtnDisabled" size="large" class="login-btn" @click="login">
        {{ loginText }}
      </n-button>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  width: 100vw; height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-void);
  /* Subtle grid pattern */
  background-image:
    linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
}
.login-card {
  width: 380px;
  padding: 44px 40px;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg), 0 0 60px rgba(99,102,241,0.05);
  position: relative;
  overflow: hidden;
}
/* Top accent line */
.login-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
}
.login-logo { text-align: center; margin-bottom: 36px; }
.logo-wrap {
  width: 64px; height: 64px;
  border-radius: var(--radius-lg);
  background: var(--accent-subtle);
  border: 1px solid var(--border-accent);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 16px;
}
.logo-icon { color: var(--accent); }
.login-logo h2 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
  letter-spacing: -0.5px;
}
.subtitle { font-size: 13px; color: var(--text-muted); }
.form-group { margin-bottom: 18px; }
.form-group label {
  display: block;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 7px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.login-btn { margin-top: 10px; }
</style>
