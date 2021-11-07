# A better markdown importer for Notion

Aim is to be able to point this script at a folder full of markdown (e.g. from checkout of a github or Azure devops wiki) and have it fully import, with the folder structure and content fully formatted.

- Uses the official javascript SDK
- Supports nested folders, creates blank pages for folders
- Parses markdown to blocks via https://github.com/instantish/martian
- Allows you to search for parent page to import
- Devops plugin allows you to import:
  - User references
  - Images (if you provide an Azure blob storage account)
  - Tables are converted to databases

# Usage

First of all, you need to create an integration with Notion (you need to be an admin): https://www.notion.so/my-integrations

Once you have created it, save the token, you need it later.

You then need to share the page you want to import against with the Integration you created, otherwise you can't see them.  Note that this will import directly into this page as sub-pages; so best if you are importing `Amazing Wiki`, best to create a page in Notion with this name, and import directly into it.

To work, go to a command line:

```
npx notionater -t secret_XXXX -g '**/**.md' -p 'Amazing Wiki'
```

It assumes that the folder you are in is a set of nested folders containing markdown.

For real usage, I recommend you use a config file as it makes it easier to manage (e.g. this is `config.json`)

```json
{
  "token": "secret_XXXX",
  "basePath": "/Users/cliftonc/work/Amazing.Wiki/",
  "glob": "**/**.md",
  "skipEmpty": true,
  "basePage": "Amazing Wiki",  
  "plugins": "devops",  
  "azureBlobUrl": "https://azureBlob.z6.web.core.windows.net/",
  "azureBlobAccount": "azureBlob"
}
```

and then:

```sh
npx notionater -c config.json
```

# Plugins

You can add plugins to the plugins folder, and then use them from the command line (comma separated, no spaces).

```sh
npx notionater -t secret_XXXX -g '**/**.md' -p 'Amazing Wiki' -x devops
```

Plugins can expose two async functions:

```js
export.preParse = async (fileText) {
  // Do something with the text
  return fileText;
}

export.postParse = async (blocks) {
  // Do something with the blocks
  return blocks;
}
```

## Included Plugins

### devops

This fixes header markup, and looks up users based on Guids, using the Azure CLI - this needs to be installed and configured separately (along with the `azure-devops` plugin), the plugins will fail if it is not installed and authenticated.  It caches the user lookups in a local file for subsequent loads - as it isn't fast.

## Setup of AZ cli

  - Install CLI https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
  - Login: `az login`
  - Install devops plugin: `az extension add --name azure-devops`
  - Set your organisation: `az devops configure --defaults organization=https://dev.azure.com/infinitas/`
  - If you have an issue with login, use: https://docs.microsoft.com/en-gb/azure/devops/cli/log-in-via-pat?view=azure-devops&tabs=windows

## Debug

To enable debug mode:

```sh
DEBUG=* npx notionater -c config.json
```

```sh
notionater Loaded 51 users from cache :D +0ms
  notionater You must have the Azure CLI installed - https://docs.microsoft.com/en-us/cli/azure/install-azure-cli +0ms
✔ Choose the page to import under: › Clifton Imports
  notionater Creating folder page:  ... +5s
  notionater Creating folder page: Users ... +861ms
  notionater Creating folder page: cliftonc ... +852ms
  notionater Creating folder page: work ... +871ms
  notionater Creating folder page: IL.PE.Platforms.wiki ... +988ms
  notionater Processing markdown file: Feature-Teams.md ... +948ms
  notionater Processing markdown file: Home.md ... +3s
  notionater Skipping empty file Home.md +1ms
  notionater Processing markdown file: Liber.md ... +1ms
  notionater Skipping empty file Liber.md +0ms
  notionater Processing markdown file: Maintenance-Team.md ... +0ms
  notionater Looking up 8 users ... +12s
  notionater Processing markdown file: Noordhoff.md ... +1s
```

# To-Do / Known issues

- Needs testing and linting I guess
- The search API seems to return deleted files which sucks, but given you can filter based on search you can work around it
- It should check if a file exists first and ask you if you want to replace it
- Don't use a glob with `./` at the start as it will create a page called `.` - a good fix for a new contributor :D
