export { toggleSelectionMode, isInSelectionMode, exitSelectionMode } from './element-capture'
export { startScreenshotMode, isInScreenshotMode, exitScreenshotMode } from './screenshot-capture'
export { cropAndUpload } from './crop-and-upload'
export { captureElement } from './capture-element'
export { detectElementType } from './detect-element-type'

import { cleanupHighlight } from '../../components/highlight-overlay'

export function cleanup() {
  cleanupHighlight()
}

export function exitAllModes() {
  const { exitSelectionMode } = require('./element-capture')
  const { exitScreenshotMode } = require('./screenshot-capture')
  
  exitSelectionMode()
  exitScreenshotMode()
}

