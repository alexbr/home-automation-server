'use strict';

const http = require('http');
const logger = require('./logger');

exports.sendCmd = function sendCmd(ampHost, cmd, options) {
   let url = `http://${ampHost}/${cmd}`;
   if ((cmd === 'volup' || cmd === 'voldown') && options && options.amount) {
      url = `${url}/${options.amount}`;
   }

   logger.info(`sending ${cmd} to ${url}`);

   return new Promise((resolve, reject) => {
      http.get(url, res => {
         const { statusCode } = res;

         if (statusCode !== 200) {
            logger.error(`request to ${url} failed`);
            reject();
            return;
         }

         res.setEncoding('utf8');
         let rawData = '';
         res.on('data', chunk => { rawData += chunk; });
         res.on('end', () => {
            logger.info(`received: ${rawData}`);
            resolve();
         });
      }).on('error', e => {
         logger.error(`Got error: ${e.message}`);
         reject(e);
      });
   });
};
