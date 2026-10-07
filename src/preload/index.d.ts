import type { PosApi } from '../shared/pos-api'

declare global {
  interface Window {
    pos: PosApi
  }
}

export {}
