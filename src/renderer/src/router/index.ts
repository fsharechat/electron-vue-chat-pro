import { createRouter, createWebHistory } from 'vue-router'
import { KEY_VUE_USER_ID, KEY_VUE_TOKEN } from '@/constant'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: () => import('@/pages/LoginPage.vue'),
    },
    {
      path: '/',
      component: () => import('@/components/layout/AppLayout.vue'),
      redirect: '/conversation',
      children: [
        {
          path: 'conversation',
          name: 'conversation',
          component: () => import('@/pages/ChatPage.vue'),
        },
        {
          path: 'friend',
          name: 'friend',
          component: () => import('@/pages/FriendPage.vue'),
        },
      ],
    },
  ],
})

router.beforeEach((to, _from, next) => {
  const userId = localStorage.getItem(KEY_VUE_USER_ID)
  const token = localStorage.getItem(KEY_VUE_TOKEN)
  const isLoggedIn = !!userId && !!token
  if (!isLoggedIn && to.path !== '/login') {
    next('/login')
  } else if (isLoggedIn && to.path === '/login') {
    next('/')
  } else {
    next()
  }
})

export default router
