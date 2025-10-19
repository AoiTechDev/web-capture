// Main capture module exports
export { toggleSelectionMode, isInSelectionMode, exitSelectionMode } from './element-capture'
export { startScreenshotMode, isInScreenshotMode, exitScreenshotMode } from './screenshot-capture'
export { cropAndUpload } from './crop-and-upload'
export { captureElement } from './capture-element'
export { detectElementType } from './detect-element-type'

// Cleanup function
import { cleanupHighlight } from '../../components/highlight-overlay'

export function cleanup() {
  cleanupHighlight()
}

// Exit all modes helper
export function exitAllModes() {
  const { exitSelectionMode } = require('./element-capture')
  const { exitScreenshotMode } = require('./screenshot-capture')
  
  exitSelectionMode()
  exitScreenshotMode()
}

