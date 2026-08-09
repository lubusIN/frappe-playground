import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

window.__FRAPPE_PLAYGROUND_MOUNTED__ = true
createApp(App).mount('#app')
sessionStorage.removeItem('frappe_playground_shell_recovery')
