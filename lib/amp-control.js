'use strict';

import { get } from 'http';
import { info, error } from './logger.js';

export function sendCmd(ampHost, cmd, options) {
  let url = `http://${ampHost}/${cmd}`;
  if ((cmd === 'volup' || cmd === 'voldown') && options && options.amount) {
    url = `${url}/${options.amount}`;
  }

  info(`sending ${cmd} to ${url}`);

  return new Promise((resolve, reject) => {
    get(url, res => {
      const { statusCode } = res;

      if (statusCode !== 200) {
        error(`request to ${url} failed`);
        reject();
        return;
      }

      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        info(`received: ${rawData}`);
        resolve();
      });
    }).on('error', e => {
      error(`Got error: ${e.message}`);
      reject(e);
    });
  });
}
