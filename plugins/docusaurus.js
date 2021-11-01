
exports.preParse = async (fileText) => {

  // We want to strip out all the front matter
  fileText = fileText.replaceAll(/---(.|\n)*?---/umg,'');
  return fileText;

}