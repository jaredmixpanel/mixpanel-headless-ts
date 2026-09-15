// Vite compiles the llms plugin's `.vue` component; TypeScript only needs to
// know that such an import is a component.
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent;
  export default component;
}
