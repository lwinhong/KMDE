import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n } from './i18n'
import './styles/theme.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'

createApp(App).use(i18n).use(createPinia()).mount('#app')
