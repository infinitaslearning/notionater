# A better markdown importer for Notion

Aim is to be able to point this script at a folder full of markdown (e.g. from checkout of a github or Azure devops wiki) and have it fully import, with the folder structure and content fully formatted.

- Uses the official javascript SDK
- Supports nested folders, creates blank pages for folders
- Parses markdown to blocks via https://github.com/instantish/martian
- Allows you to search for parent page to import

# Usage

First of all, you need to create an integration with Notion (you need to be an admin): https://www.notion.so/my-integrations

Once you have created it, save the token, you need it later.

You then need to share the pages you want to import against with the Integration you created, otherwise you can't see them.

Finally, go to a command line:

```
npmx notionater -t secret_XXXX -g 'my-folder/**/**.md' -p 'Getting Started'
```

It assumes that `my-folder` is a set of nested folders containing markdown.  Note that I dont think images work yet, but haven't tried it.

# Plugins

You can add plugins to the plugins folder, and then use them from the command line (comma separated, no spaces).

```
npmx notionater -t secret_XXXX -g 'my-folder/**/**.md' -p 'Getting Started' -x devops
```

Plugins can expose two async functions:

```
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

This fixes header markup, and looks up users based on Guids, using the Azure CLI - this needs to be installed and configured separately, the plugins will fail if it is not installed and authenticated.  It caches the user lookups in a local file for subsequent loads - as it isn't fast.

# To-Do / Known issues

- It's a one file spaghetti code / hack day project
- The search API seems to return deleted files which sucks, but given you can filter based on search you can work around it
- It should check if a file exists first and ask you if you want to replace it
- Don't use a glob with `./` at the start as it will create a page called `.` - a good fix for a new contributor :D
- If notion can't resolve an image url, it fails to import the whole page.
- It depends on a fork of martian, hopefully the PR will get merged.

