const childProcess = require('child_process');
const fs = require('fs');
const fetch = require('node-fetch');
const semver = require('semver');
const PromiseRouter = require('express-promise-router');

const UpdatesController = PromiseRouter();

function readVersion(packagePath) {
  return new Promise(function(resolve, reject) {
    fs.readFile(packagePath, {encoding: 'utf8'}, function(err, data) {
      if (err) {
        reject(err);
        return;
      }
      let pkg = JSON.parse(data);
      if (!semver.valid(pkg.version)) {
        reject(new Error('invalid gateway semver: ' + pkg.version));
        return;
      }
      resolve(pkg.version);
    });
  });
}

function stat(path) {
  return new Promise(function(resolve, reject) {
    fs.stat(path, function(err, stats) {
      if (err) {
        if (err.code === 'ENOENT') {
          resolve(null);
        } else {
          reject(err);
        }
      } else {
        resolve(stats);
      }
    });
  });
}

/**
 * Send the client an object describing the latest release
 */
UpdatesController.get('/latest', async function(request, response) {
  const res = await
    fetch('https://api.github.com/repos/mozilla-iot/gateway/releases');
  const releases = await res.json();
  if (!releases || !releases.filter) {
    console.warn('API returned invalid releases, rate limit likely exceeded');
    response.send({version: null});
    return;
  }
  const latestRelease = releases.filter(release => {
    return !release.prerelease && !release.draft;
  })[0];
  if (!latestRelease) {
    console.warn('No releases found');
    response.send({version: null});
    return;
  }
  let releaseVer = latestRelease.tag_name;
  response.send({version: releaseVer});
});

/**
 * Send an object describing the update status of the gateway
 */
UpdatesController.get('/status', async function(request, response) {
  // gateway, gateway_failed, gateway_old
  // oldVersion -> gateway_old's package.json version
  // if (gateway_failed.version > thisversion) {
  //  update failed, last attempt was ctime of gateway_failed
  // }
  const currentVersion = await readVersion('package.json');
  let oldStats = await stat('../gateway_old/package.json');
  let oldVersion = null;

  let failedStats = await stat('../gateway_failed/package.json');
  let failedVersion = null;

  if (oldStats) {
    oldVersion = await readVersion('../gateway_old/package.json')
  }

  if (failedStats) {
    failedVersion = await readVersion('../gateway_failed/package.json')
  }

  if (failedVersion && semver.gt(failedVersion, currentVersion)) {
    response.send({
      success: false,
      version: currentVersion,
      failedVersion: failedVersion,
      timestamp: failedStats.ctimeMs
    });
  } else {
    let timestamp = null;
    if (oldStats) {
      timestamp = oldStats.ctimeMs;
    }
    response.send({
      success: true,
      version: currentVersion,
      oldVersion: oldVersion,
      timestamp: timestamp
    });
  }
});

UpdatesController.post('/update', async function(request, response) {
  childProcess.exec('sudo systemctl start ' +
    'mozilla-iot-gateway.check-for-update.service');

  response.end();
});

module.exports = UpdatesController;
