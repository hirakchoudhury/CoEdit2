/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the API, e.g. https://coedit-backend.up.railway.app.
   * Leave unset for a same-origin deploy; relative paths are used then.
   */
  readonly VITE_API_URL?: string;
  /**
   * Overrides the WebSocket origin. Normally unnecessary - it is derived
   * from VITE_API_URL.
   */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
