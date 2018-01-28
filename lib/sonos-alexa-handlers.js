'use strict';

const logger = require('./logger');
const settings = require('../settings');
const SonosAPI = require('../lib/sonos-api');
const mysql = require('mysql');
const moment = require('moment');

const api = new SonosAPI(settings);
const defaultMusicService = settings.defaultMusicService !== undefined &&
   settings.defaultMusicService !== '' ?
   settings.defaultMusicService : 'presets';
const defaultRoom = settings.defaultRoom !== undefined ? settings.defaultRoom : '';

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

function AlexaHandler(discovery, alexa) {
   this.discovery = discovery;
   this.alexa = alexa;
}

AlexaHandler.prototype.getIntentHandlers = function() {
   const self = this;

   return {
      AlbumIntent: function() {
         logger.info("AlbumIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const album = intent.slots.Album.value;
         if (!album) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.musicHandler(room, service, 'album', album, response);
         }).catch(err => {
            self.error(response, err);
         });
      },

      ArtistIntent: function() {
         logger.info("ArtistIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const artist = getArtist(intent.slots.Artist);
         if (!artist) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.musicHandler(room, service, 'song', 'artist:' + artist, response);
         }).catch(err => {
            self.error(response, err);
         });
      },

      TrackIntent: function() {
         logger.info("MusicIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const track = intent.slots.Name.value;
         if (!track) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            const artist = getArtist(intent.slots.Artist);

            let query = 'track:' + track;
            if (artist) {
               query += ' artist:' + artist;
            }

            return self.doSearch(room, service, 'song', query).then(res => {
               let msg = `Playing song ${track}`;
               if (artist) {
                  msg += ` by ${artist}`;
               }
               self.speakAndFinish(response, msg);
            });
         }).catch(err => {
            self.error(response, err);
         });
      },

      MusicIntent: function() {
         logger.info("MusicIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const name = intent.slots.Name.value;
         logger.info('looking for music', name);
         if (!name) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.musicHandler(room, service, 'song', name, response);
         }).catch(err => {
            self.error(response, err);
         });
      },

      MusicRadioIntent: function() {
         logger.info("MusicRadioIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const artist = getArtist(intent.slots.Artist);
         logger.info('looking for artist', artist);
         if (!artist) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.musicHandler(room, service, 'station', artist, response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PlayMoreByArtistIntent: function() {
         logger.info("PlayMoreByArtist received");

         const { intent, response, deviceId } = getStuff(this);

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.moreMusicHandler(room, service, 'song', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PlayMoreLikeTrackIntent: function() {
         logger.info("PlayMoreLikeTrackIntent received");

         const { intent, response, deviceId } = getStuff(this);

         self.loadRoomAndService(deviceId, intent.slots.Room.value, function(room, service) {
            return self.moreMusicHandler(room, service, 'station', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      SiriusXMStationIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("SiriusXMStationIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.siriusXMHandler(room, intent.slots.Station.value, 'station', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      SiriusXMChannelIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("SiriusXMChannelIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.siriusXMHandler(room, intent.slots.Channel.value, 'channel', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PandoraMusicIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("PandoraMusicIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.pandoraHandler(room, 'play', intent.slots.Name.value, response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PandoraThumbsUpIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("PandoraThumbsUpIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.pandoraHandler(room, 'thumbsup', '', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PandoraThumbsDownIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("PandoraThumbsDownIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.pandoraHandler(room, 'thumbsdown', '', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PlayPresetIntent: function() {
         logger.info("PlayPresetIntent received");
         const { intent, response, deviceId } = getStuff(this);
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
         logger.info("PlaylistIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const preset = intent.slots.Preset.value;
         if (!preset) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.playlistHandler(room, preset, 'playlist', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      FavoriteIntent: function() {
         logger.info("FavoriteIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const preset = intent.slots.Preset.value;
         if (!preset) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.playlistHandler(room, preset, 'favorite', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      ChangeRoomIntent: function() {
         logger.info("ChangeRoomIntent received");
         const { intent, response, deviceId } = getStuff(this);
         const room = intent.slots.Room.value;
         if (!room) {
            return this.emit(':delegate');
         }

         self.changeCurrent(deviceId, room, '').then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      ChangeServiceIntent: function() {
         logger.info("ChangeServiceIntent received");
         const { intent, response, deviceId } = getStuff(this);
         const service = intent.slots.Service.value;
         if (!service) {
            return this.emit(':delegate');
         }
         self.changeCurrent(deviceId, '', service).then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      ChangeRoomAndServiceIntent: function() {
         logger.info("ChangeRoomAndServiceIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const room = intent.slots.Room.value;
         if (!room) {
            return this.emit(':delegate');
         }

         const service = intent.slots.Service.value;
         if (!service) {
            return this.emit(':delegate');
         }

         self.changeCurrent(deviceId, room, service).then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PauseAllIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("PauseAllIntent received");
         self.sonosAction('pauseAll').then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      PauseIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("PauseIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.sonosAction('pause', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      ResumeAllIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("ResumeAllIntent received");
         self.sonosAction('resumeAll').then(() => {
            self.ok(response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      ResumeIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("ResumeIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;

            return self.sonosAction('play', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      SetSleepIntent: function() {
         logger.info("SetSleepIntent received");

         const { intent, response, deviceId } = getStuff(this);
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
            const { room, service } = res;
            return self.sonosAction('sleep', room, [ durationSecs ]).then(() => {
               self.speakAndFinish(response, `Ok. Sleeping in ${msg}`);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      SetSleepOffIntent: function() {
         logger.info("SetSleepOffIntent received");
         const { intent, response, deviceId } = getStuff(this);
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.sonosAction('sleep', room, [ 'off' ]).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      SetVolumeIntent: function() {
         logger.info("SetVolumeIntent received");
         const { intent, response, deviceId } = getStuff(this);
         const volume = intent.slots.Percent.value;
         if (!volume) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.volumeHandler(room, response, volume);
         }).catch(error => {
            self.error(response, error);
         });
      },

      VolumeDownIntent: function() {
         logger.info("VolumeDownIntent received");
         const { intent, response, deviceId } = getStuff(this);

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.volumeHandler(room, response, '-5');
         }).catch(error => {
            self.error(response, error);
         });
      },

      VolumeUpIntent: function() {
         logger.info("VolumeUpIntent received");
         const { intent, response, deviceId } = getStuff(this);

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.volumeHandler(room, response, '+5');
         }).catch(error => {
            self.error(response, error);
         });
      },

      NextTrackIntent: function() {
         logger.info("NextTrackIntent received");
         const { intent, response, deviceId } = getStuff(this);

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.actOnCoordinator('next', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      PreviousTrackIntent: function() {
         logger.info("PreviousTrackIntent received");
         const { intent, response, deviceId } = getStuff(this);

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.actOnCoordinator('previous', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      WhatsPlayingIntent: function() {
         logger.info("WhatsPlayingIntent received");

         const { intent, response, deviceId } = getStuff(this);
         const handlerSelf = this;

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;

            return self.sonosAction('state', room).then(res => {
               const stateResponse = res.response;
               const currentTrack = stateResponse.currentTrack;
               let responseText;

               if (currentTrack.title.startsWith('x-sonosapi')) {
                  responseText = `This is ${currentTrack.artist}.`;
               } else {
                  const stateResponses = [
                     `This is ${currentTrack.title} by ${currentTrack.artist}.`,
                     `We\'re listening to ${currentTrack.title} by ${currentTrack.artist}.`,
                     `${currentTrack.title} by ${currentTrack.artist}.`
                  ];

                  responseText = stateResponses[Math.floor(Math.random() * stateResponses.length)];
               }

               self.speakAndFinish(response, responseText);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      MuteIntent: function() {
         logger.info("MuteIntent received");

         const { intent, response, deviceId } = getStuff(this);

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.sonosAction('mute', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      UnmuteIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("UnmuteIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.sonosAction('unmute', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      ClearQueueIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("ClearQueueIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.actOnCoordinator('clearqueue', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      RepeatIntent: function() {
         logger.info("RepeatIntent received");
         const { intent, response, deviceId } = getStuff(this);
         const toggle = intent.slots.Toggle.value;
         if (!toggle) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.toggleHandler(room, toggle, 'repeat', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      ShuffleIntent: function() {
         logger.info("ShuffleIntent received");
         const { intent, response, deviceId } = getStuff(this);
         const toggle = intent.slots.Toggle.value;
         if (!toggle) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.toggleHandler(room, toggle, 'shuffle', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      CrossfadeIntent: function() {
         logger.info("CrossfadeIntent received");
         const { intent, response, deviceId } = getStuff(this);
         const toggle = intent.slots.Toggle.value;
         if (!toggle) {
            return this.emit(':delegate');
         }

         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.toggleHandler(room, toggle, 'crossfade', response);
         }).catch(error => {
            self.error(response, error);
         });
      },

      UngroupIntent: function() {
         const { intent, response, deviceId } = getStuff(this);

         logger.info("UngroupIntent received");
         self.loadRoomAndService(deviceId, intent.slots.Room.value).then(res => {
            const { room, service } = res;
            return self.sonosAction('isolate', room).then(() => {
               self.ok(response);
            });
         }).catch(error => {
            self.error(response, error);
         });
      },

      JoinGroupIntent: function() {
         logger.info("JoinGroupIntent received");
         const { intent, response, deviceId } = getStuff(this);
         const joiningRoom = intent.slots.JoiningRoom.value;
         if (!joiningRoom) {
            return this.emit(':delegate');
         }

         let playingRoom = intent.slots.PlayingRoom.value;

         self.loadRoomAndService(deviceId, playingRoom).then(res => {
            logger.warn(res);
            const { room, service } = res;
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

      SessionEndedRequest: function() {
         logger.info('session ended');
      },

      Unhandled: function() {
         self.speakAndFinish(this.response, 'Sorry, I didn\'t get that.');
      }
   };
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

   logger.warn('sonosAction: ', action, room, values);

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
   values.push(service);
   values.push(type);
   values.push(query);

   logger.warn(values);

   return this.sonosAction('musicSearch', room, values);
};

/**
 * Handles Apple Music, Spotify, Deezer, library, or presets. The default can
 * be specified in settings.json or changed if advanced mode is turned on
 */
AlexaHandler.prototype.musicHandler = function(room, service, cmd, name, response) {
   const self = this;
   const values = [];

   if (service === 'presets') {
      values.push(name);
      return this.sonosAction('preset', room, values).then(() => {
         self.ok(response);
      }).catch(error => {
         self.error(response, error);
      });
   } else {
      values.push(service.toLowerCase());
      values.push(cmd);
      values.push(name);

      const msgStart = cmd.startsWith('station') ? 'Started ' : 'Queued and started ';
      const msgEnd = cmd.startsWith('station') ? ' radio' : '';

      return this.actOnCoordinator('musicSearch', room, values).then(res => {
         self.speakAndFinish(response, `${msgStart} ${name} ${msgEnd}`);
      }).catch(error => {
         self.error(response, error);
      });
   }
};

/**
 * Plays artist tracks or plays a radio station for the current track
 */
AlexaHandler.prototype.moreMusicHandler = function(room, service, cmd, response) {
   const self = this;

   return self.sonosAction('state', room).then(res => {
      const result = res.response;
      logger.info("Currently Playing = " + result);

      if (result.currentTrack.artist !== undefined) {
         let name = result.currentTrack.artist;

         if (cmd.startsWith('station') &&
            (['apple','spotify','deezer','elite'].indexOf(service) !== -1)) {
            name += ' ' + result.currentTrack.title;
         }

         self.musicHandler(room, service, cmd, name, response);
      } else {
         self.speakAndFinish(response, 'The current artist could not be identified.');
      }
   }).catch(error => {
      self.error(response, error);
   });
};

/**
 * Handles SiriusXM Radio
 */
AlexaHandler.prototype.siriusXMHandler = function(room, name, type, response) {
   const self = this;
   const values = [ name, type ];
   return this.actOnCoordinator('siriusxm', room, values).then(res => {
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
      }

      self.error(response, { message: 'Pandora failed.' });
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
      const msg = `Started ${skillName} ${preset} in ${room}.`;
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

   return this.sonosAction(skillName, room, [ toggle ]).then(() => {
      return self.speakAndFinish(response, `${skillName} turned ${toggle} in ${room}.`);
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

AlexaHandler.prototype.changeCurrent = function(echoId, room, service, onCompleteFun) {
   let resolve;
   let reject;

   return new Promise((resolve, reject) => {
      if (mysqlPool) {
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

         mysqlPool.getConnection((err, conn) => {
            if (err) {
               return reject(err);
            }

            values.push(echoId);

            const query = `update alexa_room_service ${updateExpression}` +
               `where device_id = ?`;

            conn.query(query, values, (err, result) => {
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
};

AlexaHandler.prototype.loadRoomAndService = function(echoId, room) {
   const self = this;
   let service = '';

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
            conn.query(query, values, (err, result) => {
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

   function readCurrent()	{
      let newRoom;
      let newService;

      logger.info('Reading current settings');

      return new Promise((resolve, reject) => {
         mysqlPool.getConnection((err, conn) => {
            if (err) {
               return reject(err);
            }

            const query = 'select room, service from alexa_room_service' +
               ' where device_id = ?';

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

   return new Promise((resolve, reject) => {
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
      logger.info("using cached coordinator", coordinator);
      roomPromise = Promise.resolve(coordinator);
   } else {
      logger.info("getting zones");
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

AlexaHandler.prototype.speakAndFinish = function(response, msg) {
   response.speak(msg);
   this.alexa.emit(':responseReady');
};

AlexaHandler.prototype.ok = function(response) {
   const msg = 'ok.'; //'Good <phoneme alphabet="ipa" ph="ˈʃɪt">sheet</phoneme>.';
   this.speakAndFinish(response, msg);
};

AlexaHandler.prototype.error = function(response, error) {
   //let msg = 'Aw <phoneme alphabet="ipa" ph="ˈfʌk">fork</phoneme>, looks like an error occurred.';
   let msg = 'Gosh dang, looks like an error occurred.';

   if (error) {
      if (error.message) {
         msg += ' ' + error.message;
      } else if (error.error) {
         msg += ' ' + error.error;
      }

      logger.error(error);
   }

   this.speakAndFinish(response, msg);
};

function getStuff(handler) {
   return {
      intent: handler.event.request.intent,
      response: handler.response,
      context: handler.event.context,
      deviceId: handler.event.context.System.device.deviceId,
   };
}

function getArtist(artistSlot) {
   if (!artistSlot) {
      return;
   }

   const resolutions = artistSlot.resolutions;
   if (resolutions && resolutions.resolutionsPerAuthority &&
      resolutions.resolutionsPerAuthority.length &&
      resolutions.resolutionsPerAuthority[0].values &&
      resolutions.resolutionsPerAuthority[0].values.length &&
      resolutions.resolutionsPerAuthority[0].values[0].value) {
      return resolutions.resolutionsPerAuthority[0].values[0].value.name;
   } else {
      return artistSlot.value;
   }
}

// Given a room name, returns the name of the coordinator for that room
function findCoordinatorForRoom(responseJson, room) {
   logger.info("finding coordinator for room: " + room);

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