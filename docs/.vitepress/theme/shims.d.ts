// Vite compiles the llms plugin's `.vue` component; TypeScript only needs to
// know that such an import is a component.
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}

// Build-time constants Vite substitutes from `vite.define` in `config.mts`.
// The playground's OAuth redirect URI is a constant rather than something
// read from the page so it can never be influenced by input; the live-mode
// flag is the kill switch that hides "Use my own project".
declare const __DEMO_REDIRECT_URI__: string;
declare const __DEMO_LIVE_ENABLED__: boolean;
