/**
 * Save a Blob, or text, as a file through a Blob link. Some sandboxes block downloads without any
 * signal, which is why every "Save" button has a "Copy" button beside it where text is concerned.
 */
export function saveBlob(fileName: string, blob: Blob): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

export function saveTextFile(fileName: string, text: string, mime: string): boolean {
  return saveBlob(fileName, new Blob([text], { type: `${mime};charset=utf-8` }));
}
