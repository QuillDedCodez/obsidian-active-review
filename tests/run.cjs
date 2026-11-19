/** Runs the compiled test bundle from tests/.build. */
const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '.build');
// The repo's package.json is "type": "module"; compiled CommonJS output needs
// its own package scope.
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'package.json'), '{"type":"commonjs"}\n');

require(path.join(buildDir, 'tests', 'index.js'));
