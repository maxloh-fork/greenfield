'use strict'

import JpegRenderState from './JpegRenderState'
import JpegAlphaSurfaceShader from './JpegAlphaSurfaceShader'
import EncodingOptions from '../EncodingOptions'
import JpegSurfaceShader from './JpegSurfaceShader'
import H264RenderState from './H264RenderState'
import YUVASurfaceShader from './YUVASurfaceShader'
import YUVSurfaceShader from './YUVSurfaceShader'
import EncodedFrame from '../EncodedFrame'

export default class Renderer {
  /**
   * @returns {Renderer}
   */
  static create () {
    // create offscreen gl context
    const canvas = /** @type{HTMLCanvasElement} */document.createElement('canvas')
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      alpha: true,
      preserveDrawingBuffer: false
    })
    if (!gl) {
      throw new Error('This browser doesn\'t support WebGL2!')
    }

    gl.clearColor(0, 0, 0, 0)
    const jpegAlphaSurfaceShader = JpegAlphaSurfaceShader.create(gl)
    const jpegSurfaceShader = JpegSurfaceShader.create(gl)

    const yuvaSurfaceShader = YUVASurfaceShader.create(gl)
    const yuvSurfaceShader = YUVSurfaceShader.create(gl)

    return new Renderer(gl, jpegAlphaSurfaceShader, jpegSurfaceShader, yuvaSurfaceShader, yuvSurfaceShader, canvas)
  }

  /**
   * @name RenderFrame
   * @type{Promise<number>}
   * @property {Function} fire
   * @property {Function} then
   */
  /**
   * @return {RenderFrame}
   */
  static createRenderFrame () {
    let animationResolve = null
    const animationPromise = new Promise((resolve) => {
      animationResolve = resolve
    })
    animationPromise._animationResolve = animationResolve
    animationPromise.fire = () => {
      window.requestAnimationFrame((time) => {
        animationPromise._animationResolve(time)
      })
    }
    return animationPromise
  }

  /**
   * Use Renderer.create(..) instead.
   * @private
   * @param {WebGLRenderingContext}gl
   * @param {JpegAlphaSurfaceShader}jpegAlphaSurfaceShader
   * @param {JpegSurfaceShader}jpegSurfaceShader
   * @param {YUVASurfaceShader}yuvaSurfaceShader
   * @param {YUVSurfaceShader}yuvSurfaceShader
   * @param {HTMLCanvasElement}canvas
   */
  constructor (gl, jpegAlphaSurfaceShader, jpegSurfaceShader, yuvaSurfaceShader, yuvSurfaceShader, canvas) {
    /**
     * @type {WebGLRenderingContext}
     */
    this._gl = gl
    /**
     * @type {JpegAlphaSurfaceShader}
     * @private
     */
    this._jpegAlphaSurfaceShader = jpegAlphaSurfaceShader
    /**
     * @type {JpegSurfaceShader}
     * @private
     */
    this._jpegSurfaceShader = jpegSurfaceShader
    /**
     * @type {YUVASurfaceShader}
     * @private
     */
    this._yuvaSurfaceShader = yuvaSurfaceShader
    /**
     * @type {YUVSurfaceShader}
     * @private
     */
    this._yuvSurfaceShader = yuvSurfaceShader
    /**
     * @type {HTMLCanvasElement}
     * @private
     */
    this._canvas = canvas

    this._emptyImage = new window.Image(0, 0)
    this._emptyImage.src = '//:0'
  }

  /**
   * @param {Surface}surface
   * @param {SurfaceState}newState
   */
  async render (surface, newState) {
    const views = surface.views
    const bufferContents = newState.bufferContents

    if (bufferContents) {
      await this._draw(bufferContents, surface, views)
    } else {
      views.forEach((view) => { view.draw(this._emptyImage) })
    }
  }

  /**
   * @param {EncodedFrame}encodedFrame
   * @param {Surface}surface
   * @param {Array<View>}views
   * @return {Promise<void>}
   * @private
   */
  async ['image/jpeg'] (encodedFrame, surface, views) {
    let renderState = surface.renderState
    if (!(renderState instanceof JpegRenderState)) {
      if (renderState) {
        renderState.destroy()
      }
      renderState = JpegRenderState.create(this._gl)
      surface.renderState = renderState
    }
    const jpegRenderState = /** @type JpegRenderState */ renderState

    const {
      /** @type {number} */ w: frameWidth, /** @type {number} */ h: frameHeight
    } = encodedFrame.size

    // We update the texture with the fragments as early as possible, this is to avoid gl state mixup with other
    // calls to _draw() while we're in await. If we were to do this call later, this.canvas will have state specifically
    // for our _draw() call, yet because we are in (a late) await, another call might adjust our canvas, which results
    // in bad draws/flashing/flickering/...
    await jpegRenderState.update(encodedFrame)

    if (EncodingOptions.splitAlpha(encodedFrame.encodingOptions)) {
      // Image is in jpeg format with a separate alpha channel, shade & decode alpha & opaque fragments together using webgl.

      this._jpegAlphaSurfaceShader.use()
      this._jpegAlphaSurfaceShader.setTexture(jpegRenderState.opaqueTexture, jpegRenderState.alphaTexture)

      const canvasSizeChanged = (this._offscreenCanvas.width !== frameWidth) || (this._offscreenCanvas.height !== frameHeight)
      if (canvasSizeChanged) {
        this._offscreenCanvas.width = frameWidth
        this._offscreenCanvas.height = frameHeight
        this._jpegAlphaSurfaceShader.updatePerspective(encodedFrame.size)
      }

      // TODO we could try to optimize and only shade the fragments of the texture that were updated
      this._jpegAlphaSurfaceShader.draw(encodedFrame.size, canvasSizeChanged)
      this._jpegAlphaSurfaceShader.release()

      const image = await window.createImageBitmap(this._offscreenCanvas)
      views.forEach((view) => { view.draw(image) })
    } else {
      // Image is in jpeg format with no separate alpha channel, shade & decode opaque fragments using webgl.
      this._jpegSurfaceShader.use()
      this._jpegSurfaceShader.setTexture(jpegRenderState.opaqueTexture)

      const canvasSizeChanged = (this._offscreenCanvas.width !== frameWidth) || (this._offscreenCanvas.height !== frameHeight)
      if (canvasSizeChanged) {
        this._offscreenCanvas.width = frameWidth
        this._offscreenCanvas.height = frameHeight
        this._jpegSurfaceShader.updatePerspective(encodedFrame.size)
      }

      this._jpegSurfaceShader.draw(encodedFrame.size, canvasSizeChanged)
      this._jpegSurfaceShader.release()
      views.forEach((view) => { view.draw(this._offscreenCanvas) })
    }
  }

  /**
   * @param {EncodedFrame}encodedFrame
   * @param {Surface}surface
   * @param {Array<View>}views
   * @return {Promise<void>}
   * @private
   */
  async ['image/png'] (encodedFrame, surface, views) {
    const fullFrame = EncodingOptions.fullFrame(encodedFrame.encodingOptions)
    const splitAlpha = EncodingOptions.splitAlpha(encodedFrame.encodingOptions)

    if (fullFrame && !splitAlpha) {
      // Full frame without a separate alpha. Let the browser do all the drawing.
      const frame = encodedFrame.pixelContent[0]
      const opaqueImageBlob = new Blob([frame.opaque], { 'type': 'image/png' })
      const opaqueImageBitmap = await createImageBitmap(opaqueImageBlob, 0, 0, frame.geo.width, frame.geo.height)
      views.forEach(view => view.draw(opaqueImageBitmap))
    } else {
      // we don't support/care about fragmented pngs (and definitely not with a separate alpha channel as png has it internal)
      throw new Error(`Unsupported buffer. Encoding type: ${encodedFrame.mimeType}, full frame:${fullFrame}, split alpha: ${splitAlpha}`)
    }
  }

  /**
   * @param {EncodedFrame}encodedFrame
   * @param {Surface}surface
   * @param {Array<View>}views
   * @return {Promise<void>}
   * @private
   */
  async ['video/h264'] (encodedFrame, surface, views) {
    let renderState = surface.renderState
    if (!(renderState instanceof H264RenderState)) {
      if (renderState) {
        renderState.destroy()
      }
      renderState = H264RenderState.create(this._gl)
      surface.renderState = renderState
    }
    const h264RenderState = /** @type H264RenderState */ renderState

    const { /** @type {number} */ w: frameWidth, /** @type {number} */ h: frameHeight } = encodedFrame.size

    // We update the texture with the fragments as early as possible, this is to avoid gl state mixup with other
    // calls to _draw() while we're in await. If we were to do this call later, this.canvas will have state specifically
    // for our _draw() call, yet because we are in (a late) await, another call might adjust our canvas, which results
    // in bad draws/flashing/flickering/...
    await h264RenderState.update(encodedFrame)

    if (EncodingOptions.splitAlpha(encodedFrame.encodingOptions)) {
      // Image is in h264 format with a separate alpha channel, color convert alpha & yuv fragments to rgba using webgl.
      this._yuvaSurfaceShader.use()
      this._yuvaSurfaceShader.setTexture(h264RenderState.yTexture, h264RenderState.uTexture, h264RenderState.vTexture, h264RenderState.alphaTexture)

      const canvasSizeChanged = (this._offscreenCanvas.width !== frameWidth) || (this._offscreenCanvas.height !== frameHeight)
      if (canvasSizeChanged) {
        this._offscreenCanvas.width = frameWidth
        this._offscreenCanvas.height = frameHeight
        this._yuvaSurfaceShader.updatePerspective(encodedFrame.size)
      }

      // TODO we could try to optimize and only shade the fragments of the texture that were updated
      this._yuvaSurfaceShader.draw(encodedFrame.size, canvasSizeChanged)
      this._yuvaSurfaceShader.release()

      const image = await window.createImageBitmap(this._offscreenCanvas)
      views.forEach((view) => { view.draw(image) })
    } else {
      // Image is in h264 format with no separate alpha channel, color convert yuv fragments to rgb using webgl.
      this._yuvSurfaceShader.use()
      this._yuvSurfaceShader.setTexture(h264RenderState.yTexture, h264RenderState.uTexture, h264RenderState.vTexture)

      const canvasSizeChanged = (this._offscreenCanvas.width !== frameWidth) || (this._offscreenCanvas.height !== frameHeight)
      if (canvasSizeChanged) {
        this._offscreenCanvas.width = frameWidth
        this._offscreenCanvas.height = frameHeight
        this._yuvSurfaceShader.updatePerspective(encodedFrame.size)
      }

      this._yuvSurfaceShader.draw(encodedFrame.size, canvasSizeChanged)
      this._yuvSurfaceShader.release()

      views.forEach((view) => { view.draw(this._offscreenCanvas) })
    }
  }

  /**
   * @param {WebShmFrame}shmFrame
   * @param surface
   * @param views
   * @return {Promise<void>}
   */
  async ['image/rgba'] (shmFrame, surface, views) {
    views.forEach(view => view.draw(shmFrame.pixelContent))
  }

  /**
   * @param {WebGLFrame}webGLFrame
   * @param surface
   * @param views
   * @return {Promise<void>}
   */
  async ['image/bitmap'] (webGLFrame, surface, views) {
    views.forEach(view => view.draw(webGLFrame.pixelContent))
  }

  /**
   * @param {!BufferContents}bufferContents
   * @param {Surface}surface
   * @param {Array<View>}views
   * @private
   */

  async _draw (bufferContents, surface, views) {
    // invokes mime type named drawing methods
    await this[bufferContents.mimeType](bufferContents, surface, views)
  }
}
/**
 * @type {Promise<number>}
 * @private
 */
Renderer._animationPromise = null
/**
 * @type {Function}
 * @private
 */
Renderer._animationResolve = null
