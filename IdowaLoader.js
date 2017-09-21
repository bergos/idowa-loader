const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')
const shell = require('shelljs')
const url = require('url')
const Promise = require('bluebird')

function filesize (filename) {
  const stats = fs.statSync(filename)

  return stats.size
}

class IdowaLoader {
  constructor (options) {
    this.user = options.user
    this.password = options.password
    this.region = options.region.split(' ').join('_')
    this.output = options.output
    this.showWindow = options.showWindow

    this.baseUrl = 'http://editionarchiv.idowa.de/'
  }

  start () {
    return puppeteer.launch({
      headless: !this.showWindow,
      timeout: this.timeout
    }).then((browser) => {
      this.browser = browser

      return this.browser.newPage()
    }).then((page) => {
      this.page = page

      return this.login()
    })
  }

  stop () {
    return this.browser.close()
  }

  issue (date) {
    const dateUrl = date.toISOString().split('-').join('').slice(0, 8)
    const issueUrl = url.resolve(this.baseUrl, 'edition/data/' + dateUrl + '/01/' + this.region + '/page.jsp')

    return this.page.goto(issueUrl, {waitUntil: 'networkidle'}).then(() => {
      return Promise.delay(500)
    }).then(() => {
      return this.page.evaluate(() => {
        const downloadLink = document.getElementById('getpdf_pict')

        return downloadLink && downloadLink.href
      })
    }).then((download) => {
      if (!download) {
        return null
      }

      return {
        date: date,
        download: download
      }
    })
  }

  issues (start, end) {
    const range = []
    const rangeEnd = end.valueOf() + 24 * 60 * 60 * 1000 - 1

    for (let current = start.valueOf(); current <= rangeEnd; current += 24 * 60 * 60 * 1000) {
      range.push(new Date(current))
    }

    return Promise.map(range, (date) => {
      return this.issue(date)
    }, {concurrency: 1}).then((issues) => {
      return issues.filter(issue => issue)
    })
  }

  download (issue) {
    return Promise.resolve().then(() => {
      const filename = this.filename(issue)

      if (this.exists(issue)) {
        return
      }

      const command = 'wget --output-document="' + filename + '" "' + issue.download + '"'

      shell.exec(command, {silent: true})

      if (filesize(filename) < 1000000) {
        fs.unlinkSync(filename)

        return Promise.reject(new Error('download failed'))
      }
    })
  }

  filename (issue) {
    return path.resolve(this.output, issue.date.toISOString().slice(0, 10) + '_' + this.region + '.pdf')
  }

  exists (issue) {
    return shell.test('-f', this.filename(issue))
  }

  login () {
    return this.page.goto(this.baseUrl, {waitUntil: 'networkidle'}).then(() => {
      return Promise.delay(500)
    }).then(() => {
      return this.page.evaluate((user, password) => {
        document.getElementById('benutzername').value = user
        document.getElementById('webpasswort').value = password
        document.getElementById('login_button').click()
      }, this.user, this.password)
    }).then(() => {
      return Promise.delay(500)
    })
  }
}

module.exports = IdowaLoader
