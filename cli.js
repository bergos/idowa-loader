const IdowaLoader = require('./IdowaLoader')
const Promise = require('bluebird')

let loader = null
let log = () => {}

function init (options) {
  loader = new IdowaLoader(options)

  return loader.start()
}

function end () {
  loader.stop()
}

function getIssues (options) {
  if (options.all) {
    log('search for all issues...')

    return loader.issues()
  }

  if (options.from) {
    log('search for issues from ' + options.from.toISOString().slice(0, 10) + ' to ' + options.to.toISOString().slice(0, 10) + '...')

    return loader.issues().then((issues) => {
      return issues.map((issue) => {
        issue.date = new Date(issue.date.toISOString().slice(0, 10))

        return issue
      }).filter((issue) => {
        return issue.date.valueOf() >= options.from.valueOf() && issue.date.valueOf() <= options.to.valueOf()
      })
    })
  }

  log('search for current issue...')

  return loader.currentIssue().then((issue) => {
    return [issue]
  })
}

function download (options, issues) {
  if (issues.length === 0) {
    return Promise.reject(new Error('no issues found'))
  }

  return Promise.map(issues, (issue) => {
    log('download issue: ' + issue.date.toISOString().slice(0, 10) + '(' + issue.id + ')')

    return downloadWithRetry(options, issue)
  }, {concurrency: 1})
}

function downloadWithRetry (options, issue, count) {
  count = count || 0

  return new Promise((resolve, reject) => {
    loader.download(issue.id).then(resolve).catch((err) => {
      count++

      if (count < options.retries) {
        log('retry: ' + count)

        downloadWithRetry(options, issue, count).catch(reject)
      } else {
        reject(err)
      }
    })
  })
}

let program = require('commander')

program
  .option('-u, --user <user>', 'user')
  .option('-p, --password <password>', 'password')
  .option('-r, --region <region>', 'region')
  .option('-a, --all', 'download all available issues')
  .option('-d, --date <date>', 'issue date', (s) => { return new Date(s) })
  .option('-f, --from <date>', 'issue date from', (s) => { return new Date(s) })
  .option('-t, --to <date>', 'issue date to', (s) => { return new Date(s) })
  .option('-n, --retries <retries>', 'how many times to retry downloading the PDF', parseFloat, 1)
  .option('-o, --output <folder>', 'folder where to store the downloads', '')
  .option('-s, --show-window', 'show Chrome window')
  .option('-v, --verbose', 'verbose output')
  .parse(process.argv)

if (program.verbose) {
  log = console.log
}

if (program.date) {
  program.from = program.date
  program.to = program.date
}

if (program.from && !program.to) {
  program.to = new Date((new Date()).toISOString().slice(0, 10))
}

init(program).then(() => {
  return getIssues(program)
}).then((issues) => {
  issues.forEach((issue) => {
    log('found issue: ' + issue.date.toISOString().slice(0, 10) + ' (' + issue.id + ')')
  })

  return download(program, issues)
}).then(() => {
  end()
}).catch((err) => {
  console.error(err.stack || err.message)

  end()

  process.exit(1)
})
