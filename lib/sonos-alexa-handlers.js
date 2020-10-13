'use strict';

const _ = require('lodash');
const moment = require('moment');
const util = require('util');
const mysql = require('mysql');
const http = require('http');
const logger = require('./logger');
const settings = require('../settings');
const SonosAPI = require('./sonos-api');

const api = new SonosAPI(settings);
const defaultMusicService = settings.defaultMusicService !== undefined &&
   settings.defaultMusicService !== '' ?
   settings.defaultMusicService : 'presets';
const defaultRoom = settings.defaultRoom !== undefined ? settings.defaultRoom : '';
const shortResponse = false;
const funnyResponse = false;
const validRooms = settings.validRooms;
const maxSearchTracks = 8;

let mysqlPool;
if (settings.db) {
   if (settings.db.mysql) {
      const mysqlConf = settings.db.mysql;
      logger.info('setting up mysql connection', settings.db.mysql);
      mysqlPool = mysql.createPool({
         socketPath: mysqlConf.socket,
         user: mysqlConf.user,
         password: mysqlConf.password,
         database: mysqlConf.database
      });
   }
}

const roomCoordinators = {};

function AlexaHandler(discovery) {
   this.discovery = discovery;
   this.stuff = {};
}

AlexaHandler.prototype.setAlexa = function(alexa) {
   this.alexa = alexa;
};

