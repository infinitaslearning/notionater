#!/usr/bin/env node

require('dotenv').config()
const prompts = require('prompts');
const { Command } = require('commander');
const { Client } = require("@notionhq/client");
const fg = require('fast-glob');
const fs = require('fs');
const {markdownToBlocks, markdownToRichText} = require('@instantish/martian');
const plugins = [];

/**
 * Parse cmd line
 */
const program = new Command();
program
  .option('-t, --token <token>', 'Notion token (https://www.notion.so/my-integrations)')
  .option('-p, --page <page>', 'Page title to import under', '')
  .option('-g, --glob <glob>', 'Glob to find files to import')
  .option('-x, --extend <plugins>','Add plugins to the processing chain, e.g. -x devops-users','none')

program.parse(process.argv);
const options = program.opts();

/**
 * Setup notion client
 */

if (!options.token) {
  console.log('You must provide an integration token: notionater -t XXX')
  return;
}

const notion = new Client({
  auth: options.token,
})

const start = async () => {

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
    console.log(page);
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

//  const pageContent = await notion.pages.retrieve({ page_id: selectedPage.page });

  // const pageContent = await notion.blocks.children.list({
  //   block_id: selectedPage.page,
  //   page_size: 50,
  // });

  // console.log(JSON.stringify(pageContent, null, 2));
  // return;

  try {
    const response = await notion.pages.create({
      parent: {
        page_id: selectedPage.page,
      },
      properties: {
        title: {
          id: 'title',
          type: 'title',
          title: [
            {
              text: {
                content: 'Hello World',
              }
            },
          ],
        }
      }
    });

    const newPageId = response.id;

    const database = await notion.databases.create({
      parent: {
        page_id: newPageId,
      },
      title: [{
        type: 'text',
        text: {
          content: 'Embedded Database',
        }
      }],
      properties: {
        Name: {
          title: {}
        },
        Description: {
          rich_text: {}
        },
      }
    });

    console.log(database);

    const databaseId = database.id;

    const row = await notion.pages.create({
      parent: {
        database_id: databaseId,
      },
      properties: {
         "Name": {
          "title": [
            {
              "type": "text",
              "text": {
                "content": "The title"
              }
            }
          ]
        },
        Description: {
          "rich_text": [{
              "type": "text",
              "text": {
                "content": "Some more text with "
              }
          }],
        },
      }
    });

    console.log(row);

    const newBlock = await notion.blocks.children.append({
      block_id: newPageId,
       children: [
       {
          "object": "block",
          "type": "child_database",
          "child_database": {
            "title": "Embedded Database"
          }
        }
      ]
    });

      console.log(newBlock);

  } catch(ex) {
    console.log(ex.message);
  }
}

start();