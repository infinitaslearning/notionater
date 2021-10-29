#!/usr/bin/env node

require('dotenv').config()
const prompts = require('prompts');
const { Command } = require('commander');
const { Client } = require("@notionhq/client");
const fg = require('fast-glob');
const fs = require('fs');

const {markdownToBlocks, markdownToRichText} = require('@instantish/martian');

/**
 * Parse cmd line
 */
const program = new Command();
program
  .option('-t, --token <token>', 'Notion token (https://www.notion.so/my-integrations)')
  .option('-p, --page <page>', 'Page title to import under', '')
  .option('-g, --glob <glob>', 'Glob to find files to import')

program.parse(process.argv);
const options = program.opts();

/**
 * Setup notion client
 */

if (!options.token) {
  console.log('You must provide an integration token: notionater -t XXX')
  return;
}

if (!options.glob) {
  console.log('You must provide glob style path to the folder to import, e.g. my-project/**/**.md')
  return;
}

const notion = new Client({
  auth: options.token,
})

const folderPaths = {};

const processFilePath = async(path, parents, parentPageId) => {
  if (!folderPaths[path]) {
    console.log('Creating folder page: ' + path + ' ...');
    const response = await notion.pages.create({
      parent: {
        page_id: parents.length > 0 ? parents[parents.length - 1] : parentPageId,
      },
      icon: {
        type: "emoji",
        emoji: "📁"
      },
      properties: {
        title: {
          id: 'title',
          type: 'title',
          title: [
            {
              text: {
                content: decodeURI(path),
              }
            },
          ],
        }
      }
    });
    // Store it for later
    folderPaths[path] = response.id;
  }
  return folderPaths[path]
}

const processFile = async (file, parentPageId) => {

  // First we need to ensure we have all the parent pages created
  const path = file.split("/");
  const fileName = path.pop(); // lose the file
  const parents = await path.reduce(async (memo, path) => {
    const results = await memo;
    const result = await processFilePath(path, results, parentPageId);
    return [...results, result];
  }, []);

  // Now create our actual file
  const fileText = fs.readFileSync(file, 'utf8');
  const blocks = markdownToBlocks(fileText);

  console.log('Importing markdown file: ' + fileName + ' ...');

  try {
    const response = await notion.pages.create({
      parent: {
        page_id: parents.length > 0 ? parents[parents.length - 1] : parentPageId,
      },
      properties: {
        title: {
          id: 'title',
          type: 'title',
          title: [
            {
              text: {
                content: decodeURI(fileName).replace('.md',''),
              }
            },
          ],
        }
      },
      children: blocks,
    });
  } catch(ex) {
    console.log(ex.message);
  }

  return 'OK';
}

const start = async () => {

  const files = await fg([options.glob]);

  if (!files.length) {
    console.log('No files found to import, make sure you add your glob in quotes: -g "folder/**/**.md"');
    return;
  }

  const response = await notion.search({
    query: options.page,
    filters: {
      archived: false
    }
  });

  if (!response.results.length) {
    console.log('No pages found!');
    return;
  }

  const pages = response.results.map((page) => {
    return { title: page.properties.title.title[0].plain_text, 'value': page.id }
  });

  const selectedPage = await prompts({
    type: 'select',
    name: 'page',
    message: 'Choose the page to import under:',
    choices: pages,
  });

  if (!selectedPage.page) {
    return;
  }


  const res = await files.reduce(async (memo, file) => {
    const results = await memo;
    const result = await processFile(file, selectedPage.page);
    return [...results, result];
  }, []);

}

start();