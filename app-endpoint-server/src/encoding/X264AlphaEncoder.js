// Copyright 2019 Erik De Rijcke
//
// This file is part of Greenfield.
//
// Greenfield is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Greenfield is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with Greenfield.  If not, see <https://www.gnu.org/licenses/>.

'use strict'

const WlShmFormat = require('./WlShmFormat')

const EncodedFrame = require('./EncodedFrame')
const EncodedFrameFragment = require('./EncodedFrameFragment')
const EncodingOptions = require('./EncodingOptions')

const { h264 } = require('./EncodingTypes')

const appEndpointNative = require('app-endpoint-native')

const gstFormats = {
  [WlShmFormat.argb8888]: 'BGRA',
  [WlShmFormat.xrgb8888]: 'BGRx'
}

/**
 * @implements FrameEncoder
 */
class X264AlphaEncoder {
  /**
   * @param {number}width
   * @param {number}height
   * @param {number}wlShmFormat
   * @return {X264AlphaEncoder}
   */
  static create (width, height, wlShmFormat) {
    const gstBufferFormat = gstFormats[wlShmFormat]
    const x264AlphaEncoder = new X264AlphaEncoder()
    x264AlphaEncoder._encodingContext = appEndpointNative.createEncoder(
      'x264_alpha', gstBufferFormat, width, height,
      opaqueH264 => {
        x264AlphaEncoder._opaque = opaqueH264
        if (x264AlphaEncoder._opaque && x264AlphaEncoder._alpha) {
          x264AlphaEncoder._encodingResolve()
        }
      },
      alphaH264 => {
        x264AlphaEncoder._alpha = alphaH264
        if (x264AlphaEncoder._opaque && x264AlphaEncoder._alpha) {
          x264AlphaEncoder._encodingResolve()
        }
      })
    return x264AlphaEncoder
  }

  /**
   * @private
   */
  constructor () {
    /**
     * @type {Object}
     * @private
     */
    this._encodingContext = null
    this._opaque = null
    this._alpha = null
    this._encodingResolve = null
  }

  /**
   * @param {Buffer}pixelBuffer
   * @param {number}wlShmFormat
   * @param {number}x
   * @param {number}y
   * @param {number}width
   * @param {number}height
   * @return {Promise<EncodedFrameFragment>}
   * @private
   */
  async _encodeFragment (pixelBuffer, wlShmFormat, x, y, width, height) {
    const gstBufferFormat = gstFormats[wlShmFormat]

    const encodingPromise = new Promise(resolve => {
      this._alpha = null
      this._opaque = null
      this._encodingResolve = resolve
      appEndpointNative.encodeBuffer(this._encodingContext, pixelBuffer, gstBufferFormat, width, height)
    })

    await encodingPromise
    return EncodedFrameFragment.create(x, y, width, height, this._opaque, this._alpha)
  }

  /*
   * @param {Buffer}pixelBuffer
   * @param {number}wlShmFormat
   * @param {number}bufferWidth
   * @param {number}bufferHeight
   * @param {number}serial
   * @return {Promise<EncodedFrame>}
   * @override
   */
  async encodeBuffer (pixelBuffer, wlShmFormat, bufferWidth, bufferHeight, serial) {
    let encodingOptions = 0
    encodingOptions = EncodingOptions.enableSplitAlpha(encodingOptions)
    encodingOptions = EncodingOptions.enableFullFrame(encodingOptions)
    const encodedFrameFragment = await this._encodeFragment(pixelBuffer, wlShmFormat, 0, 0, bufferWidth, bufferHeight)
    return EncodedFrame.create(serial, h264, encodingOptions, bufferWidth, bufferHeight, [encodedFrameFragment])
  }
}

module.exports = X264AlphaEncoder
