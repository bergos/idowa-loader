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
  log('search for issues...')

  return loader.issues(options.from || options.date, options.to).then((issues) => {
    return issues
  })
}

function download (options, issues) {
  return Promise.map(issues, (issue) => {
    if (loader.exists(issue)) {
      log('ignore existing issue: ' + issue.date.toISOString().slice(0, 10))

      return
    }

    log('download issue: ' + issue.date.toISOString().slice(0, 10))

    return loader.download(issue)
  }, {concurrency: 1})
}

const program = require('commander')

program
  .option('-u, --user <user>', 'user')
  .option('-p, --password <password>', 'password')
  .option('-r, --region <region>', 'region ("Dingolfinger_Anzeiger", "Landshuter Zeitung")')
  .option('-d, --date <date>', 'issue date', (s) => { return new Date(s) })
  .option('-f, --from <date>', 'issue date from')
  .option('-t, --to <date>', 'issue date to')
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

if (program.from) {
  if (program.from.slice(0, 1) === '-') {
    program.from = new Date((new Date()).valueOf() - 24 * 60 * 60 * 1000 * parseInt(program.from.slice(1)))
  } else {
    program.from = new Date()
  }
} else {
  program.from = new Date()
}

if (program.to) {
  program.to = new Date(program.to)
} else {
  program.to = new Date((new Date()).toISOString().slice(0, 10))
}

init(program).then(() => {
  return getIssues(program)
}).then((issues) => {
  issues.forEach((issue) => {
    log('found issue: ' + issue.date.toISOString().slice(0, 10))
  })

  return download(program, issues)
}).then(() => {
  end()
}).catch((err) => {
  console.error(err.stack || err.message)

  end()

  process.exit(1)
})
