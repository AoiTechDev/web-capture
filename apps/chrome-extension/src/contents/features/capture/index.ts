export { toggleSelectionMode, isInSelectionMode, exitSelectionMode } from './element-capture'
export { startScreenshotMode, isInScreenshotMode, exitScreenshotMode, captureViewport } from './screenshot-capture'
export { toggleImagePickerMode, isInImagePickerMode, exitImagePickerMode } from './image-picker'
export { captureElement } from './capture-element'
export { detectElementType } from './detect-element-type'

import { cleanupHighlight } from '../../components/highlight-overlay'

export function cleanup() {
  cleanupHighlight()
}

export function exitAllModes() {
  const { exitSelectionMode } = require('./element-capture')
  const { exitScreenshotMode } = require('./screenshot-capture')
  const { exitImagePickerMode } = require('./image-picker')

  exitSelectionMode()
  exitScreenshotMode()
  exitImagePickerMode()
}

