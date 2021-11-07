#!/usr/bin/env node

require('dotenv').config()
const prompts = require('prompts')
const { Command } = require('commander')
const { Client } = require('@notionhq/client')
const fg = require('fast-glob')
const fs = require('fs')
const path = require('path')
const { markdownToBlocks } = require('@tryfabric/martian')
const plugins = []
const { toSentenceCase } = require('js-convert-case')
const debug = require('debug')('notionater')
const cliProgress = require('cli-progress')

/**
 * Parse cmd line
 */
const program = new Command()
program
  .option('-t, --token <token>', 'Notion token (https://www.notion.so/my-integrations)')
  .option('-b, --basePage <page>', 'Page title to import under', '')
  .option('-d, --basePath <basePath>', 'What to use as the base path (if images are referenced locally)', process.cwd())
  .option('-g, --glob <glob>', 'Glob to find files to import, will be relative to basePath')
  .option('-p, --plugins <plugins>', 'Add plugins to the processing chain, e.g. -x devops-users', 'none')
  .option('-c, --config <config>', 'Path to a config json file')
  .option('-s, --skipEmpty', 'Skip empty pages', false)
  .option('--azureBlobUrl <azureBlobUrl>', 'Azure blob storage url')
  .option('--azureBlobAccount <azureBlobAccount>', 'Azure Blob storage account')

program.parse(process.argv)
let options = program.opts()

if (options.config) {
  try {
    const config = require(path.resolve(options.config))
    options = { ...options, ...config }
  } catch (ex) {
    console.log(`Error parsing config: ${ex.message}`)
    process.exit()
  }
}

debug('Working with options', options)

/**
 * Setup notion client
 */

if (!options.token) {
  console.log('You must provide an integration token: notionater -t XXX')
  process.exit()
}

if (!options.glob) {
  console.log('You must provide glob style path to the folder to import, e.g. my-project/**/**.md')
  process.exit()
}

const notion = new Client({
  auth: options.token
})

const folderPaths = {}

const processFilePath = async (path, parents, parentPageId) => {
  if (!folderPaths[path]) {
    debug('Creating folder page: ' + path + ' ...')
    try {
      const response = await notion.pages.create({
        parent: {
          page_id: parents.length > 0 ? parents[parents.length - 1] : parentPageId
        },
        icon: {
          type: 'emoji',
          emoji: '📁'
        },
        properties: {
          title: {
            id: 'title',
            type: 'title',
            title: [
              {
                text: {
                  content: toSentenceCase(decodeURI(path))
                }
              }
            ]
          }
        }
      })
      // Store it for later
      folderPaths[path] = response.id
    } catch (ex) {
      debug(ex.message)
    }
  }
  return folderPaths[path]
}

const postParseTables = (blocks) => {
  // We want to convert the tables to databases, and strip them from the document
  const filteredBlocks = []
  const tables = []
  let tableNumber = 0

  for (const block of blocks) {
    if (block.object !== 'unsupported') filteredBlocks.push(block)
    if (block.object === 'unsupported' && block.type === 'table') {
      // Create a dummy block
      tableNumber++
      tables.push(block)
      filteredBlocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          text: [
            {
              type: 'text',
              annotations: {
                italic: true,
                color: 'orange'
              },
              text: {
                content: `Table moved - see linked Database ${tableNumber}`
              }
            }
          ]
        }
      })
    }
  }

  return { filteredBlocks, tables }
}

const createTables = async (tables, parentPageId, parentPageTitle, overallProgress) => {
  // Now we have a page, create the tables!
  let tableNumber = 0
  for (const table of tables) {
    tableNumber++
    const tableData = table.table.children.map((rows) => {
      return rows.table_row.children.map((cells) => {
        if (cells.table_cell.children) {
          return cells.table_cell.children[0].text.content
        } else {
          return 'Column'
        }
      })
    })
    const tableHeader = tableData.shift()
    const tableHeaderProperties = {}

    tableHeader.forEach((header, index) => {
      if (index === 0) {
        tableHeaderProperties[header] = {
          title: {}
        }
      } else {
        tableHeaderProperties[header] = {
          rich_text: {}
        }
      }
    })

    debug(`Adding table to '${parentPageTitle}' with ${tableData.length} rows ...`)
    const tableProgress = !process.env.DEBUG ? overallProgress.create(tableData.length, 0, { filename: `Creating table ${tableNumber} ...` }) : null

    const database = await notion.databases.create({
      parent: {
        page_id: parentPageId
      },
      title: [{
        type: 'text',
        text: {
          content: `${parentPageTitle} - Database ${tableNumber}`
        }
      }],
      properties: tableHeaderProperties
    })

    if (!process.env.DEBUG) tableProgress.increment()

    const databaseId = database.id

    for (const tableRow in tableData) {
      const tableDataProperties = {}

      tableHeader.forEach((header, index) => {
        if (index === 0) {
          tableDataProperties[header] = {
            title: [
              {
                type: 'text',
                text: {
                  content: tableData[tableRow][index] || ''
                }
              }
            ]
          }
        } else {
          tableDataProperties[header] = {
            rich_text: [{
              type: 'text',
              text: {
                content: tableData[tableRow][index] || ''
              }
            }]
          }
        }
      })

      await notion.pages.create({
        parent: {
          database_id: databaseId
        },
        properties: tableDataProperties
      })

      if (!process.env.DEBUG) tableProgress.increment()
    }

    overallProgress.remove(tableProgress)
  }
}

