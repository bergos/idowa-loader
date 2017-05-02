const chromeRemoteInterface = require('chrome-remote-interface')
const path = require('path')
const shelljs = require('shelljs')
const spawn = require('child_process').spawn
const EventEmitter = require('events').EventEmitter
const Promise = require('bluebird')

class Chrome extends EventEmitter {
  constructor (options) {
    super()

    options = options || {}

    this.verbose = options.verbose
    this.chrome = options.chrome
    this.stdout = options.stdout
    this.stderr = options.stderr
    this.profile = options.profile
    this.headless = options.headless

    if (!this.chrome) {
      this.chrome = (
        shelljs.exec('which chromium-browser', {silent: true}) ||
        shelljs.exec('which google-chrome', {silent: true})
      ).toString().trim()
    }

    if (typeof this.profile === 'undefined') {
      this.profile = path.join(shelljs.tempdir(), 'chrome-' + process.pid)
    }
  }

  start () {
    let args = [
      '--remote-debugging-port=9222'
    ]

    if (this.profile) {
      args.push('--user-data-dir=' + this.profile)
    }

    if (this.headless) {
      args.push('--headless')
    }

    this.process = spawn(this.chrome, args)

    if (this.stdout) {
      this.process.stdout.pipe(this.stdout)
    }

    if (this.stderr) {
      this.process.stderr.pipe(this.stderr)
    }

    return Promise.delay(10000)
  }

  stop () {
    this.process.kill()

    shelljs.rm('-rf', this.profile)

    return Promise.resolve()
  }

  connect () {
    return chromeRemoteInterface().then((client) => {
      this.client = client
      this.Network = client.Network
      this.Page = client.Page
      this.Runtime = client.Runtime

      if (this.verbose) {
        this.Network.requestWillBeSent((params) => {
          console.log('loading resource from: ' + params.request.url)
        })
      }

      this.Page.loadEventFired(this.emit.bind(this, 'pageLoad'))

      return Promise.all([
        this.Network.enable(),
        this.Page.enable()
      ])
    })
  }

  close () {
    this.client.close()
  }

  cookies (format) {
    return this.Network.getAllCookies().then((cookies) => {
      if (format === 'netscape') {
        return Chrome.cookiesToNetscape(cookies.cookies)
      }

      return cookies
    })
  }

  html () {
    return this.evaluate(() => {
      return document.documentElement.outerHTML
    })
  }

  open (url) {
    return new Promise((resolve, reject) => {
      this.once('pageLoad', resolve)
      this.Page.navigate({url: url}).catch(reject)
    })
  }

  evaluate (src, options) {
    options = options || {}

    const params = Array.prototype.slice.call(arguments, 2).map((value) => {
      return '\'' + value + '\''
    }).join(',')

    return this.Runtime.evaluate({
      expression: '(' + src.toString() + ')(' + params + ')',
      awaitPromise: options.awaitPromise
    }).then((result) => {
      if (!options.raw) {
        if (result.result.subtype === 'error') {
          return new Error(result.result.description)
        } else if (result.result.type === 'string') {
          try {
            return JSON.parse(result.result.value)
          } catch (e) {
            return result.result.value
          }
        } else if (result.result.type === 'boolean') {
          return result.result.value
        }

        return result
      }

      return result
    })
  }

  waitForSelector (selector, timeout) {
    timeout = timeout || 5000

    return this._waitForSelector(selector, (new Date()).valueOf() + timeout)
  }

  _waitForSelector (selector, end) {
    if ((new Date()).valueOf() > end) {
      return Promise.reject(new Error('could not find selector: ' + selector))
    }

    const src = 'function(){return document.querySelectorAll(\'' + selector + '\').length > 0}'

    return this.evaluate(src).then((found) => {
      if (!found) {
        return Promise.delay(500).then(() => {
          return this._waitForSelector(selector, end)
        })
      }
    })
  }

  static cookiesToNetscape (cookies) {
    return cookies.map((cookie) => {
      return cookie.domain + '\t' +
        'FALSE' + '\t' +
        cookie.path + '\t' +
        cookie.secure.toString().toUpperCase() + '\t' +
        ((cookie.expires !== undefined) ? cookie.expires : '') + '\t' +
        cookie.name + '\t' +
        cookie.value
    }).join('\n')
  }
}

module.exports = Chrome
