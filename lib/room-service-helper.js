'use strict';

const _ = require('lodash');
const mysql = require('mysql');
const settings = require('../settings');
const logger = require('./logger');

const validRooms = settings.validRooms;
const defaultRoom = settings.defaultRoom === undefined ? '' : settings.defaultRoom;
const autoSaveRoomAndService = settings.autoSaveRoomAndService === undefined
	? false : settings.autoSaveRoom;
const defaultMusicService = settings.defaultMusicService !== undefined
   && settings.defaultMusicService !== ''
	? settings.defaultMusicService : 'presets';

class RoomServiceHelper {
	constructor() {
		this.mysqlPool = undefined;

		if (settings.db && settings.db.mysql) {
			const mysqlConf = settings.db.mysql;
			const printableConf = _.clone(mysqlConf);
			printableConf.password = '*********';
			logger.info('setting up mysql connection', printableConf);
			this.mysqlPool = mysql.createPool({
				// SocketPath: mysqlConf.socket,
				host: mysqlConf.host,
				user: mysqlConf.user,
				password: mysqlConf.password,
				database: mysqlConf.database,
			});
		}
	}

	changeCurrent(deviceId, room, service) {
		const self = this;
		return new Promise((resolve, reject) => {
			if (self.mysqlPool) {
				// Nothing to do, return
				if (isBlank(room) && isBlank(service)) {
					return resolve({room, service});
				}

				// Normalize room, service
				// if (!isBlank(room)) {
				//   room = room.toLowerCase();
				// }
				if (!isBlank(service)) {
					service = service.toLowerCase();
				}

				self.mysqlPool.getConnection((error, conn) => {
					if (error) {
						logger.error(error);
						return reject('An error occurred.');
					}

					const query = 'select count(*) c from alexa_room_service'
                  + ' where device_id = ?';
					logger.info(`running query '${query}'`);
					conn.query(query, [deviceId], (error, res) => {
						logger.info(res);

						if (error) {
							logger.error(error);
							reject('An error occurred.');
							return;
						}

						let update;
						let values;

						if (res.length > 0 && res[0].c > 0) {
							let updateExpression;

							if (!isBlank(room) && !isBlank(service)) {
								updateExpression = 'set room = ?, service = ?';
								values = [room, service];
							} else if (!isBlank(room)) {
								updateExpression = 'set room = ?';
								values = [room];
							} else if (!isBlank(service)) {
								updateExpression = 'set service = ?';
								values = [service];
							}

							values.push(deviceId);
							update = `update alexa_room_service ${updateExpression}`
                        + ' where device_id = ?';
						} else {
							if (isBlank(room)) {
								room = defaultRoom;
							}

							if (isBlank(service)) {
								service = defaultMusicService;
							}

							values = [deviceId, room, service];
							update = 'insert into alexa_room_service'
                        + ' (device_id, room, service)'
                        + ' values(?, ?, ?)';
						}

						logger.info(`running update '${update}'`);

						conn.query(update, values, error => {
							conn.release();

							if (error) {
								logger.error(error);
								reject('An error occurred.');
							} else {
								logger.info('database updated successfully');
								resolve({room, service});
							}
						});
					});
				});
			} else {
				resolve({room, service});
			}
		});
	}

	loadRoomAndService(deviceId, room) {
		const self = this;
		let service = '';

		// Find the room name in valid rooms - note this should exactly match,
		// including case, the sonos device name.
		if (!isBlank(room) && validRooms && validRooms.length > 0) {
			const foundRoom = findValidRoom(room);
			if (!foundRoom) {
				const message = `invalid room ${room}`;
				logger.error(`invalid room ${room}`);
				return Promise.reject(message);
			}

			// Use the valid room name
			room = foundRoom;
		}

		function checkDefaults() {
			if (isBlank(room)) {
				room = defaultRoom;
			}

			if (isBlank(service)) {
				service = defaultMusicService;
			}

			return {room, service};
		}

		function addCurrent() {
			return new Promise((resolve, reject) => {
				const {room, service} = checkDefaults();

				self.mysqlPool.getConnection((error, conn) => {
					if (error) {
						return reject(error);
					}

					const values = [deviceId, room, service];
					const query = 'insert into alexa_room_service (device_id, room, service)'
                  + 'values(?, ?, ?)';

					logger.info(`running update '${query}'`);

					conn.query(query, values, error => {
						conn.release();

						if (error) {
							logger.error(error);
							reject('An error occurred.');
						} else {
							logger.info('database updated successfully');
							resolve({room, service});
						}
					});
				});
			});
		}

		function readCurrent() {
			let newRoom;
			let newService;

			return new Promise((resolve, reject) => {
				self.mysqlPool.getConnection((error, conn) => {
					if (error) {
						return reject(error);
					}

					const query = 'select room, service from alexa_room_service where device_id = ?';

					conn.query(query, [deviceId], (error, res) => {
						conn.release();

						// Autosave the input room and service if there is none saved
						if (error || !res || res.length === 0) {
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
							resolve({room, service});
						} else {
							if (isBlank(newRoom)) {
								newRoom = room;
							}

							if (isBlank(newService)) {
								newService = service;
							}

							if (autoSaveRoomAndService) {
								logger.info(`changing to newRoom=${newRoom}, newService=${newService}`);
								resolve(self.changeCurrent(deviceId, newRoom, newService));
							} else {
								resolve({newRoom, newService});
							}
						}
					});
				});
			});
		}

		return new Promise(resolve => {
			if (deviceId && self.mysqlPool) {
				if (isBlank(service) || isBlank(room)) {
					readCurrent().then(res => {
            var resolved = {};
            if (isBlank(service)) {
              resolved.service = res.service;
            } else {
              resolved.service = service
            }
            if (isBlank(room)) {
              resolved.room = findValidRoom(res.room);
            } else {
              resolved.room = findValidRoom(room);
            }
						resolve(resolved);
					});
				} else {
					resolve({room: findValidRoom(room), service});
				}
			} else {
				const {room, service} = checkDefaults();
				resolve({room: findValidRoom(room), service});
			}
		});
	}
}

function findValidRoom(room) {
	return _.find(validRooms, vr => vr.toLowerCase() === room.toLowerCase());
}

function isBlank(value) {
	return value === undefined || value === null || value === '';
}

module.exports = RoomServiceHelper;
