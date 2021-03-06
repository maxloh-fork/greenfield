'use strict'

const path = require('path')

const webpack = require('webpack')
const merge = require('webpack-merge')
const baseConfig = require('./webpack.config.base')

const appBundle = 'app.js'
const buildDir = 'dev'

const base = baseConfig(appBundle, buildDir, true)
const dev = {
  mode: 'development',
  plugins: [
    new webpack.DefinePlugin({
      DEBUG: JSON.stringify(false)
    })
  ],
  devServer: {
    contentBase: path.join(__dirname, '../dev'),
    port: 8080,
    hot: true,
    open: true
  }
}

module.exports = merge(base, dev)
