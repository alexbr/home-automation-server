'use strict';

const util = require('node:util');
const _ = require('lodash');
const moment = require('moment');
const settings = require('../settings');
const logger = require('./logger');
const SonosAPI = require('./sonos-api');
const ampControl = require('./amp-control');
const RoomServiceHelper = require('./room-service-helper.js');

const api = new SonosAPI(settings);
const shortResponse = false;
const funnyResponse = false;
const maxSearchTracks = 8;
const roomService = new RoomServiceHelper();
const roomCoordinators = {};

function AlexaHandler(discovery) {
	this.discovery = discovery;
	this.stuff = {};
}

AlexaHandler.prototype.setAlexa = function (alexa) {
	this.alexa = alexa;
};

AlexaHandler.prototype.getIntentHandlers = function () {
	const self = this;
	let debugInfo;

	const handlers = {
		CanFulfillIntentRequest() {
			const {intent, response} = self.stuff;
			logger.info(response);
			logger.info(intent);
			return this.emit(':ok');
		},

		FallbackIntent() {
			const message = 'Sorry I didn\'t get that, give me some sonos commands.';
			self.speakAndFinish(message);
		},

		DebugIntent() {
			const {response} = self.stuff;
			let message = `OK, here you go. Intent was ${debugInfo.name}. `;

			if (_.isEmpty(debugInfo.slots)) {
				message += 'No slots.';
			} else {
				message += _.reduce(debugInfo.slots, (s, slot, slotName) => {
					const slotValue = _.get(slot, 'value', 'empty');
					if (s) {
						s += ', ';
					}

					s += `Slot ${slotName} was ${slotValue}, `;

					const resolvedSlot = getResolvedSlot(slot);
					if (resolvedSlot) {
						s += `resolved value was ${resolvedSlot}, `;
					}

					return s;
				}, '');

				message += '.';
			}

			logger.info(message);

			self.speakAndFinish(response, message);
		},

		AlbumIntent() {
			const {intent, response, deviceId} = self.stuff;
			const album = intent.slots.Album.value;
			if (!album) {
				return this.emit(':delegate');
			}

			const artist = getResolvedSlot(intent.slots.Artist);

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room, service} = res;
				let query = album;
				if (artist) {
					query = `album:${album} artist:${artist}`;
				}

				return self.musicHandler(room, service, 'album', query, response)
					.then(() => self.sonosAction('play', room));
			}).then(() => {
				let message = `Started album ${album}`;
				if (artist) {
					message += ` by ${artist}`;
				}

				self.speakAndFinish(response, message);
			}).catch(error => {
				self.error(response, error, {artist, album});
			});
		},

		ArtistIntent() {
			const {intent, response, deviceId} = self.stuff;
			const artist = getResolvedSlot(intent.slots.Artist);
			if (!artist) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room, service} = res;
				return self.musicHandler(room, service, 'song', 'artist:' + artist, response);
			}).then(() => {
				const message = `Playing artist ${artist}`;
				self.speakAndFinish(response, message);
			}).catch(error => {
				self.error(response, error, {artist});
			});
		},

		TrackIntent() {
			const {intent, response, deviceId} = self.stuff;
			let track = _.get(intent.slots, 'Title.value');
			if (!track) {
				track = _.get(intent.slots, 'SearchTitle.value');
			}

			if (!track) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room, service} = res;
				const artist = getResolvedSlot(intent.slots.Artist);

				let query = 'track:' + track;
				if (artist) {
					query += ' artist:' + artist;
				}

				return self.doSearch(room, service, 'song', query).then(() => {
					let message = `Queuing song ${track}`;
					if (artist) {
						message += ` by ${artist}`;
					}

					self.speakAndFinish(response, message);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		SearchIntent() {
			const {intent, response, deviceId} = self.stuff;

			return self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				// 1-indexed track number from client
				const selectedTrack = _.get(intent.slots, 'TrackNumber.value');

				// We're in the second step, track was selected from a list
				if (selectedTrack) {
					const tracksToSelect = this.attributes.tracksToSelect;

					if (selectedTrack < 1 || selectedTrack > tracksToSelect.length) {
						self.speakAndFinish(response, 'Next time select a valid track number, bonehead.');
						return;
					}

					const track = tracksToSelect[selectedTrack - 1];
					const {room} = res;

					self.speakAndFinish(response,
						`OK. Playing ${track.trackName} by ${track.artistName}.`);

					return self.playTrack(track, room);
				}

				let song = _.get(intent.slots, 'Title.value');
				if (!song) {
					song = _.get(intent.slots, 'SearchTitle.value');
				}

				if (!song) {
					return this.emit(':delegate');
				}

				const {room, service} = res;
				const artist = getResolvedSlot(intent.slots.Artist);

				let query = `track:${song}`;
				if (artist) {
					query = `${query} artist:${artist}`;
				}

				const type = 'song';
				const values = [service, type, query];

				return self.sonosAction('search', room, values).then(res => {
					const tracks = res.response.queueTracks;

					if (!tracks || tracks.length === 0) {
						self.speakAndFinish(response, `Sorry, no matches for ${song}.`);
					} else {
						const track = tracks[0];

						if (tracks.length === 1) {
							self.speakAndFinish(
								response,
								`OK. Playing ${track.trackName} by ${track.artistName}.`);
							return self.playTrack(track, room);
						}

						let message = '';
						let foundTrack;

						// Clear out existing tracks
						this.attributes.tracksToSelect = [];

						_.each(tracks, (track, number_) => {
							if (track.trackName.toLowerCase() === song.toLowerCase()
                              && artist
                              && track.artistName.toLowerCase() === artist.toLowerCase()) {
								foundTrack = track;

								return false; // Aka break
							}

							this.attributes.tracksToSelect.push(track);

							message += `${number_ + 1}. ${track.trackName} by ${track.artistName}. `;

							if (number_ === maxSearchTracks - 1) {
								return false; // Aka break;
							}
						});

						if (!foundTrack) {
							const question = cleanSpeech(`Choose a track: ${message}`);
							return this.emit(':elicitSlot', 'TrackNumber', question, question);
						}

						self.speakAndFinish(
							response,
							`OK. Playing ${track.trackName} by ${track.artistName}.`);
						return self.playTrack(track, room);
					}
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		MusicIntent() {
			const {intent, response, deviceId} = self.stuff;
			const name = intent.slots.Title.value;
			logger.info('looking for music', name);
			if (!name) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room, service} = res;
				return self.musicHandler(room, service, 'song', name, response);
			}).then(() => {
				const message = `Queued song ${name}`;
				self.speakAndFinish(response, message);
			}).catch(error => {
				self.error(response, error);
			});
		},

		MusicRadioIntent() {
			const {intent, response, deviceId} = self.stuff;
			const artist = getResolvedSlot(intent.slots.Artist);
			logger.info('looking for artist', artist);
			if (!artist) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room, service} = res;
				return self.musicHandler(room, service, 'station', artist, response);
			}).then(() => {
				const message = `Started ${artist} radio`;
				self.speakAndFinish(response, message);
			}).catch(error => {
				self.error(response, error);
			});
		},

		PlayMoreByArtistIntent() {
			const {intent, response, deviceId} = self.stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room, service} = res;
				return self.moreMusicHandler(room, service, 'song', response);
			}).then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		PlayMoreLikeTrackIntent() {
			const {intent, response, deviceId} = self.stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value, (room, service) => self.moreMusicHandler(room, service, 'station', response)).then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		/*
      SiriusXMStationIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.siriusXMHandler(room, intent.slots.Station.value, 'station', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      SiriusXMChannelIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.siriusXMHandler(room, intent.slots.Channel.value, 'channel', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PandoraMusicIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.pandoraHandler(room, 'play', intent.slots.Title.value, response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PandoraThumbsUpIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.pandoraHandler(room, 'thumbsup', '', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PandoraThumbsDownIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.pandoraHandler(room, 'thumbsdown', '', response);
         }).catch(error => {
            self.error(response, error);
         });
      },
      */

		PlayPresetIntent() {
			const {intent, response} = self.stuff;
			const preset = intent.slots.Preset.value;
			if (!preset) {
				return this.emit(':delegate');
			}

			self.sonosAction('preset', null, [preset.toLowerCase()]).then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		PlaylistIntent() {
			const {intent, response, deviceId} = self.stuff;
			const preset = intent.slots.Preset.value;
			if (!preset) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.playlistHandler(room, preset, 'playlist', response);
			}).catch(error => {
				self.error(response, error, {preset});
			});
		},

		FavoriteIntent() {
			const {intent, response, deviceId} = self.stuff;
			const preset = getResolvedSlot(intent.slots.Preset);
			logger.info(`found preset ${preset}`);
			if (!preset) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.playlistHandler(room, preset, 'favorite', response);
			}).catch(error => {
				self.error(response, error, {preset});
			});
		},

		ChangeRoomIntent() {
			const {intent, response, deviceId} = self.stuff;
			const room = intent.slots.Room.value;
			logger.info(`Changing ${deviceId} to ${room}`);
			if (!room) {
				return this.emit(':delegate');
			}

			self.changeCurrent(deviceId, room).then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		ChangeServiceIntent() {
			const {intent, response, deviceId} = self.stuff;
			const service = intent.slots.Service.value;
			if (!service) {
				return this.emit(':delegate');
			}

			self.changeCurrent(deviceId, undefined, service).then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		ChangeRoomAndServiceIntent() {
			const {intent, response, deviceId} = self.stuff;
			const room = intent.slots.Room.value;
			if (!room) {
				return this.emit(':delegate');
			}

			let service = intent.slots.Service.value;
			if (!service) {
				return this.emit(':delegate');
			}

			service = service.toLowerCase();

			self.changeCurrent(deviceId, room, service).then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		PauseAllIntent() {
			const {response} = self.stuff;

			self.sonosAction('pauseAll').then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		PauseIntent() {
			const {intent, response, deviceId} = self.stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.sonosAction('pause', room).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		ResumeAllIntent() {
			const {response} = self.stuff;

			self.sonosAction('resumeAll').then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		ResumeIntent() {
			const {intent, response, deviceId} = self.stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;

				return self.sonosAction('play', room).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		SetSleepIntent() {
			const {intent, response, deviceId} = self.stuff;
			const durationIntent = intent.slots.Duration.value;
			if (!durationIntent) {
				return this.emit(':delegate');
			}

			logger.info('got duration', durationIntent);

			let duration = moment.duration(durationIntent);

			// Sonos sleep must be < 1 day (or even smaller?)
			// Set to 1s less than one day
			if (duration.days() >= 1) {
				duration = moment.duration('PT' + (24 * 3600 - 1) + 'S');
			}

			const durationSecs = duration.asSeconds();
			let message = '';
			let remainder = durationSecs;

			// Shouldn't hit this...
			const days = Math.floor(remainder / (24 * 3600));
			if (days) {
				message += days + (days > 1 ? ' days ' : ' day ');
				remainder %= (days * 24 * 3600);
			}

			const hours = Math.floor(remainder / 3600);
			if (hours) {
				message += hours + (hours > 1 ? ' hours ' : ' hour ');
				remainder %= (hours * 3600);
			}

			const minutes = Math.floor(remainder / 60);
			if (minutes) {
				message += minutes + (minutes > 1 ? ' minutes ' : ' minute ');
				remainder %= (minutes * 60);
			}

			if (remainder) {
				message += remainder + (remainder > 1 ? ' seconds' : ' second');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.sonosAction('sleep', room, [durationSecs]).then(() => {
					self.ok(response, `Ok. Sleeping in ${message}`);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		SetSleepOffIntent() {
			const {intent, response, deviceId} = self.stuff;
			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.sonosAction('sleep', room, ['off']).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		SetVolumeIntent() {
			const {intent, response, deviceId} = self.stuff;
			const volume = intent.slots.Percent.value;
			if (!volume) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.volumeHandler(room, response, volume);
			}).catch(error => {
				self.error(response, error);
			});
		},

		VolumeDownIntent() {
			const stuff = self.stuff;
			const {intent, response, deviceId} = stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				let volume = intent.slots.Volume.value;
				let volDown;
				if (volume === undefined) {
					volume = 5;
				}

				volDown = `-${volume}`;

				// Don't worry about result
				self.sendAmpCommand(stuff, 'voldown', {amount: volume});

				return self.volumeHandler(room, response, volDown);
			}).catch(error => {
				self.error(response, error);
			});
		},

		VolumeUpIntent() {
			const stuff = self.stuff;
			const {intent, response, deviceId} = stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				let volume = intent.slots.Volume.value;
				let volUp;
				if (volume === undefined) {
					volume = 5;
				}

				volUp = `+${volume}`;

				// Don't worry about result
				self.sendAmpCommand(stuff, 'volup', {amount: volume});

				return self.volumeHandler(room, response, volUp);
			}).catch(error => {
				self.error(response, error);
			});
		},

		NextTrackIntent() {
			const {intent, response, deviceId} = self.stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.actOnCoordinator('next', room).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		PreviousTrackIntent() {
			const {intent, response, deviceId} = self.stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.actOnCoordinator('previous', room).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		WhatsPlayingIntent() {
			const {intent, response, deviceId} = self.stuff;

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;

				return self.sonosAction('state', room).then(res => {
					const stateResponse = res.response;
					const currentTrack = stateResponse.currentTrack;
					let responseText;

					if (currentTrack.title.startsWith('x-sonosapi')) {
						responseText = `This is ${currentTrack.artist}.`;
					} else {
						const stateResponses = [
							`This is ${currentTrack.title} by ${currentTrack.artist}.`,
							`We're listening to ${currentTrack.title} by ${currentTrack.artist}.`,
							`${currentTrack.title} by ${currentTrack.artist}.`,
						];

						responseText = stateResponses[Math.floor(Math.random() * stateResponses.length)];
					}

					response.cardRenderer('What\'s playing', responseText);

					self.speakAndFinish(response, responseText);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		MuteIntent() {
			const stuff = self.stuff;
			const {intent, response, deviceId} = stuff;

			// Don't worry about result
			self.sendAmpCommand(stuff, 'mute');

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.sonosAction('mute', room).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		UnmuteIntent() {
			const stuff = self.stuff;
			const {intent, response, deviceId} = stuff;

			// Don't worry about result
			self.sendAmpCommand(stuff, 'mute');

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.sonosAction('unmute', room).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		ClearQueueIntent() {
			const {intent, response, deviceId} = self.stuff;
			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.actOnCoordinator('clearqueue', room).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		RepeatIntent() {
			const {intent, response, deviceId} = self.stuff;
			const toggle = intent.slots.Toggle.value;
			if (!toggle) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.toggleHandler(room, toggle, 'repeat', response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		ShuffleIntent() {
			const {intent, response, deviceId} = self.stuff;
			const toggle = intent.slots.Toggle.value;
			if (!toggle) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.toggleHandler(room, toggle, 'shuffle', response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		CrossfadeIntent() {
			const {intent, response, deviceId} = self.stuff;
			const toggle = intent.slots.Toggle.value;
			if (!toggle) {
				return this.emit(':delegate');
			}

			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.toggleHandler(room, toggle, 'crossfade', response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		UngroupIntent() {
			const {intent, response, deviceId} = self.stuff;
			self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
				const {room} = res;
				return self.sonosAction('isolate', room).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		JoinGroupIntent() {
			const {intent, response, deviceId} = self.stuff;
			const joiningRoom = intent.slots.JoiningRoom.value;
			if (!joiningRoom) {
				return this.emit(':delegate');
			}

			let playingRoom = intent.slots.PlayingRoom.value;

			self.loadRoomAndService(deviceId, playingRoom).then(res => {
				const {room} = res;
				if (isBlank(playingRoom)) {
					playingRoom = room;
				}

				return self.sonosAction('join', joiningRoom, [playingRoom]).then(() => {
					self.ok(response);
				});
			}).catch(error => {
				self.error(response, error);
			});
		},

		// Amp handlers
		AmpOnIntent() {
			return self.sendAmpCommand(self.stuff, 'pwron').then(() => {
				self.ok(self.stuff.response);
			}).catch(error => {
				self.error(self.stuff.response, error);
			});
		},

		AmpOffIntent() {
			return self.sendAmpCommand(self.stuff, 'pwroff').then(() => {
				self.ok(self.stuff.response);
			}).catch(error => {
				self.error(self.stuff.response, error);
			});
		},

		AmpVolumeUpIntent() {
			return self.sendAmpCommand(self.stuff, 'volup', {amount: 5}).then(() => {
				self.ok(self.stuff.response);
			}).catch(error => {
				self.error(self.stuff.response, error);
			});
		},

		AmpVolumeDownIntent() {
			return self.sendAmpCommand(self.stuff, 'voldown', {amount: 5}).then(() => {
				self.ok(self.stuff.response);
			}).catch(error => {
				self.error(self.stuff.response, error);
			});
		},

		AmpMuteIntent() {
			return self.sendAmpCommand(self.stuff, 'mute').then(() => {
				self.ok(self.stuff.response);
			}).catch(error => {
				self.error(self.stuff.response, error);
			});
		},

		AmpTunerIntent() {
			return self.sendAmpCommand(self.stuff, 'bal').then(() => {
				self.ok(self.stuff.response);
			}).catch(error => {
				self.error(self.stuff.response, error);
			});
		},

		AmpPhonoIntent() {
			const {intent, response, deviceId} = self.stuff;

			return self.sendAmpCommand(self.stuff, 'phono').then(() => self.loadRoomAndService(
				deviceId, _.get(intent, 'slots.Room.value'))).then(res => {
				const {room} = res;
				return self.sonosAction('pause', room);
			}).then(() => {
				self.ok(response);
			}).catch(error => {
				self.error(response, error);
			});
		},

		SessionEndedRequest() {
			logger.info('session ended');
		},

		'AMAZON.CancelIntent'() {
			self.speakAndFinish(this.response, 'Cancelled.');
		},

		Unhandled() {
			self.speakAndFinish(this.response, 'Sorry, I didn\'t get that.');
		},
	};

	const wrappedHandlers = {};
	_.forOwn(handlers, (h, name) => {
		if (!_.isFunction(h)) {
			return;
		}

		logger.info(`got intent function ${name}`);
		wrappedHandlers[name] = function () {
			self.stuff = self.getStuff(this);
			const slots = _.get(self.stuff, 'intent.slots');

			if (name != 'DebugIntent') {
				debugInfo = {
					name,
					slots,
				};
			}

			logger.info(`${name} received`);
			logger.info(debugInfo);

			return _.bind(h, this)();
		};
	});

	return wrappedHandlers;
};

AlexaHandler.prototype.sendAmpCommand = function (stuff, cmd, options) {
	const {intent, deviceId} = stuff;

	return this.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value')).then(response => {
		const {room} = response;
		const ampSettings = _.find(settings.ampControl, ac => room && room.toLowerCase() === ac.room.toLowerCase());

		if (ampSettings) {
			return ampControl.sendCmd(ampSettings.host, cmd, options);
		}
	});
};

/**
 * Plays a single track in the given room
 */
AlexaHandler.prototype.playTrack = function (track, room) {
	return this.sonosAction('playTrack', room, [track]);
};

/**
 * Interface to the sonos API
 */
AlexaHandler.prototype.sonosAction = function (action, room, values) {
	// TODO: save room
	const discovery = this.discovery;

	if (discovery.zones.length === 0) {
		const message = 'No sonos system has been discovered.';
		logger.error(message);
		return Promise.reject({
			code: 500,
			status: 'error',
			error: message,
		});
	}

	values = values || [];

	logger.info('sonosAction: ', action, room, values);

	let player;

	if (room) {
		player = discovery.getPlayer(decodeURIComponent(room));
	}

	if (!player) {
		player = discovery.getAnyPlayer();
	}

	const opt = {
		action: (action || '').toLowerCase(),
		values,
		player,
	};

	return api.handleAction(opt).then(response => {
		let status;

		if (!response || response.constructor.name === 'IncomingMessage') {
			status = 'success';
		} else if (Array.isArray(response) && response.length > 0
         && response[0].constructor.name === 'IncomingMessage') {
			status = 'success';
		}

		return {
			code: 200,
			status,
			response,
		};
	}).catch(error => {
		logger.error(error);
		throw {
			code: 500,
			status: 'error',
			error: error.message ? error.message : error,
			stack: error.stack ? error.stack : error,
		};
	});
};

AlexaHandler.prototype.doSearch = function (room, service, type, query) {
	const values = [];
	values.push(service.toLowerCase(), type, query);

	return this.sonosAction('musicSearch', room, values);
};

/**
 * Handles Apple Music, Spotify, Deezer, library, or presets. The default can
 * be specified in settings.json or changed if advanced mode is turned on
 */
AlexaHandler.prototype.musicHandler = function (room, service, cmd, name) {
	const values = [];

	if (service === 'presets') {
		values.push(name);
		return this.sonosAction('preset', room, values);
	}

	values.push(service.toLowerCase(), cmd, name);

	return this.actOnCoordinator('musicSearch', room, values);
};

/**
 * Plays artist tracks or plays a radio station for the current track
 */
AlexaHandler.prototype.moreMusicHandler = function (room, service, cmd, response) {
	const self = this;

	return self.sonosAction('state', room).then(res => {
		const result = res.response;
		logger.info(`Currently playing ${result}`);

		if (result.currentTrack.artist !== undefined) {
			let name = result.currentTrack.artist;

			if (cmd.startsWith('station')
            && (['apple', 'spotify', 'deezer', 'elite'].includes(service))) {
				name += ' ' + result.currentTrack.title;
			}

			return self.musicHandler(room, service, cmd, name, response);
		}

		throw new Error('The current artist could not be identified.');
	});
};

/**
 * Handles SiriusXM Radio
 */
AlexaHandler.prototype.siriusXMHandler = function (room, name, type, response) {
	const self = this;
	const values = [name, type];
	return this.actOnCoordinator('siriusxm', room, values).then(() => {
		self.speakAndFinish(response, `Sirius XM ${type} ${name} started.`);
	}).catch(error => {
		self.error(response, error);
	});
};

/**
 * Handles SiriusXM Radio
 */
AlexaHandler.prototype.pandoraHandler = function (room, cmd, name, response) {
	const self = this;
	const values = [cmd, cmd === 'play' ? name : ''];

	return this.actOnCoordinator('pandora', room, values).then(() => {
		if (cmd === 'play') {
			self.speakAndFinish(response, `Pandora ${name} started.`);
		} else {
			self.error(response, {message: 'Pandora failed.'});
		}
	}).catch(error => {
		self.error(response, error);
	});
};

/**
 * Handles playlists and favorites
 */
AlexaHandler.prototype.playlistHandler = function (room, preset, skillName, response) {
	const self = this;
	const values = [preset];

	// This first action queues up the playlist / favorite, and it shouldn't say
	// anything unless there's an error
	return self.actOnCoordinator(skillName, room, values).then(res => {
		const result = res.response;

		if (result.status === 'error') {
			throw new Error(result.error);
		}
	}).then(() =>
	// The 2nd action actually plays the playlist / favorite
		self.actOnCoordinator('play', room),
	).then(() => {
		const message = `Started ${skillName} ${preset}.`;
		self.speakAndFinish(response, message);
	}).catch(error => {
		self.error(response, error);
	});
};

/**
 * Handles all skills of the form /roomname/toggle/[on,off]
 */
AlexaHandler.prototype.toggleHandler = function (room, toggle, skillName, response) {
	const self = this;
	if (!toggle || (toggle !== 'on' && toggle !== 'off')) {
		const message = `I need to know if I should turn ${skillName} on or off.`
         + `For example: Echo, tell Sonos to turn ${skillName} on.`;
		self.speakAndFinish(response, message);
		return Promise.resolve();
	}

	return self.sonosAction(skillName, room, [toggle]).then(() => self.speakAndFinish(response, `${skillName} turned ${toggle}.`)).catch(error => {
		self.error(response, error);
	});
};

/**
 * Handles up, down, & absolute volume for either an individual room or an
 * entire group
 */
AlexaHandler.prototype.volumeHandler = function (room, response, volume) {
	const self = this;
	const roomAndGroup = parseRoomAndGroup(room);

	if (!roomAndGroup.room) {
		const message = 'Please specify a room.';
		self.speakAndFinish(response, message);
		return Promise.resolve();
	}

	const values = [volume];
	const action = roomAndGroup.group ? 'groupVolume' : 'volume';

	return self.sonosAction(action, roomAndGroup.room, values).then(() => {
		self.ok(response);
	}).catch(error => {
		self.error(response, error);
	});
};

/**
 * Given a string roomArgument that either looks like "my room" or "my room
 * group", returns an object with two members:
 *   obj.group: true if roomArgument ends with "group", false otherwise.
 *   obj.room: if roomArgument is "my room group", returns "my room"
 */
function parseRoomAndGroup(roomArgument) {
	const roomAndGroupParsed = {};
	roomAndGroupParsed.group = false;
	roomAndGroupParsed.room = false;

	if (!roomArgument) {
		return roomAndGroupParsed;
	}

	const groupIndex = roomArgument.indexOf('group');

	if (groupIndex && (groupIndex + 4 === (roomArgument.length - 1))
      && roomArgument.length >= 7) {
		roomAndGroupParsed.group = true;
		roomAndGroupParsed.room = roomArgument.slice(0, Math.max(0, groupIndex - 1));
	} else {
		roomAndGroupParsed.room = roomArgument;
	}

	return roomAndGroupParsed;
}

function isBlank(value) {
	return value === undefined || value === null || value === '';
}

AlexaHandler.prototype.changeCurrent = function (echoId, room, service) {
	return roomService.changeCurrent(echoId, room, service);
};

AlexaHandler.prototype.loadRoomAndService = function (echoId, room) {
	return roomService.loadRoomAndService(echoId, room);
};

/**
 * 1) grab zones and find the coordinator for the room being asked for
 * 2) perform an action on that coordinator
 */
AlexaHandler.prototype.actOnCoordinator = function (action, room, values) {
	logger.info('actOnCoordinator', room, action);
	const self = this;

	let roomPromise;

	if (roomCoordinators[room]) {
		const coordinator = roomCoordinators[room];
		logger.info(`using cached coordinator ${coordinator}`);
		roomPromise = Promise.resolve(coordinator);
	} else {
		logger.info('getting zones');
		roomPromise = self.sonosAction('zones').then(res => {
			const response = res.response;
			const coordinator = findCoordinatorForRoom(response, room);

			roomCoordinators[room] = coordinator;

			return coordinator;
		});
	}

	return roomPromise.then(coordinator => self.sonosAction(action, coordinator, values));
};

AlexaHandler.prototype.speak = function (response, message) {
	message = cleanSpeech(message);
	response.speak(message);
};

AlexaHandler.prototype.speakAndFinish = function (response, message) {
	this.speak(response, message);
	this.alexa.emit(':responseReady');
};

function randomMessage(msgs) {
	return msgs[Math.floor(msgs.length * Math.random(msgs.length))];
}

function sayAs(message) {
	return `<say-as interpret-as="interjection">${message}</say-as>`;
}

const okMsgs = [
	'ok',
	'got it',
	'sure',
	'done',
];

const funnyOkMsgs = [
	'Good <phoneme alphabet="ipa" ph="ˈʃɪt">sheet</phoneme>.',
	sayAs('bam'),
	sayAs('as you wish'),
	sayAs('giddy up'),
	sayAs('gotcha'),
	sayAs('okey dokey'),
	sayAs('quack'),
	sayAs('righto'),
	sayAs('roger'),
	sayAs('you bet'),
];

AlexaHandler.prototype.ok = function (response) {
	let message;
	if (shortResponse) {
		message = '<audio src=\'https://s3.amazonaws.com/ask-soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_positive_response_01.mp3\'/>';
	} else if (funnyResponse) {
		message = randomMessage(okMsgs.concat(funnyOkMsgs));
	} else {
		message = randomMessage(okMsgs);
	}

	this.speakAndFinish(response, message);
};

const fuckMsgs = [
	'<emphasis level="strong"><phoneme alphabet="ipa" ph="ˈfʌk">fork</phoneme></emphasis>',
	'<emphasis level="strong"><prosody rate="medium"><phoneme alphabet="ipa" ph="fʌgɛtʌbaʊtIt">fugetaboutit</phoneme></prosody></emphasis>',
	sayAs('argh'),
	sayAs('aw man'),
	sayAs('blast'),
	sayAs('d\'oh'),
	sayAs('great scott'),
	sayAs('oh brother'),
	sayAs('oh snap'),
];

function getErrorMessage(error) {
	if (!error) {
		return;
	}

	logger.error(error);

	let message;
	if (error.message) {
		message = error.message;
	} else if (error.error) {
		message = error.error;
	}

	if (!message || message.startsWith('Got status 500 when invoking')) {
		message = 'That didn\'t work. Please check the sonos device.';
	}

	return message;
}

AlexaHandler.prototype.error = function (response, error, data) {
	const errorMessage = getErrorMessage(error);
	const {intent} = this.stuff;
	const room = _.get(intent, 'slots.Room.value');
	let message = '';

	data = data || {};
	data.room = room;

	if (shortResponse) {
		let disMessage = '';

		if (errorMessage) {
			disMessage += errorMessage;
		}

		if (data) {
			disMessage += (disMessage ? '\n' : '') + util.inspect(data);
		}

		response.cardRenderer('Error', disMessage);

		message = '<audio src=\'soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_negative_response_01\'/>';
		// Msg = "<audio src='https://s3.amazonaws.com/ask-soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_neutral_response_02.mp3'/>";
	} else {
		if (funnyResponse) {
			const start = randomMessage(fuckMsgs);
			message = `${start}`;
		}

		if (errorMessage) {
			message = `${message} ${errorMessage}`;
		}
	}

	this.speakAndFinish(response, message);
};

AlexaHandler.prototype.getStuff = function (handler) {
	const event = _.get(handler, 'event');

	if (event) {
		this.stuff = {
			intent: handler.event.request.intent,
			response: handler.response,
			context: handler.event.context,
			deviceId: handler.event.context.System.device.deviceId,
			isDisplay: _.get(handler.event.context, 'System.device.supportedInterfaces.Display'),
		};
	} else {
		this.stuff = {};
	}

	return this.stuff;
};

function cleanSpeech(speech) {
	return speech.replaceAll('&', 'and');
}

function getResolvedSlot(slot) {
	if (!slot) {
		return;
	}

	const resolutions = slot.resolutions;
	if (resolutions && resolutions.resolutionsPerAuthority
      && resolutions.resolutionsPerAuthority.length > 0
      && resolutions.resolutionsPerAuthority[0].values
      && resolutions.resolutionsPerAuthority[0].values.length > 0
      && resolutions.resolutionsPerAuthority[0].values[0].value) {
		return resolutions.resolutionsPerAuthority[0].values[0].value.name;
	}

	return slot.value;
}

// Given a room name, returns the name of the coordinator for that room
function findCoordinatorForRoom(responseJson, room) {
	logger.info(`finding coordinator for room ${room}`);

	for (const zone of responseJson) {
		for (let j = 0; j < zone.members.length; j++) {
			const member = zone.members[j];

			if ((member.roomName !== undefined) && (member.roomName.toLowerCase() === room.toLowerCase())) {
				return zone.coordinator.roomName;
			}
		}
	}
}

module.exports = AlexaHandler;