const processFile = async (file, parentPageId, progress) => {
  // First we need to ensure we have all the parent pages created
  const pathList = file.split('/')
  const fileName = pathList.pop() // lose the file
  let blocks, fileText

  const fileProgress = !process.env.DEBUG ? progress.create(pathList.length + 2, 0, { filename: `${fileName}` }) : null

  const parents = await pathList.reduce(async (memo, innerFile) => {
    const results = await memo
    const result = await processFilePath(innerFile, results, parentPageId)
    if (!process.env.DEBUG) fileProgress.increment()
    return [...results, result]
  }, [])

  debug('Processing markdown file: ' + fileName + ' ...')

  // Now create our actual file
  try {
    fileText = fs.readFileSync(path.resolve(options.basePath, file), 'utf8').toString()

    if (!fileText) {
      debug('Skipping empty file', fileName)
      if (!process.env.DEBUG) fileProgress.stop()
      progress.remove(fileProgress)
      return 'Skipped'
    }

    // Execute pre-parse plugins
    for (const plugin of plugins) {
      if (plugin.preParse) {
        fileText = await plugin.preParse(fileText, progress)
      };
    };

    blocks = markdownToBlocks(fileText, { strictImageUrls: false, allowUnsupportedObjectType: true })

    // Execute post-parse plugins
    for (const plugin of plugins) {
      if (plugin.postParse) {
        blocks = await plugin.postParse(blocks, notion, options, progress)
      };
    };
  } catch (ex) {
    debug(ex)
    if (!process.env.DEBUG) fileProgress.stop()
    progress.remove(fileProgress)
    return 'Failed'
  }

  if (!process.env.DEBUG) fileProgress.increment()

  const { filteredBlocks, tables } = postParseTables(blocks)

  const pageTitle = toSentenceCase(decodeURI(fileName).replace('.md', ''))
  try {
    const response = await notion.pages.create({
      parent: {
        page_id: parents.length > 0 ? parents[parents.length - 1] : parentPageId
      },
      properties: {
        title: {
          id: 'title',
          type: 'title',
          title: [
            {
              text: {
                content: pageTitle
              }
            }
          ]
        }
      },
      children: filteredBlocks
    })

    if (!process.env.DEBUG) fileProgress.increment()

    if (tables.length) {
      await createTables(tables, response.id, pageTitle, progress)
    }
  } catch (ex) {
    debug(ex.message)
  }

  if (!process.env.DEBUG) fileProgress.stop()
  progress.remove(fileProgress)
  return 'OK'
}

const loadPlugins = (pluginsToLoad) => {
  if (pluginsToLoad[0] === 'none') return
  pluginsToLoad.forEach((plugin) => {
    try {
      plugins.push(require(`./plugins/${plugin}`))
    } catch (ex) {
      debug('Error loading plugin', ex.message)
    }
  })
}

const start = async () => {
  loadPlugins(options.plugins.split(','))

  const files = await fg([options.glob], {
    dot: false,
    cwd: options.basePath
  })

  if (!files.length) {
    console.log('No files found to import, make sure you add your glob in quotes: -g "folder/**/**.md"')
    return
  }

  const response = await notion.search({
    query: options.basePage,
    filters: {
      archived: false
    }
  })

  if (!response.results.length) {
    console.log('No pages found - try a different base page search?')
    return
  }

  const pages = response.results.map((page) => {
    if (page.properties.title) {
      return { title: page.properties.title.title[0].plain_text, value: page.id }
    } else {
      return { title: 'invalid page', value: '' }
    }
  })

  const selectedPage = await prompts({
    type: 'select',
    name: 'page',
    message: 'Choose the page to import under:',
    choices: pages
  })

  if (!selectedPage.page) {
    return
  }

  // create new container
  const progress = new cliProgress.MultiBar({
    stopOnComplete: true,
    clearOnComplete: true,
    hideCursor: true,
    fps: 10,
    format: '[{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | {filename}'
  }, cliProgress.Presets.shades_grey)

  const overallProgress = !process.env.DEBUG ? progress.create(files.length, 0, { filename: 'Overall progress' }) : null

  await files.reduce(async (memo, file) => {
    const results = await memo
    const result = await processFile(file, selectedPage.page, progress)
    if (!process.env.DEBUG) overallProgress.increment()
    return [...results, result]
  }, [])

  progress.stop()
}

start()
