interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_FRONTEND_PORT: string;
  readonly VITE_BACKEND_URL: string;
  readonly VITE_BASE_PATH: string;
  readonly VITE_API_CONTEXT_PATH: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
