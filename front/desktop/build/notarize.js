const fs = require('fs');
const path = require('path');
const { notarize } = require('@electron/notarize');

// Reads APPLE_* from the root .env when they are not already in the
// environment, so a local release build is not silently left unnotarized.
function loadAppleEnv() {
  const envPath = path.join(__dirname, '..', '..', '..', '.env');
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(APPLE_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  loadAppleEnv();

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    const message =
      'Notarization skipped: APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD are not set. ' +
      'This build is NOT notarized and must not be published.';
    if (process.env.LECTOR_RELEASE === '1') {
      throw new Error(message);
    }
    console.warn('\n' + '!'.repeat(72) + '\n' + message + '\n' + '!'.repeat(72) + '\n');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete!');
};
