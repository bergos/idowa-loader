const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')
const shell = require('shelljs')
const url = require('url')
const Promise = require('bluebird')

const months = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
]

function parseDate (string) {
  if (!string) {
    return null
  }

  const parts = string.split(', ').pop().split(' ')
  const day = parseInt(parts[0])
  const month = months.indexOf(parts[1])
  const year = parseInt(parts[2])

  return new Date(year, month, day, 12)
}

function filesize (filename) {
  const stats = fs.statSync(filename)

  return stats.size
}

class IdowaLoader {
  constructor (options) {
    this.user = options.user
    this.password = options.password
    this.region = options.region
    this.output = options.output
    this.wait = options.wait || 10000
    this.timeout = options.timeout || 120000
    this.showWindow = options.showWindow

    if (IdowaLoader.laRegions.includes(this.region)) {
      this.baseUrl = IdowaLoader.baseUrlLa
    } else {
      this.baseUrl = IdowaLoader.baseUrlSr
    }

    this.startUrl = this.baseUrl + 'shelf.act'
    this.issueUrl = this.baseUrl + 'issue.act'
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
    })
  }

  stop () {
    return this.browser.close()
  }

  currentIssue () {
    return this.page.goto(this.startUrl + '?region=' + this.region, {timeout: this.timeout}).then(() => {
      return this.page.waitForSelector('div.mutationDate')
    }).then(() => {
      return this.page.evaluate(() => {
        const element = document.querySelector('div.mutationDate')

        return {
          date: element.innerText,
          id: parseInt(element.parentElement.parentElement.querySelector('a.issueLink').href.split('\'')[1])
        }
      }).then((issue) => {
        issue.date = parseDate(issue.date)

        return issue
      })
    })
  }

  previousIssues () {
    return this.page.goto(this.startUrl + '?region=' + this.region, {timeout: this.timeout}).then(() => {
      return this.page.waitForSelector('#link-continous-shelf')
    }).then(() => {
      return this.page.evaluate(() => {
        return new Promise((resolve) => {
          let count = 0

          function loadMore () {
            const block = document.getElementById('link-continous-shelf')

            if (block.style.display === 'none' || count > 5) {
              return resolve()
            }

            block.querySelector('a').click()

            count++

            // wait till next issues show up
            setTimeout(loadMore, 1000)
          }

          loadMore()
        })
      })
    }).then(() => {
      // wait till all issues are listed
      return Promise.delay(10000)
    }).then(() => {
      return this.page.evaluate(() => {
        let issues = []
        const elements = document.querySelectorAll('span.mutationDate')

        for (let i = 0; i < elements.length; i++) {
          issues.push({
            date: elements[i].innerText,
            id: elements[i].attributes.rel.value.split('-').pop()
          })
        }

        return issues
      }).then((issues) => {
        return issues.map((issue) => {
          issue.date = parseDate(issue.date)

          return issue
        })
      })
    })
  }

  issues () {
    return this.currentIssue().then((current) => {
      return this.previousIssues().then((previous) => {
        let issues = [current].concat(previous)

        issues = issues.reduce((issues, issue) => {
          issues[issue.id] = issue

          return issues
        }, {})

        issues = Object.keys(issues).sort().map((id) => {
          return issues[id]
        })

        return issues
      })
    })
  }

  downloadLink (id) {
    return this.page.goto(this.issueUrl + '?issueId=' + id, {timeout: this.timeout}).then(() => {
      return this.login()
    }).then((authenticated) => {
      return this.page.goto(this.issueUrl + '?issueId=' + id, {timeout: this.timeout})
    }).then(() => {
      return this.login()
    }).then((authenticated) => {
      if (!authenticated) {
        return Promise.reject(new Error('authentication failed'))
      }
    }).then(() => {
      // loading the issue can take really long...
      return Promise.delay(240000)
    }).then(() => {
      return this.page.waitForSelector('.download-link-menu')
    }).then(() => {
      return this.page.evaluate(() => {
        return document.querySelector('.download-link-menu').href.split('\'').slice(-2, -1).shift()
      })
    }).then((link) => {
      return link ? this.baseUrl + link : link
    })
  }

  download (id) {
    return this.downloadLink(id).then((link) => {
      const filename = path.resolve(this.output, url.parse(link).query.split('&').filter((p) => {
        return p.indexOf('downloadFileName') === 0
      }).shift().split('=').pop())

      if (shell.test('-f', filename)) {
        return
      }

      const command = 'wget --output-document="' + filename + '" "' + link + '"'

      shell.exec(command, {silent: true})

      if (filesize(filename) < 1000000) {
        fs.unlinkSync(filename)

        return Promise.reject(new Error('download failed'))
      }
    })
  }

  login () {
    return this.page.evaluate(() => {
      return document.querySelectorAll('.red button').length === 0
    }).then((authenticated) => {
      if (authenticated) {
        return true
      }

      return Promise.delay(this.wait).then(() => {
        return this.page.evaluate((user, password) => {
          document.querySelector('input[name="email"]').value = user
          document.querySelector('input[name="password"]').value = password
          document.querySelector('.red button').click()
        }, this.user, this.password).then(() => {
          return Promise.delay(this.wait)
        }).then(() => {
          return this.page.evaluate(() => {
            return document.querySelectorAll('.red button').length === 0
          })
        })
      })
    })
  }
}

IdowaLoader.baseUrlSr = 'https://epaper.straubinger-tagblatt.de/'
IdowaLoader.baseUrlLa = 'https://epaper.landshuter-zeitung.de/'
IdowaLoader.laRegions = [
  'hal', 'laz', 'mos', 'lar', 'vib'
]

module.exports = IdowaLoader
