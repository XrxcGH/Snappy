// The page's only way to reach the shell: window.ipc.postMessage, which stays inside the program.
// Tauri's own sender first tries a request to its own address on localhost, which the page's policy (connect-src 'none') refuses.
// That logged policy violations and console errors on every load before Tauri gave up and used postMessage. This sender
// goes straight to postMessage, so the policy is not tested and nothing is blocked. It is the same message Tauri sends
// after that fallback, with customProtocolIpcBlocked set so the shell answers by script and not by channel.
;(function () {
  const invokeKey = __INVOKE_KEY__
  const toIpc = '__TAURI_TO_IPC_KEY__'

  const replacer = (_key, value) => {
    if (value instanceof Map) return Object.fromEntries(value.entries())
    if (value instanceof Uint8Array) return Array.from(value)
    if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value))
    if (typeof value === 'object' && value !== null && toIpc in value) return value[toIpc]()
    return value
  }

  Object.defineProperty(window.__TAURI_INTERNALS__, 'postMessage', {
    value: function (message) {
      const { cmd, callback, error, payload, options } = message
      window.ipc.postMessage(
        JSON.stringify(
          {
            cmd,
            callback,
            error,
            options: { ...options, customProtocolIpcBlocked: true },
            payload,
            __TAURI_INVOKE_KEY__: invokeKey
          },
          replacer
        )
      )
    }
  })
})()
