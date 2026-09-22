import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/theme.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'

createApp(App).use(createPinia()).mount('#app')
