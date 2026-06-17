import { createApp } from 'vue'
import { createPinia } from 'pinia'
import naive from 'naive-ui'
import App from './App.vue'
import router from './router'
import './styles/variables.css'
import './styles/reset.css'
import { installConsoleTimestamp } from './websocket/utils/logger'

installConsoleTimestamp()

const isOverlay = new URLSearchParams(window.location.search).has('overlay')

const app = createApp(App)
app.use(createPinia())
if (!isOverlay) app.use(router)
app.use(naive)
app.mount('#app')
