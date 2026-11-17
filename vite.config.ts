import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[tailwindcss()],build:{rollupOptions:{output:{inlineDynamicImports:true}},assetsInlineLimit:10000000,cssCodeSplit:false,modulePreload:false}});
