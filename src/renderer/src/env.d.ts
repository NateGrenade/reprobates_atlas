/// <reference types="vite/client" />
import type { AtlasApi } from '../../preload/index'
declare global {
  interface Window {
    atlas: AtlasApi
  }
}
export {}
