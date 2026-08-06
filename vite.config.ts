/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const entry = (file: string) => fileURLToPath(new URL(file, import.meta.url))

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    rollupOptions: {
      // 창별로 별도 HTML 엔트리 (main / overlay / settings)
      input: {
        main: entry('./index.html'),
        overlay: entry('./overlay.html'),
        settings: entry('./settings.html'),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  //
  // 기본값 1420/1421 을 쓰지 않는 이유: Windows(Hyper-V/WinNAT)가 재부팅마다 임의의
  // TCP 구간을 예약하는데, 이 PC 에서 1336–1435 가 잡혀 `listen EACCES` 로 죽었다.
  // 확인: netsh interface ipv4 show excludedportrange protocol=tcp
  // 5183/5184 도 언젠가 예약 구간에 걸리면 같은 방식으로 비어 있는 번호로 옮기면 된다.
  // 바꿀 때는 src-tauri/tauri.conf.json 의 build.devUrl 도 같이 고칠 것.
  server: {
    port: 5183,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5184,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },

  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
  },
}))
