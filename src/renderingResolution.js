export const RENDERING_RESOLUTIONS = Object.freeze({
  native: null, '1920x1080': [1920, 1080], '1600x900': [1600, 900], '1280x720': [1280, 720],
});
export function normalizeRenderingResolution(value) {
  return Object.hasOwn(RENDERING_RESOLUTIONS, value) ? value : 'native';
}
export function renderingSize(width, height, dpr, presetLimit, renderScale, resolution) {
  width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
  resolution = normalizeRenderingResolution(resolution);
  const target = RENDERING_RESOLUTIONS[resolution];
  // Fixed choices fit inside the requested pixel budget at the viewport's
  // aspect ratio. DPR and supersampling apply only to Native, exactly once.
  const pixelRatio = target ? Math.min(target[0] / width, target[1] / height)
    : Math.min(dpr, presetLimit) * renderScale;
  return { width, height, pixelRatio, resolution,
    bufferWidth: Math.max(1, Math.floor(width * pixelRatio)),
    bufferHeight: Math.max(1, Math.floor(height * pixelRatio)) };
}
