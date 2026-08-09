const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// ELEVANT tiene un pnpm-workspace.yaml en la raíz, pero Mobile Agent se
// instala y ejecuta de manera independiente. Metro no debe intentar vigilar
// ni resolver dependencias desde ELEVANT/node_modules.
config.watchFolders = [projectRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
