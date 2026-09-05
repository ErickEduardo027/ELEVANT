const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedApiClientRoot = path.resolve(projectRoot, '../../packages/api-client');
const config = getDefaultConfig(projectRoot);

// ELEVANT tiene un pnpm-workspace.yaml en la raíz, pero Mobile Agent se
// instala y ejecuta de manera independiente. Metro no debe intentar vigilar
// ni resolver dependencias desde ELEVANT/node_modules. Solo se agrega el
// cliente API compartido a las carpetas externas observadas.
config.watchFolders = [projectRoot, sharedApiClientRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
