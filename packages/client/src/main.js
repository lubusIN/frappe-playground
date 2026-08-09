import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import './style.css'

window.__FRAPPE_PLAYGROUND_MOUNTED__ = true
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/:pathMatch(.*)*',
      component: { render: () => null },
    },
  ],
})

createApp(App).use(router).mount('#app')
sessionStorage.removeItem('frappe_playground_shell_recovery')
