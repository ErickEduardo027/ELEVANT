const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedApiClientRoot = path.resolve(projectRoot, '../../packages/api-client');
const config = getDefaultConfig(projectRoot);

// Conservar los valores predeterminados de Expo es obligatorio desde SDK 55.
// El cliente API compartido se agrega sin sustituir las raíces de resolución.
config.watchFolders = [
  ...new Set([...(config.watchFolders ?? []), sharedApiClientRoot]),
];
config.resolver.nodeModulesPaths = [
  ...new Set([
    ...(config.resolver.nodeModulesPaths ?? []),
    path.resolve(projectRoot, 'node_modules'),
  ]),
];

module.exports = config;
