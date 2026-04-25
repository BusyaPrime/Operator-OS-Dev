const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules')
];

// TS NodeNext + ESM convention: source files import siblings with the
// `.js` extension (e.g. `from '../services/auth-client.js'`) because
// that is the post-compile shape. `tsc` understands this and resolves
// to the `.ts` source. Metro by default does NOT — it looks for the
// literal `.js` file and fails. This resolver hook strips a trailing
// `.js` from a relative import when the literal file is missing and
// retries; if the .ts/.tsx source exists we get a normal resolve.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.js') && (moduleName.startsWith('.') || moduleName.startsWith('/'))) {
    try {
      return context.resolveRequest(
        context,
        moduleName.replace(/\.js$/, ''),
        platform
      );
    } catch {
      // Fall through to default resolution if extension-stripping
      // doesn't help (e.g. the file really is a `.js` artefact).
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
