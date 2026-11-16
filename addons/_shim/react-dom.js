// Add-ons share the host renderer, including portal and synchronous update support.
const R = window.__atlasHost.ReactDOM
export default R
export const { createPortal, flushSync, preconnect, prefetchDNS, preinit, preinitModule, preload, preloadModule, requestFormReset, useFormStatus, useFormState, version } = R