AlexaHandler.prototype.getIntentHandlers = function() {
   const self = this;
   let debugInfo;

   const handlers = {
      CanFulfillIntentRequest: function() {
         const { intent, response } = self.stuff;
         logger.info(response);
         logger.info(intent);
         return this.emit(':ok');
      },

      FallbackIntent: function() {
         let msg = `Sorry I didn't get that, give me some sonos commands.`;
         self.speakAndFinish(msg);
      },

      DebugIntent: function() {
         const { response } = self.stuff;
         let msg = `OK, here you go. Intent was ${debugInfo.name}. `;

         if (!_.isEmpty(debugInfo.slots)) {
            msg += _.reduce(debugInfo.slots, (s, slot, slotName) => {
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

            msg += '.';
         } else {
            msg += 'No slots.';
         }

         logger.info(msg);

         self.speakAndFinish(response, msg);
      },

      AlbumIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const album = intent.slots.Album.value;
         if (!album) {
            return this.emit(':delegate');
         }

         const artist = getResolvedSlot(intent.slots.Artist);

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            let query = album;
            if (artist) {
               query = `album:${album} artist:${artist}`;
            }

            return self.musicHandler(room, service, 'album', query, response)
               .then(() => {
                  return self.sonosAction('play', room);
               });
         }).then(() => {
            let msg = `Started album ${album}`;
            if (artist) {
               msg += ` by ${artist}`;
            }
            self.speakAndFinish(response, msg);
         }).catch(err => {
            self.error(response, err, {artist,album});
         });
      },

      ArtistIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const artist = getResolvedSlot(intent.slots.Artist);
         if (!artist) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.musicHandler(room, service, 'song', 'artist:' + artist, response);
         }).then(() => {
            let msg = `Playing artist ${artist}`;
            self.speakAndFinish(response, msg);
         }).catch(err => {
            self.error(response, err, {artist});
         });
      },

      TrackIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         let track = _.get(intent.slots, 'Title.value');
         if (!track) {
            track = _.get(intent.slots, 'SearchTitle.value');
         }
         if (!track) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            const artist = getResolvedSlot(intent.slots.Artist);

            let query = 'track:' + track;
            if (artist) {
               query += ' artist:' + artist;
            }

            return self.doSearch(room, service, 'song', query).then(() => {
               let msg = `Queuing song ${track}`;
               if (artist) {
                  msg += ` by ${artist}`;
               }
               self.speakAndFinish(response, msg);
            });
         }).catch(err => {
            self.error(response, err);
         });
      },

      SearchIntent: function() {
         const { intent, response, deviceId } = self.stuff;

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
               return self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
                  const { room } = res;
                  self.speakAndFinish(
                     response,
                     `OK. Playing ${track.trackName} by ${track.artistName}.`);
                  return self.playTrack(track, room);
               });
            } else {
               let song = _.get(intent.slots, 'Title.value');
               if (!song) {
                  song = _.get(intent.slots, 'SearchTitle.value');
               }
               if (!song) {
                  return this.emit(':delegate');
               }

               const { room, service } = res;
               const artist = getResolvedSlot(intent.slots.Artist);

               let query = `track:${song}`;
               if (artist) {
                  query = `${query} artist:${artist}`;
               }

               const type = 'song';
               const values = [ service, type, query ];

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
                     } else {
                        let msg = '';
                        let foundTrack;

                        // Clear out existing tracks
                        this.attributes.tracksToSelect = [];

                        _.each(tracks, (track, num) => {
                           if (track.trackName.toLowerCase() === song.toLowerCase() &&
                              artist &&
                              track.artistName.toLowerCase() === artist.toLowerCase()) {
                              foundTrack = track;

                              return false; // aka break
                           }

                           this.attributes.tracksToSelect.push(track);

                           msg += `${num + 1}. ${track.trackName} by ${track.artistName}. `;

                           if (num === maxSearchTracks - 1) {
                              return false; // aka break;
                           }
                        });

                        if (!foundTrack) {
                           const question = cleanSpeech(`Choose a track: ${msg}`);
                           return this.emit(':elicitSlot', 'TrackNumber', question, question);
                        } else {
                           self.speakAndFinish(
                              response,
                              `OK. Playing ${track.trackName} by ${track.artistName}.`);
                           return self.playTrack(track, room);
                        }
                     }
                  }
               });
            }
         }).catch(error => {
            self.error(response, error);
         });
      },

      MusicIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const name = intent.slots.Title.value;
         logger.info('looking for music', name);
         if (!name) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.musicHandler(room, service, 'song', name, response);
         }).then(() => {
            let msg = `Queued song ${name}`;
            self.speakAndFinish(response, msg);
         }).catch(err => {
            self.error(response, err);
         });
      },

      MusicRadioIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const artist = getResolvedSlot(intent.slots.Artist);
         logger.info('looking for artist', artist);
         if (!artist) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.musicHandler(room, service, 'station', artist, response);
         }).then(() => {
            let msg = `Started ${artist} radio`;
            self.speakAndFinish(response, msg);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PlayMoreByArtistIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.moreMusicHandler(room, service, 'song', response);
         }).then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PlayMoreLikeTrackIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value, function(room, service) {
            return self.moreMusicHandler(room, service, 'station', response);
         }).then(() => {
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

      PlayPresetIntent: function() {
         const { intent, response } = self.stuff;
         const preset = intent.slots.Preset.value;
         if (!preset) {
            return this.emit(':delegate');
         }

         self.sonosAction('preset', null, [ preset.toLowerCase() ]).then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PlaylistIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const preset = intent.slots.Preset.value;
         if (!preset) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.playlistHandler(room, preset, 'playlist', response);
         }).catch(error => {
            self.error(response, error, {preset});
         });
      },

      FavoriteIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const preset = getResolvedSlot(intent.slots.Preset);
         logger.info(`found preset ${preset}`);
         if (!preset) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.playlistHandler(room, preset, 'favorite', response);
         }).catch(error => {
            self.error(response, error, {preset});
         });
      },

      ChangeRoomIntent: function() {
         const { intent, response, deviceId } = self.stuff;
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

      ChangeServiceIntent: function() {
         const { intent, response, deviceId } = self.stuff;
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

      ChangeRoomAndServiceIntent: function() {
         const { intent, response, deviceId } = self.stuff;
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

      PauseAllIntent: function() {
         const { response } = self.stuff;

         self.sonosAction('pauseAll').then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PauseIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.sonosAction('pause', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      ResumeAllIntent: function() {
         const { response } = self.stuff;

         self.sonosAction('resumeAll').then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      ResumeIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;

            return self.sonosAction('play', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      SetSleepIntent: function() {
         const { intent, response, deviceId } = self.stuff;
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
         let msg = '';
         let remainder = durationSecs;

         // Shouldn't hit this...
         const days = Math.floor(remainder / (24 * 3600));
         if (days) {
            msg += days + (days > 1 ? ' days ' : ' day ');
            remainder = remainder % (days * 24 * 3600);
         }
         const hours = Math.floor(remainder / 3600);
         if (hours) {
            msg += hours + (hours > 1 ? ' hours ' : ' hour ');
            remainder = remainder % (hours * 3600);
         }
         const minutes = Math.floor(remainder / 60);
         if (minutes) {
            msg += minutes + (minutes > 1 ? ' minutes ' : ' minute ');
            remainder = remainder % (minutes * 60);
         }
         if (remainder) {
            msg += remainder + (remainder > 1 ? ' seconds' : ' second');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.sonosAction('sleep', room, [ durationSecs ]).then(() => {
               self.ok(response, `Ok. Sleeping in ${msg}`);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      SetSleepOffIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.sonosAction('sleep', room, [ 'off' ]).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      SetVolumeIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const volume = intent.slots.Percent.value;
         if (!volume) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.volumeHandler(room, response, volume);
         }).catch(error => {
            self.error(response, error);
         });
      },

      VolumeDownIntent: function() {
         const stuff = self.stuff;
         const { intent, response, deviceId } = stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
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

      VolumeUpIntent: function() {
         const stuff = self.stuff;
         const { intent, response, deviceId } = stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
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

      NextTrackIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.actOnCoordinator('next', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      PreviousTrackIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.actOnCoordinator('previous', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      WhatsPlayingIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;

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
                     `${currentTrack.title} by ${currentTrack.artist}.`
                  ];

                  responseText = stateResponses[Math.floor(Math.random() * stateResponses.length)];
               }

               response.cardRenderer("What's playing", responseText);

               self.speakAndFinish(response, responseText);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      MuteIntent: function() {
         const stuff = self.stuff;
         const { intent, response, deviceId } = stuff;

         // Don't worry about result
         self.sendAmpCommand(stuff, 'mute');

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.sonosAction('mute', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      UnmuteIntent: function() {
         const stuff = self.stuff;
         const { intent, response, deviceId } = stuff;

         // Don't worry about result
         self.sendAmpCommand(stuff, 'mute');

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.sonosAction('unmute', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      ClearQueueIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.actOnCoordinator('clearqueue', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      RepeatIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const toggle = intent.slots.Toggle.value;
         if (!toggle) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.toggleHandler(room, toggle, 'repeat', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      ShuffleIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const toggle = intent.slots.Toggle.value;
         if (!toggle) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.toggleHandler(room, toggle, 'shuffle', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      CrossfadeIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const toggle = intent.slots.Toggle.value;
         if (!toggle) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.toggleHandler(room, toggle, 'crossfade', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      UngroupIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room } = res;
            return self.sonosAction('isolate', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      JoinGroupIntent: function() {
         const { intent, response, deviceId } = self.stuff;
         const joiningRoom = intent.slots.JoiningRoom.value;
         if (!joiningRoom) {
            return this.emit(':delegate');
         }

         let playingRoom = intent.slots.PlayingRoom.value;

         self.loadRoomAndService(deviceId, playingRoom).then(res => {
            const { room } = res;
            if (isBlank(playingRoom)) {
               playingRoom = room;
            }

            return self.sonosAction('join', joiningRoom, [ playingRoom ]).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      // Amp handlers
      AmpOnIntent: function() {
         return self.sendAmpCommand(self.stuff, 'pwron').then(() => {
            self.ok(self.stuff.response);
         }).catch(error => {
            self.error(self.stuff.response, error);
         });
      },

      AmpOffIntent: function() {
         return self.sendAmpCommand(self.stuff, 'pwroff').then(() => {
            self.ok(self.stuff.response);
         }).catch(error => {
            self.error(self.stuff.response, error);
         });
      },

      AmpVolumeUpIntent: function() {
         return self.sendAmpCommand(self.stuff, 'volup', {amount: 5}).then(() => {
            self.ok(self.stuff.response);
         }).catch(error => {
            self.error(self.stuff.response, error);
         });
      },

      AmpVolumeDownIntent: function() {
         return self.sendAmpCommand(self.stuff, 'voldown', {amount: 5}).then(() => {
            self.ok(self.stuff.response);
         }).catch(error => {
            self.error(self.stuff.response, error);
         });
      },

      AmpMuteIntent: function() {
         return self.sendAmpCommand(self.stuff, 'mute').then(() => {
            self.ok(self.stuff.response);
         }).catch(error => {
            self.error(self.stuff.response, error);
         });
      },

      AmpTunerIntent: function() {
         return self.sendAmpCommand(self.stuff, 'bal').then(() => {
            self.ok(self.stuff.response);
         }).catch(error => {
            self.error(self.stuff.response, error);
         });
      },

      AmpPhonoIntent: function() {
         const { intent, response, deviceId } = self.stuff;

         return self.sendAmpCommand(self.stuff, 'phono').then(() => {
            return self.loadRoomAndService(
               deviceId, _.get(intent, 'slots.Room.value'));
         }).then(res => {
            const { room } = res;
            return self.sonosAction('pause', room);
         }).then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      SessionEndedRequest: function() {
         logger.info('session ended');
      },

      'AMAZON.CancelIntent': function() {
         self.speakAndFinish(this.response, `Cancelled.`);
      },

      Unhandled: function() {
         self.speakAndFinish(this.response, `Sorry, I didn't get that.`);
      }
   };

   const wrappedHandlers = {};
   _.forOwn(handlers, (h, name) => {
      if (!_.isFunction(h)) {
         return;
      }

      logger.info(`got intent function ${name}`);
      wrappedHandlers[name] = function() {
         self.stuff = self.getStuff(this);
         const slots = _.get(self.stuff , 'intent.slots');

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

AlexaHandler.prototype.sendAmpCommand = function(stuff, cmd, options) {
   const { intent, deviceId } = stuff;

   return this.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value')).then(response => {
      const { room } = response;
      const ampControl = _.find(settings.ampControl, ac => {
         return room && room.toLowerCase() === ac.room.toLowerCase();
      });

      if (ampControl) {
         let url = `http://${ampControl.host}/${cmd}`;
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
      } else {
         return Promise.resolve();
      }
   });
};

/**
 * Plays a single track in the given room
 */
AlexaHandler.prototype.playTrack = function(track, room) {
   return this.sonosAction('playTrack', room, [track]);
};

/**
 * Interface to the sonos API
 */
AlexaHandler.prototype.sonosAction = function(action, room, values) {
   // TODO: save room
   const discovery = this.discovery;

   if (discovery.zones.length === 0) {
      const msg = 'No sonos system has been discovered.';
      logger.error(msg);
      return Promise.reject({
         code: 500,
         status: 'error',
         error: msg
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
      values: values,
      player: player
   };

   return api.handleAction(opt).then(response => {
      let status;

      if (!response || response.constructor.name === 'IncomingMessage') {
         status = 'success';
      } else if (Array.isArray(response) && response.length > 0 &&
         response[0].constructor.name === 'IncomingMessage') {
         status = 'success';
      }

      return {
         code: 200,
         status: status,
         response: response
      };
   }).catch(error => {
      logger.error(error);
      return Promise.reject({
         code: 500,
         status: 'error',
         error: error.message ? error.message : error,
         stack: error.stack ? error.stack : error
      });
   });
};

AlexaHandler.prototype.doSearch = function(room, service, type, query) {
   const values = [];
   values.push(service.toLowerCase());
   values.push(type);
   values.push(query);

   return this.sonosAction('musicSearch', room, values);
};

/**
 * Handles Apple Music, Spotify, Deezer, library, or presets. The default can
 * be specified in settings.json or changed if advanced mode is turned on
 */
AlexaHandler.prototype.musicHandler = function(room, service, cmd, name) {
   const values = [];

   if (service === 'presets') {
      values.push(name);
      return this.sonosAction('preset', room, values);
   } else {
      values.push(service.toLowerCase());
      values.push(cmd);
      values.push(name);

      return this.actOnCoordinator('musicSearch', room, values);
   }
};

/**
 * Plays artist tracks or plays a radio station for the current track
 */
AlexaHandler.prototype.moreMusicHandler = function(room, service, cmd, response) {
   const self = this;

   return self.sonosAction('state', room).then(res => {
      const result = res.response;
      logger.info(`Currently playing ${result}`);

      if (result.currentTrack.artist !== undefined) {
         let name = result.currentTrack.artist;

         if (cmd.startsWith('station') &&
            (['apple', 'spotify', 'deezer', 'elite'].indexOf(service) !== -1)) {
            name += ' ' + result.currentTrack.title;
         }

         return self.musicHandler(room, service, cmd, name, response);
      } else {
         throw new Error('The current artist could not be identified.');
      }
   });
};

/**
 * Handles SiriusXM Radio
 */
AlexaHandler.prototype.siriusXMHandler = function(room, name, type, response) {
   const self = this;
   const values = [ name, type ];
   return this.actOnCoordinator('siriusxm', room, values).then(() => {
      self.speakAndFinish(response, `Sirius XM ${type} ${name} started.`);
   }).catch(error => {
      self.error(response, error);
   });
};

/**
 * Handles SiriusXM Radio
 */
AlexaHandler.prototype.pandoraHandler = function(room, cmd, name, response) {
   const self = this;
   const values = [ cmd, cmd === 'play' ? name : '' ];

   return this.actOnCoordinator('pandora', room, values).then(() => {
      if (cmd === 'play') {
         self.speakAndFinish(response, `Pandora ${name} started.`);
      } else {
         self.error(response, { message: 'Pandora failed.' });
      }
   }).catch(error => {
      self.error(response, error);
   });
};

/**
 * Handles playlists and favorites
 */
AlexaHandler.prototype.playlistHandler = function(room, preset, skillName, response) {
   const self = this;
   const values = [ preset ];

   // This first action queues up the playlist / favorite, and it shouldn't say
   // anything unless there's an error
   return self.actOnCoordinator(skillName, room, values).then(res => {
      const result = res.response;

      if (result.status === 'error') {
         throw new Error(result.error);
      }
   }).then(() => {
      // The 2nd action actually plays the playlist / favorite
      return self.actOnCoordinator('play', room);
   }).then(() => {
      const msg = `Started ${skillName} ${preset}.`;
      self.speakAndFinish(response, msg);
   }).catch(error => {
      self.error(response, error);
   });
};

/**
 * Handles all skills of the form /roomname/toggle/[on,off]
 */
AlexaHandler.prototype.toggleHandler = function(room, toggle, skillName, response) {
   const self = this;
   if (!toggle || (toggle!== 'on' && toggle!== 'off')) {
      const msg = `I need to know if I should turn ${skillName} on or off.` +
         `For example: Echo, tell Sonos to turn ${skillName} on.`;
      self.speakAndFinish(response, msg);
      return Promise.resolve();
   }

   return self.sonosAction(skillName, room, [ toggle ]).then(() => {
      return self.speakAndFinish(response, `${skillName} turned ${toggle}.`);
   }).catch(error => {
      self.error(response, error);
   });
};

/**
 * Handles up, down, & absolute volume for either an individual room or an
 * entire group
 */
AlexaHandler.prototype.volumeHandler = function(room, response, volume) {
   const self = this;
   const roomAndGroup = parseRoomAndGroup(room);

   if (!roomAndGroup.room) {
      const msg = 'Please specify a room.';
      self.speakAndFinish(response, msg);
      return Promise.resolve();
   }

   const values = [ volume ];
   const action = !roomAndGroup.group ? 'volume' : 'groupVolume';

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
   var roomAndGroupParsed = {};
   roomAndGroupParsed.group = false;
   roomAndGroupParsed.room = false;

   if (!roomArgument) {
      return roomAndGroupParsed;
   }

   var groupIndex = roomArgument.indexOf("group");

   if (groupIndex && (groupIndex + 4 === (roomArgument.length - 1)) &&
      roomArgument.length >= 7) {
      roomAndGroupParsed.group = true;
      roomAndGroupParsed.room = roomArgument.substr(0, groupIndex - 1);
   }
   else {
      roomAndGroupParsed.room = roomArgument;
   }

   return roomAndGroupParsed;
}

function isBlank(val) {
   return val === undefined || val === null || val === '';
}

AlexaHandler.prototype.changeCurrent = function(echoId, room, service) {
   return new Promise((resolve, reject) => {
      if (mysqlPool) {
         // Nothing to do, return
         if (isBlank(room) && isBlank(service)) {
            return resolve({ room: room, service: service });
         }

         mysqlPool.getConnection((err, conn) => {
            if (err) {
               logger.error(err);
               return reject('An error occurred.');
            }

            const query = `select count(*) c from alexa_room_service` +
               ` where device_id = ?`;
            logger.info(`running query '${query}'`);
            conn.query(query, [ echoId ], (err, res) => {
               logger.info(res);

               if (err) {
                  logger.error(err);
                  reject('An error occurred.');
                  return;
               }

               let update;
               let values;

               if (res.length > 0 && res[0].c > 0) {
                  let updateExpression;

                  if (!isBlank(room) && !isBlank(service)) {
                     updateExpression = 'set room = ?, service = ?';
                     values = [ room, service ];
                  } else if (!isBlank(room)) {
                     updateExpression = 'set room = ?';
                     values = [ room ];
                  } else if (!isBlank(service)) {
                     updateExpression = 'set service = ?';
                     values = [ service ];
                  }
                  values.push(echoId);
                  update = `update alexa_room_service ${updateExpression}` +
                     ` where device_id = ?`;
               } else {
                  if (isBlank(room)) {
                     room = defaultRoom;
                  }
                  if (isBlank(service)) {
                     service = defaultMusicService;
                  }
                  values = [ echoId, room, service ];
                  update = `insert into alexa_room_service` +
                     ` (device_id, room, service)` +
                     ` values(?, ?, ?)`;
               }

               logger.info(`running update '${update}'`);

               conn.query(update, values, err => {
                  conn.release();

                  if (err) {
                     logger.error(err);
                     reject('An error occurred.');
                  } else {
                     logger.info('database updated successfully');
                     resolve({ room: room, service: service });
                  }
               });
            });
         });
      } else {
         resolve({ room: room, service: service });
      }
   });
};

AlexaHandler.prototype.loadRoomAndService = function(echoId, room) {
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

         mysqlPool.getConnection((err, conn) => {
            if (err) {
               return reject(err);
            }

            const values = [ echoId, room, service ];
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

      return new Promise((resolve, reject) => {
         mysqlPool.getConnection((err, conn) => {
            if (err) {
               return reject(err);
            }

            const query = 'select room, service from alexa_room_service where device_id = ?';

            conn.query(query, [ echoId ], (err, res) => {
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
                  resolve(self.changeCurrent(echoId, newRoom, newService));
               }
            });
         });
      });
   }

   return new Promise(resolve => {
      if (mysqlPool) {
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
};

/**
 * 1) grab zones and find the coordinator for the room being asked for
 * 2) perform an action on that coordinator
 */
AlexaHandler.prototype.actOnCoordinator = function(action, room, values) {
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

   return roomPromise.then(coordinator => {
      return self.sonosAction(action, coordinator, values);
   });
};

AlexaHandler.prototype.speak = function(response, msg) {
   msg = cleanSpeech(msg);
   response.speak(msg);
};

AlexaHandler.prototype.speakAndFinish = function(response, msg) {
   this.speak(response, msg);
   this.alexa.emit(':responseReady');
};

function randomMsg(msgs) {
   return msgs[Math.floor(msgs.length * Math.random(msgs.length))];
}

function sayAs(msg) {
   return `<say-as interpret-as="interjection">${msg}</say-as>`;
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

AlexaHandler.prototype.ok = function(response) {
   let msg;
   if (shortResponse) {
      msg = "<audio src='https://s3.amazonaws.com/ask-soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_positive_response_01.mp3'/>";
   } else if (funnyResponse) {
      msg = randomMsg(okMsgs.concat(funnyOkMsgs));
   } else {
      msg = randomMsg(okMsgs);
   }

   this.speakAndFinish(response, msg);
};

const fuckMsgs = [
   `<emphasis level="strong"><phoneme alphabet="ipa" ph="ˈfʌk">fork</phoneme></emphasis>`,
   `<emphasis level="strong"><prosody rate="medium"><phoneme alphabet="ipa" ph="fʌgɛtʌbaʊtIt">fugetaboutit</phoneme></prosody></emphasis>`,
   sayAs('argh'),
   sayAs('aw man'),
   sayAs('blast'),
   sayAs("d'oh"),
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

   if (message.startsWith('Got status 500 when invoking')) {
      message = `That didn't work. Please check the sonos device.`;
   }

   return message;
}

AlexaHandler.prototype.error = function(response, error, data) {
   const errorMsg = getErrorMessage(error);
   const {intent} = this.stuff;
   const room = _.get(intent, 'slots.Room.value');
   let msg = '';

   data = data || {};
   data.room = room;

   if (shortResponse) {
      let disMsg = '';

      if (errorMsg) {
         disMsg += errorMsg;
      }

      if (data) {
         disMsg += (disMsg ? '\n' : '') + util.inspect(data);
      }

      response.cardRenderer('Error', disMsg);

      msg = "<audio src='soundbank://soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_negative_response_01'/>";
      //msg = "<audio src='https://s3.amazonaws.com/ask-soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_neutral_response_02.mp3'/>";
   } else {
      if (funnyResponse) {
         const start = randomMsg(fuckMsgs);
         msg = `${start}`;
      }

      if (errorMsg) {
         msg = `${msg} ${errorMsg}`;
      }
   }

   this.speakAndFinish(response, msg);
};

AlexaHandler.prototype.getStuff = function(handler) {
   const event = _.get(handler, 'event');

   if (!event) {
      this.stuff = {};
   } else {
      this.stuff = {
         intent: handler.event.request.intent,
         response: handler.response,
         context: handler.event.context,
         deviceId: handler.event.context.System.device.deviceId,
         isDisplay: _.get(handler.event.context, 'System.device.supportedInterfaces.Display'),
      };
   }

   return this.stuff;
};

function cleanSpeech(speech) {
   return speech.replace(/&/g, 'and');
}

function getResolvedSlot(slot) {
   if (!slot) {
      return;
   }

   const resolutions = slot.resolutions;
   if (resolutions && resolutions.resolutionsPerAuthority &&
      resolutions.resolutionsPerAuthority.length &&
      resolutions.resolutionsPerAuthority[0].values &&
      resolutions.resolutionsPerAuthority[0].values.length &&
      resolutions.resolutionsPerAuthority[0].values[0].value) {
      return resolutions.resolutionsPerAuthority[0].values[0].value.name;
   } else {
      return slot.value;
   }
}

// Given a room name, returns the name of the coordinator for that room
function findCoordinatorForRoom(responseJson, room) {
   logger.info(`finding coordinator for room ${room}`);

   for (var i = 0; i < responseJson.length; i++) {
      var zone = responseJson[i];

      for (var j = 0; j < zone.members.length; j++) {
         var member = zone.members[j];

         if ((member.roomName !== undefined) && (member.roomName.toLowerCase() === room.toLowerCase())) {
            return zone.coordinator.roomName;
         }
      }
   }
}

module.exports = AlexaHandler;
