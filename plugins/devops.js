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

// Only look up a user once, use the filesystem
let userCache;
try {
  userCache = require(cacheFile);
  console.log(`Loaded ${Object.keys(userCache).length} users from cache :D`)
} catch(ex) {
  console.log(`No users loaded from cache`);
  userCache = {};
}

console.log('You must have the Azure CLI installed - https://docs.microsoft.com/en-us/cli/azure/install-azure-cli');

// Persist the user cache because its damn slow
const persistUserCache = () => {
  fs.writeFileSync(cacheFile, JSON.stringify(userCache, null, 2));
}

// Lookup the user
const lookupUser = async (user) => {
    if (userCache[user]) return userCache[user];
    // Go for it
    try {
      const userGuid = user.replace('@<','').replace('>','');
      const stdout = await spawn('az', ['devops', 'user', 'show', '--user', userGuid, '--query', 'user'])
      const userData = JSON.parse(stdout)
      userCache[user] = `@${userData.displayName}`;
      process.stdout.write(` ${userCache[user]}`);
      persistUserCache();
      return userCache[user];
    } catch(ex) {
      console.log(`Failed for ${user} with ${ex.message}`);
      return user;  // Leave it alone
    }
}

exports.preParse = async (fileText) => {
  // Devops does crazy things with headers, so lets give it some space
  fileText = fileText.replaceAll(/(^|[ ])(#{1,5})(?!#)(\S.*?)/ugm, `$2 $3`);

  // Replace tabs with 2 spaces
  fileText = fileText.replaceAll(/\t/g, '  ');

  // Look for users: @<04FF2889-BB6F-64C0-BF9F-F7A5570712C6>
  const devopsUsers = fileText.match(/@<([a-zA-Z\-0-9]*)>/g);

  if (devopsUsers && devopsUsers.length >> 0) {
    // Look them up
    const lookupFns = [];
    for (const user of devopsUsers) {
      lookupFns.push(lookupUser(user));
    };
    process.stdout.write(`Looking up users ...`);
    const result = await Promise.all(lookupFns);
    process.stdout.write(`... done\n`);
    devopsUsers.forEach((user, index) => {
      fileText = fileText.replaceAll(user, result[index]);
    });
  }

  return fileText;
}

exports.postParse = async (blocks, notion, options) => {
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
            console.log(`Uploading ${file} ...`);
            const sendFile = await spawn('az', ['storage', 'blob', 'upload', '--file', `${file}`,'-c','$web','--account-name', options.azureBlobAccount]);            
            const newUrl = `${options.azureBlobUrl}${encodeURI(fileName)}`;
            block.image.external.url = newUrl;
            console.log(`File available at ${newUrl} ...`);            
            postBlocks.push(block);
          } catch(e) {
            console.log(`Error uploading file: ${e.stderr.toString()}`);
          }
        } else {
          console.log(`Could not find image ${file} ... check the images path?`);
        }       
      }      
    } else {
      postBlocks.push(block);
    }
  };  
  return postBlocks;
}