/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/personal-wealth-management/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
  },
})
