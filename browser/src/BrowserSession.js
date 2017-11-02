'use strict'

import westfield from 'westfield-runtime-server'
import session from './protocol/session-browser-protocol'
import BrowserClientSession from './BrowserClientSession'

/**
 * Listens for client announcements from the server.
 */
export default class BrowserSession extends westfield.Global {
  /**
   *
   * @param {String} sessionId unique random browser compositor session id
   * @returns {Promise<BrowserSession>}
   */
  static create (sessionId) {
    console.log('Starting new browser session.')
    const wfsServer = new westfield.Server()
    const url = 'ws://' + window.location.host + '/' + sessionId
    const browserSession = new BrowserSession(url, wfsServer)
    return browserSession._createConnection(url).then(() => {
      wfsServer.registry.register(browserSession)
      return browserSession
    }).catch((error) => {
      console.log('Received session connection error ' + error)
    })
  }

  constructor (url, wfsServer) {
    super(session.GrSession.name, 1)
    this.url = url
    this.wfsServer = wfsServer
    this._clients = {}
    this._nextClientSessionId = 1
    this._ws = null
    this.resources = []
  }

  /**
   *
   * @param {string} url
   * @returns {Promise<>}
   * @private
   */
  _createConnection (url) {
    return new Promise((resolve, reject) => {
      const ws = new window.WebSocket(url)
      ws.binaryType = 'arraybuffer'

      ws.onerror = (event) => {
        if (ws.readyState === window.WebSocket.CONNECTING) {
          reject(event)
        }
      }

      ws.onopen = () => {
        this._ws = ws
        this._setupWebsocket()
        this._setupPrimaryConnection()
        resolve()
      }
    })
  }

  bindClient (client, id, version) {
    const grSessionResource = new session.GrSession(client, id, version)
    grSessionResource.implementation = this
    this.resources.push(grSessionResource)
  }

  _setupWebsocket () {
    this._ws.onmessage = (event) => {
      if (this._ws.readyState === window.WebSocket.OPEN) {
        try {
          const buf = event.data
          const sessionId = new DataView(buf).getUint32(0, true)
          const arrayBuffer = buf.slice(4, buf.byteLength)

          this._clients[sessionId].message(arrayBuffer)
        } catch (error) {
          console.error(error)
          this._ws.close()
        }
      }
    }
  }

  _setupPrimaryConnection () {
    this._setupConnection(0)
  }

  _setupConnection (clientSessionId) {
    const client = this.wfsServer.createClient()
    this._clients[clientSessionId] = client
    this._setupClientConnection(client, clientSessionId)
  }

  _setupClientConnection (client, clientSessionId) {
    client.onSend = (arrayBuffer) => {
      if (this._ws.readyState === window.WebSocket.OPEN) {
        try {
          const b = new Uint8Array(arrayBuffer.byteLength + 4)
          new window.DataView(b.buffer).setUint32(0, clientSessionId, true)
          b.set(new Uint8Array(arrayBuffer), 4)

          this._ws.send(b.buffer, (error) => {
            if (error !== undefined) {
              console.error(error)
              this._ws.close()
            }
          })
        } catch (error) {
          console.error(error)
          this._ws.close()
        }
      }
    }
  }

  /**
   *
   * @param {GrSession} resource
   *
   * @param id client session resource id
   * @since 1
   *
   */
  client (resource, id) {
    console.log('New client connected.')
    const clientSessionId = this._nextClientSessionId++
    this._setupConnection(clientSessionId)
    const grClientSessionResource = new session.GrClientSession(resource.client, id, resource.version)
    grClientSessionResource.implementation = BrowserClientSession.create(this._ws)
    grClientSessionResource.session(clientSessionId)
  }

  flush () {
    this.resources.forEach(resource => resource.flush())
  }
}
