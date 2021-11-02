
exports.preParse = async (fileText) => {

  // Fix tables
  fileText = fileText.replaceAll(/\| --/g,'|--');

  // We want to strip out all the front matter
  fileText = fileText.replaceAll(/^---(.|\n)*?---/umg,'');

  return fileText;

}