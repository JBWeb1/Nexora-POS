import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the build work from any folder, including inside the desktop app.
export default defineConfig({ base: './', plugins: [react()] });
