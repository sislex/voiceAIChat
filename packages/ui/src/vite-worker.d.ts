// Vite-импорт воркеров Monaco (`?worker`): пакет ui собирается хостом (Vite), а tsc про суффикс не знает.
declare module '*?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}
