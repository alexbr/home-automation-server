'use strict';

const _ = require('lodash');
const mysql = require('mysql');
const logger = require('./logger');
const settings = require('../settings');

const validRooms = settings.validRooms;
const defaultRoom = settings.defaultRoom !== undefined ? settings.defaultRoom : '';
const defaultMusicService = settings.defaultMusicService !== undefined &&
   settings.defaultMusicService !== '' ?
   settings.defaultMusicService : 'presets';

class RoomServiceHelper {

   constructor() {
      this.mysqlPool = undefined;

      if (settings.db) {
         if (settings.db.mysql) {
            const mysqlConf = settings.db.mysql;
            const printableConf = _.clone(mysqlConf);
            printableConf.password = '*********';
            logger.info('setting up mysql connection', printableConf);
            this.mysqlPool = mysql.createPool({
               socketPath: mysqlConf.socket,
               user: mysqlConf.user,
               password: mysqlConf.password,
               database: mysqlConf.database
            });
         }
      }
   }

   changeCurrent(deviceId, room, service) {
      return new Promise((resolve, reject) => {
         if (this.mysqlPool) {
            let updateExpression;
            let values;

            if (!isBlank(room) && !isBlank(service)) {
               updateExpression = 'set room = ?, service = ?';
               values = [ room, service ];
            } else if (!isBlank(room)) {
               updateExpression = 'set room = ?';
               values = [ room ];
            } else if (!isBlank(service)) {
               updateExpression = 'set service = ?';
               values = [ service ];
            } else {
               return resolve({ room: room, service: service });
            }

            this.mysqlPool.getConnection((err, conn) => {
               if (err) {
                  return reject(err);
               }

               values.push(deviceId);

               const query = `update alexa_room_service ${updateExpression}` +
                  `where device_id = ?`;

               conn.query(query, values, (err) => {
                  conn.release();

                  if (err) {
                     reject(err);
                  } else {
                     resolve({ room: room, service: service });
                  }
               });
            });
         } else {
            resolve({ room: room, service: service });
         }
      });
   }

   loadRoomAndService(deviceId, room) {
      const self = this;
      let service = '';

      if (!isBlank(room) &&
         validRooms && validRooms.length &&
         !_.find(validRooms, vr => vr.toLowerCase() === room.toLowerCase())) {
         const msg = `invalid room ${room}`;
         logger.error(`invalid room ${room}`);
         return Promise.reject(msg);
      }

      function checkDefaults() {
         if (isBlank(room)) {
            room = defaultRoom;
         }
         if (isBlank(service)) {
            service = defaultMusicService;
         }
      }

      function addCurrent() {
         return new Promise((resolve, reject) => {
            checkDefaults();

            this.mysqlPool.getConnection((err, conn) => {
               if (err) {
                  return reject(err);
               }

               const values = [ deviceId, room, service ];
               const query = 'insert into alexa_room_service (device_id, room, service)' +
                  'values(?, ?, ?)';

               logger.info('Adding current settings ', values);
               conn.query(query, values, err => {
                  conn.release();

                  if (err) {
                     reject(err);
                  } else {
                     resolve({ room: room, service: service });
                  }
               });
            });
         });
      }

      function readCurrent()   {
         let newRoom;
         let newService;

         logger.info('Reading current settings');

         return new Promise((resolve, reject) => {
            this.mysqlPool.getConnection((err, conn) => {
               if (err) {
                  return reject(err);
               }

               const query = 'select room, service from alexa_room_service where device_id = ?';

               conn.query(query, [ deviceId ], (err, res) => {
                  conn.release();

                  if (err || !res || res.length === 0) {
                     return resolve(addCurrent());
                  }

                  if (isBlank(room)) {
                     room = res[0].room;
                  } else if (room !== res[0].room) {
                     newRoom = room;
                  }

                  if (isBlank(service)) {
                     service = res[0].service;
                  } else if (service !== res[0].service) {
                     newService = service;
                  }

                  logger.info(`room=${room}, newRoom=${newRoom}, service=${service}, newService=${newService}`);

                  if (isBlank(newRoom) && isBlank(newService)) {
                     logger.info(`returning room=${room}, service=${service}`);
                     resolve({ room: room, service: service });
                  } else {
                     if (isBlank(newRoom)) {
                        newRoom = room;
                     }
                     if (isBlank(newService)) {
                        newService = service;
                     }

                     logger.info(`changing to newRoom=${newRoom}, newService=${newService}`);
                     resolve(self.changeCurrent(deviceId, newRoom, newService));
                  }
               });
            });
         });
      }

      return new Promise(resolve => {
         if (deviceId && this.mysqlPool) {
            logger.info('database enabled');

            if (isBlank(service) || isBlank(room)) {
               resolve(readCurrent());
            } else {
               resolve({ room: room, service: service });
            }
         } else {
            checkDefaults();
            resolve({ room: room, service: service });
         }
      });
   }
}

function isBlank(val) {
   return val === undefined || val === null || val === '';
}

module.exports = {
   RoomServiceHelper
};
