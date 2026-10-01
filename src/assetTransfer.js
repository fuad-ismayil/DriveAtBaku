// Read fetch bodies incrementally so slow connections report received bytes,
// rather than jumping forward only when a whole 48 MiB map part has arrived.
export async function fetchAssetBytes(url, onProgress, { signal, expectedBytes = 0 } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Asset ${url} could not be loaded (${response.status}).`);
  const length = Number(response.headers.get('content-length')) || 0;
  const total = expectedBytes || (response.headers.get('content-encoding') ? 0 : length);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength, complete: true });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  onProgress?.({ loaded, total: loaded, complete: true });
  return bytes;
}
