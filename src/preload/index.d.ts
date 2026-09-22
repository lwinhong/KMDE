import type { KmdeApi } from './index'

declare global {
  interface Window {
    kmde: KmdeApi
  }
}

export {}
