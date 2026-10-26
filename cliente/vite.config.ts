import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    // Desarrollo: la API del 1B (Docker) en :8080. changeOrigin: false conserva el
    // Host del navegador, así Origin == Host y el servidor no responde 403
    // origen_invalido (docs/api.md §1.2).
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: false },
    },
  },
  build: {
    // El camino del laboratorio pesa unos 650 kB y MathLive (carga diferida) unos 810 kB;
    // el revisor y la administración van en sus propios chunks. Con este límite, el aviso
    // vuelve a significar que algo creció de más.
    chunkSizeWarningLimit: 850,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
