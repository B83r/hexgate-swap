/** Version affichée dans « À propos ».
 *
 * Vite injecte `package.json` via `define` (voir vite.config.ts) — on garde une
 * constante dédiée pour n'avoir qu'UN endroit à corriger si la source change,
 * et pour ne pas importer package.json dans le bundle. */
export const APP_VERSION: string = __APP_VERSION__;
