/**
 * Plugin
 *   - preParse = executed on file text pre-processing
 *   - postParse = executed on notion object after processing
 */

const spawn = require('await-spawn')
const fs = require('fs')
const path = require('path')
const fg = require('fast-glob');
const {stat, mkdir} = require('fs/promises')
const modulePath = __dirname;
const cacheFile = `${modulePath}/devops-cache.json`;
const debug = require('debug')('notionater');

// Only look up a user once, use the filesystem
let userCache;
try {
  userCache = require(cacheFile);
  debug(`Loaded ${Object.keys(userCache).length} users from cache :D`)
} catch(ex) {
  debug(`No users loaded from cache`);
  userCache = {};
}

debug('You must have the Azure CLI installed - https://docs.microsoft.com/en-us/cli/azure/install-azure-cli');

// Persist the user cache because its damn slow
const persistUserCache = () => {
  fs.writeFileSync(cacheFile, JSON.stringify(userCache, null, 2));
}

// Lookup the user
const lookupUser = async (user, userProgress) => {
    if (userCache[user]) return userCache[user];
    // Go for it
    try {
      const userGuid = user.replace('@<','').replace('>','');
      const stdout = await spawn('az', ['devops', 'user', 'show', '--user', userGuid, '--query', 'user'])
      !process.env.DEBUG ? userProgress.increment() : null;
      const userData = JSON.parse(stdout)
      userCache[user] = `@${userData.displayName}`;      
      persistUserCache();
      return userCache[user];
    } catch(ex) {
      debug(`Failed for ${user} with ${ex.message}`);
      return user;  // Leave it alone
    }
}

exports.preParse = async (fileText, overallProgress) => {
  // Devops does crazy things with headers, so lets give it some space
  fileText = fileText.replaceAll(/(^|[ ])(#{1,5})(?!#)(\S.*?)/ugm, `$2 $3`);

  // Replace tabs with 2 spaces
  fileText = fileText.replaceAll(/\t/g, '  ');

  // Look for users: @<04FF2889-BB6F-64C0-BF9F-F7A5570712C6>
  const devopsUsers = fileText.match(/@<([a-zA-Z\-0-9]*)>/g);

  if (devopsUsers && devopsUsers.length >> 0) {
    // Look them up
    const userProgress = !process.env.DEBUG ? overallProgress.create(devopsUsers.length, 0, { filename: 'User lookup' }) : null;
    const lookupFns = [];
    for (const user of devopsUsers) {
      lookupFns.push(lookupUser(user, userProgress));
    };
    debug(`Looking up ${lookupFns.length} users ...`);
    const result = await Promise.all(lookupFns);    
    devopsUsers.forEach((user, index) => {
      fileText = fileText.replaceAll(user, result[index]);
    });
    overallProgress.remove(userProgress);
  }

  return fileText;
}

exports.postParse = async (blocks, notion, options, overallProgress) => {
  const allowedTypes = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.tif',
    '.tiff',
    '.bmp',
    '.svg',
    '.heic',
  ];
  const postBlocks = [];
  const blockProgress = !process.env.DEBUG ? overallProgress.create(blocks.length, 0, { filename: 'Image processing ...' }) : null;
  for(const index in blocks) {  
    const block = blocks[index];
    if (block.type === 'image') {      
      // Process the image!
      const imageUrl = decodeURI(block.image.external.url);
      try {
        const parsedUrl = new URL(imageUrl);
         const fileType = path.extname(parsedUrl.pathname);
         if (allowedTypes.includes(fileType)) {
          postBlocks.push(block);
         }                 
      } catch(ex) {
        // Need to upload 
        const file = path.join(options.images, decodeURI(imageUrl))        
        const fileName = path.basename(file);
        if (fs.existsSync(file)) {
          // Send off 
          try {
            debug(`Uploading ${file} ...`);
            const sendFile = await spawn('az', ['storage', 'blob', 'upload', '--file', `${file}`,'-c','$web','--account-name', options.azureBlobAccount]);            
            !process.env.DEBUG ? blockProgress.increment() : null;
            const newUrl = `${options.azureBlobUrl}${encodeURI(fileName)}`;
            block.image.external.url = newUrl;
            debug(`File available at ${newUrl} ...`);            
            postBlocks.push(block);
          } catch(e) {
            !process.env.DEBUG ? blockProgress.increment() : null;
            debug(`Error uploading file: ${e.stderr.toString()}`);
          }
        } else {
          !process.env.DEBUG ? blockProgress.increment() : null;
          debug(`Could not find image ${file} ... check the images path?`);
        }       
      }      
    } else {
      !process.env.DEBUG ? blockProgress.increment() : null;
      postBlocks.push(block);
    }
  };
  overallProgress.remove(blockProgress);
  return postBlocks;
}