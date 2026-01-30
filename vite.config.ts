import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carica le variabili d'ambiente (es. da Vercel)
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    define: {
      // Inietta la chiave API in modo sicuro nel bundle per l'uso lato client
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  };
});