const path = require('path');
const { nodeZip } = require('bestzip');
const { name, version } = require('../package.json');

nodeZip({
  cwd: path.resolve(__dirname, '../dist'),
  source: '*',
  destination: path.resolve(__dirname, `../${name}-${version}-beta.zip`),
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
