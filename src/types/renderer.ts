export enum WorkerMessageType {
  INIT = "init",
  RESIZE = "resize",
  CACHE_IMAGE = "cache_image",
  RENDER_PAGE = "render_page",
  RENDER_PANEL = "render_panel",
  CLEAR_CACHE = "clear_cache",
  TERMINATE = "terminate",
  RENDERED = "rendered",
  CACHE_PRUNED = "cache_pruned",
  ERROR = "error",
}
