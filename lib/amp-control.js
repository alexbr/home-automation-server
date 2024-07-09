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
        const msg = `request to ${url} failed`;
        error(msg);
        reject(msg);
        return;
      }

      let rawData = '';

      res.setEncoding('utf8');
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        info(`received: ${rawData}`);
        resolve(rawData);
      });
    }).on('error', e => {
      error(`Got error: ${e.message}`);
      reject(e);
    });
  });
}
