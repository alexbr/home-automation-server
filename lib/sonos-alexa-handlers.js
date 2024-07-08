'use strict';

import { inspect } from 'node:util';
import _ from 'lodash';
import moment from 'moment';
import settings from '../settings.js';
import logger from './logger.js';
import SonosAPI from './sonos-api.js';
import { sendCmd } from './amp-control.js';
import RoomServiceHelper from './room-service-helper.js';

const api = new SonosAPI(settings);
const shortResponse = false;
const funnyResponse = false;
const maxSearchTracks = 8;
const roomService = new RoomServiceHelper();
const roomCoordinators = {};

class AlexaHandler {

  discovery;
  stuff = {};

  constructor(discovery) {
    this.discovery = discovery;
  }

  setAlexa(alexa) {
    this.alexa = alexa;
  }

  getIntentHandlers() {
    const self = this;
    let debugInfo;

    const handlers = {
      CanFulfillIntentRequest() {
        const { intent, response } = self.stuff;
        logger.info(response);
        logger.info(intent);
        return this.emit(':ok');
      },

      async FallbackIntent() {
        const message = 'Sorry I didn\'t get that, give me some sonos commands.';
        self.speakAndFinish(message);
      },

      async DebugIntent() {
        const { response } = self.stuff;
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

      async AlbumIntent() {
        const { intent, response, deviceId } = self.stuff;
        const album = intent.slots.Album.value;
        if (!album) {
          return this.emit(':delegate');
        }

        const artist = getResolvedSlot(intent.slots.Artist);

        try {
          const { room, service } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
          let query = album;
          if (artist) {
            query = `album:${album} artist:${artist}`;
          }

          await self.musicHandler(room, service, 'album', query, response);
          await self.sonosAction('play', room);
          let message = `Started album ${album}`;
          if (artist) {
            message += ` by ${artist}`;
          }

          self.speakAndFinish(response, message);
        } catch (error) {
          self.error(response, error, { artist, album });
        }
      },

      async ArtistIntent() {
        const { intent, response, deviceId } = self.stuff;
        const artist = getResolvedSlot(intent.slots.Artist);
        if (!artist) {
          return this.emit(':delegate');
        }

        try {
          const { room, service } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
          await self.musicHandler(room, service, 'song', 'artist:' + artist, response);
          const message = `Playing artist ${artist}`;
          self.speakAndFinish(response, message);
        } catch (error) {
          self.error(response, error, { artist });
        }
      },

      async TrackIntent() {
        const { intent, response, deviceId } = self.stuff;
        let track = _.get(intent.slots, 'Title.value');
        if (!track) {
          track = _.get(intent.slots, 'SearchTitle.value');
        }

        if (!track) {
          return this.emit(':delegate');
        }

        const { room, service } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        const artist = getResolvedSlot(intent.slots.Artist);

        let query = 'track:' + track;
        if (artist) {
          query += ' artist:' + artist;
        }

        await self.doSearch(room, service, 'song', query);
        let message = `Queuing song ${track}`;
        if (artist) {
          message += ` by ${artist}`;
        }
        self.speakAndFinish(response, message);
      },

      async SearchIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room, service } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));

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

        const artist = getResolvedSlot(intent.slots.Artist);

        let query = `track:${song}`;
        if (artist) {
          query = `${query} artist:${artist}`;
        }

        const type = 'song';
        const values = [service, type, query];

        const actionResponse = await self.sonosAction('search', room, values);
        const tracks = actionResponse.response.queueTracks;

        if (!tracks || tracks.length === 0) {
          self.speakAndFinish(response, `Sorry, no matches for ${song}.`);
          return;
        }
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
      },

      async MusicIntent() {
        const { intent, response, deviceId } = self.stuff;
        const name = intent.slots.Title.value;
        logger.info('looking for music', name);
        if (!name) {
          return this.emit(':delegate');
        }

        const { room, service } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.musicHandler(room, service, 'song', name, response);
        const message = `Queued song ${name}`;
        self.speakAndFinish(response, message);
      },

      async MusicRadioIntent() {
        const { intent, response, deviceId } = self.stuff;
        const artist = getResolvedSlot(intent.slots.Artist);
        logger.info('looking for artist', artist);
        if (!artist) {
          return this.emit(':delegate');
        }

        const { room, service } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.musicHandler(room, service, 'station', artist, response);
        const message = `Started ${artist} radio`;
        self.speakAndFinish(response, message);
      },

      async PlayMoreByArtistIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room, service } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.moreMusicHandler(room, service, 'song', response);
        self.ok(response);
      },

      async PlayMoreLikeTrackIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room, service } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.moreMusicHandler(room, service, 'station', response);
        self.ok(response);
      },

      async PlayPresetIntent() {
        const { intent, response } = self.stuff;
        const preset = intent.slots.Preset.value;
        if (!preset) {
          return this.emit(':delegate');
        }

        await self.sonosAction('preset', null, [preset.toLowerCase()]);
        self.ok(response);
      },

      async PlaylistIntent() {
        const { intent, response, deviceId } = self.stuff;
        const preset = intent.slots.Preset.value;
        if (!preset) {
          return this.emit(':delegate');
        }

        try {
          const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
          await self.playlistHandler(room, preset, 'playlist', response);
        } catch (error) {
          self.error(response, error, { preset });
        }
      },

      async FavoriteIntent() {
        const { intent, response, deviceId } = self.stuff;
        const preset = getResolvedSlot(intent.slots.Preset);
        logger.info(`found preset ${preset}`);
        if (!preset) {
          return this.emit(':delegate');
        }

        try {
          const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
          await self.playlistHandler(room, preset, 'favorite', response);
        } catch (error) {
          self.error(response, error, { preset });
        }
      },

      async ChangeRoomIntent() {
        const { intent, response, deviceId } = self.stuff;
        const room = _.get(intent, 'slots.Room.value');
        logger.info(`Changing ${deviceId} to ${room}`);
        if (!room) {
          return this.emit(':delegate');
        }

        await self.changeCurrent(deviceId, room);
        self.ok(response);
      },

      async ChangeServiceIntent() {
        const { intent, response, deviceId } = self.stuff;
        let service = intent.slots.Service.value;
        if (!service) {
          return this.emit(':delegate');
        }

        service = service.toLowerCase();

        if (!settings.validServices.includes(service)) {
          const message = 'Please provide a valid service';
          return this.emit(':elicitSlot', 'service', message, message);
        }

        await self.changeCurrent(deviceId, undefined, service);
        self.ok(response);
      },

      async ChangeRoomAndServiceIntent() {
        const { intent, response, deviceId } = self.stuff;
        const room = _.get(intent, 'slots.Room.value');
        if (!room) {
          return this.emit(':delegate');
        }

        let service = intent.slots.Service.value;
        if (!service) {
          return this.emit(':delegate');
        }

        service = service.toLowerCase();

        if (!settings.validServices.includes(service)) {
          const message = 'Please provide a valid service';
          return this.emit(':elicitSlot', 'service', message, message);
        }

        await self.changeCurrent(deviceId, room, service);
        self.ok(response);
      },

      async PauseAllIntent() {
        const { response } = self.stuff;

        await self.sonosAction('pauseAll');
        self.ok(response);
      },

      async PauseIntent() {
        const { intent, response, deviceId } = self.stuff;

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.sonosAction('pause', room);
        self.ok(response);
      },

      async ResumeAllIntent() {
        const { response } = self.stuff;

        await self.sonosAction('resumeAll');
        self.ok(response);
      },

      async ResumeIntent() {
        const { intent, response, deviceId } = self.stuff;

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));

        await self.sonosAction('play', room);
        self.ok(response);
      },

      async SetSleepIntent() {
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

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.sonosAction('sleep', room, [durationSecs]);
        self.ok(response, `Ok. Sleeping in ${message}`);
      },

      async SetSleepOffIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.sonosAction('sleep', room, ['off']);
        self.ok(response);
      },

      async SetVolumeIntent() {
        const { intent, response, deviceId } = self.stuff;
        const volume = intent.slots.Percent.value;
        if (!volume) {
          return this.emit(':delegate');
        }

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        return self.volumeHandler(room, response, volume);
      },

      async VolumeDownIntent() {
        const stuff = self.stuff;
        const { intent, response, deviceId } = stuff;

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        let volume = intent.slots.Volume.value;
        let volDown;
        if (volume === undefined) {
          volume = 5;
        }

        volDown = `-${volume}`;

        // Don't worry about result
        self.sendAmpCommand(stuff, 'voldown', { amount: volume });
        return self.volumeHandler(room, response, volDown);
      },

      async VolumeUpIntent() {
        const stuff = self.stuff;
        const { intent, response, deviceId } = stuff;
        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        let volume = intent.slots.Volume.value;
        let volUp;
        if (volume === undefined) {
          volume = 5;
        }

        volUp = `+${volume}`;

        // Don't worry about result
        self.sendAmpCommand(stuff, 'volup', { amount: volume });

        return self.volumeHandler(room, response, volUp);
      },

      async NextTrackIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.actOnCoordinator('next', room);
        self.ok(response);
      },

      async PreviousTrackIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.actOnCoordinator('previous', room);
        self.ok(response);
      },

      async WhatsPlayingIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        const actionResponse = await self.sonosAction('state', room);
        const stateResponse = actionResponse.response;
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
      },

      async MuteIntent() {
        const stuff = self.stuff;
        const { intent, response, deviceId } = stuff;

        // Don't worry about result
        self.sendAmpCommand(stuff, 'mute');

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.sonosAction('mute', room);
        self.ok(response);
      },

      async UnmuteIntent() {
        const stuff = self.stuff;
        const { intent, response, deviceId } = stuff;

        // Don't worry about result
        self.sendAmpCommand(stuff, 'mute');

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.sonosAction('unmute', room);
        self.ok(response);
      },

      async ClearQueueIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.actOnCoordinator('clearqueue', room);
        self.ok(response);
      },

      async RepeatIntent() {
        const { intent, response, deviceId } = self.stuff;
        const toggle = intent.slots.Toggle.value;
        if (!toggle) {
          return this.emit(':delegate');
        }

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        return self.toggleHandler(room, toggle, 'repeat', response);
      },

      async ShuffleIntent() {
        const { intent, response, deviceId } = self.stuff;
        const toggle = intent.slots.Toggle.value;
        if (!toggle) {
          return this.emit(':delegate');
        }

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        return self.toggleHandler(room, toggle, 'shuffle', response);
      },

      async CrossfadeIntent() {
        const { intent, response, deviceId } = self.stuff;
        const toggle = intent.slots.Toggle.value;
        if (!toggle) {
          return this.emit(':delegate');
        }

        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        return self.toggleHandler(room, toggle, 'crossfade', response);
      },

      async UngroupIntent() {
        const { intent, response, deviceId } = self.stuff;
        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        await self.sonosAction('isolate', room);
        self.ok(response);
      },

      async JoinGroupIntent() {
        const { intent, response, deviceId } = self.stuff;
        const joiningRoom = intent.slots.JoiningRoom.value;
        if (!joiningRoom) {
          return this.emit(':delegate');
        }

        let playingRoom = intent.slots.PlayingRoom.value;

        const { room } = await self.loadRoomAndService(deviceId, playingRoom);
        if (isBlank(playingRoom)) {
          playingRoom = room;
        }

        await self.sonosAction('join', joiningRoom, [playingRoom]);
        self.ok(response);
      },

      // Amp handlers
      async AmpOnIntent() {
        await self.sendAmpCommand(self.stuff, 'pwron');
        self.ok(self.stuff.response);
      },

      async AmpOffIntent() {
        await self.sendAmpCommand(self.stuff, 'pwroff');
        self.ok(self.stuff.response);
      },

      async AmpVolumeUpIntent() {
        await self.sendAmpCommand(self.stuff, 'volup', { amount: 5 });
        self.ok(self.stuff.response);
      },

      async AmpVolumeDownIntent() {
        await self.sendAmpCommand(self.stuff, 'voldown', { amount: 5 });
        self.ok(self.stuff.response);
      },

      async AmpMuteIntent() {
        await self.sendAmpCommand(self.stuff, 'mute');
        self.ok(self.stuff.response);
      },

      async AmpTunerIntent() {
        await self.sendAmpCommand(self.stuff, 'bal');
        self.ok(self.stuff.response);
      },

      async AmpPhonoIntent() {
        const { intent, response, deviceId } = self.stuff;

        await self.sendAmpCommand(self.stuff, 'phono');
        const { room } = await self.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
        self.sonosAction('pause', room);
        self.ok(response);
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
      wrappedHandlers[name] = function() {
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

        try {
          return _.bind(h, this)();
        } catch (err) {
          self.error(response, err);
        }
      };
    });

    return wrappedHandlers;
  }

  async sendAmpCommand(stuff, cmd, options) {
    const { intent, deviceId } = stuff;

    const response = await this.loadRoomAndService(deviceId, _.get(intent, 'slots.Room.value'));
    const { room } = response;
    const ampSettings = _.find(settings.ampControl, ac => room && room.toLowerCase() === ac.room.toLowerCase());
    if (ampSettings) {
      return sendCmd(ampSettings.host, cmd, options);
    }
  }
  /**
   * Plays a single track in the given room
   */
  playTrack(track, room) {
    return this.sonosAction('playTrack', room, [track]);
  }

  /**
   * Interface to the sonos API
   */
  async sonosAction(action, room, values) {
    // TODO: save room
    const discovery = this.discovery;

    if (discovery.zones.length === 0) {
      const message = 'No sonos system has been discovered.';
      logger.error(message);
      throw { code: 500, status: 'error', error: message };
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

    try {
      const response = await api.handleAction(opt);
      let status;

      if (!response || response.constructor.name === 'IncomingMessage') {
        status = 'success';
      } else if (Array.isArray(response) && response.length > 0
        && response[0].constructor.name === 'IncomingMessage') {
        status = 'success';
      }

      return { code: 200, status, response };
    } catch (error) {
      logger.error(error);
      throw {
        code: 500,
        status: 'error',
        error: error.message ? error.message : error,
        stack: error.stack ? error.stack : error,
      };
    }
  }

  doSearch(room, service, type, query) {
    const values = [];
    values.push(service.toLowerCase(), type, query);

    return this.sonosAction('musicSearch', room, values);
  }

  /**
   * Handles Apple Music, Spotify, Amazon, Deezer, library, or presets. The
   * default can be specified in settings.json or changed if advanced mode is
   * turned on
   */
  musicHandler(room, service, cmd, name) {
    const values = [];

    logger.info(`musicHandler name=${name}, cmd=${cmd}`);

    if (service === 'presets') {
      values.push(name);
      return this.sonosAction('preset', room, values);
    }

    values.push(service.toLowerCase(), cmd, name);

    return this.actOnCoordinator('musicSearch', room, values);
  }

  /**
   * Plays artist tracks or plays a radio station for the current track
   */
  async moreMusicHandler(room, service, cmd, response) {
    const self = this;
    const services = settings.validServices;

    logger.info(`moreMusicHandler cmd=${cmd}`);

    const res = await self.sonosAction('state', room);
    const result = res.response;
    logger.info(`Currently playing ${result}`);
    if (result.currentTrack.artist !== undefined) {
      let name = result.currentTrack.artist;

      if (cmd.startsWith('station') && services.includes(service)) {
        name += ' ' + result.currentTrack.title;
      }

      return self.musicHandler(room, service, cmd, name, response);
    }
    throw new Error('The current artist could not be identified.');
  }

  /**
   * Handles playlists and favorites
   */
  async playlistHandler(room, preset, skillName, response) {
    const self = this;
    const values = [preset];

    // This first action queues up the playlist / favorite, and it shouldn't say
    // anything unless there's an error
    try {
      const res = await self.actOnCoordinator(skillName, room, values);
      const result = res.response;

      if (result.status === 'error') {
        throw new Error(result.error);
      }
      await
        // The 2nd action actually plays the playlist / favorite
        self.actOnCoordinator('play', room);
      const message_1 = `Started ${skillName} ${preset}.`;
      self.speakAndFinish(response, message_1);
    } catch (error) {
      self.error(response, error);
    }
  }

  /**
   * Handles all skills of the form /roomname/toggle/[on,off]
   */
  async toggleHandler(room, toggle, skillName, response) {
    const self = this;
    if (!toggle || (toggle !== 'on' && toggle !== 'off')) {
      const message = `I need to know if I should turn ${skillName} on or off.`
        + `For example: Echo, tell Sonos to turn ${skillName} on.`;
      self.speakAndFinish(response, message);
      return;
    }

    await self.sonosAction(skillName, room, [toggle]);
    return self.speakAndFinish(response, `${skillName} turned ${toggle}.`);
  }

  /**
   * Handles up, down, & absolute volume for either an individual room or an
   * entire group
   */
  async volumeHandler(room, response, volume) {
    const self = this;
    const roomAndGroup = parseRoomAndGroup(room);

    if (!roomAndGroup.room) {
      const message = 'Please specify a room.';
      self.speakAndFinish(response, message);
      return Promise.resolve();
    }

    const values = [volume];
    const action = roomAndGroup.group ? 'groupVolume' : 'volume';

    try {
      await self.sonosAction(action, roomAndGroup.room, values);
      self.ok(response);
    } catch (error) {
      self.error(response, error);
    }
  }

  async changeCurrent(echoId, room, service) {
    return roomService.changeCurrent(echoId, room, service);
  }

  async loadRoomAndService(echoId, room) {
    return roomService.loadRoomAndService(echoId, room);
  }

  /**
   * 1) grab zones and find the coordinator for the room being asked for
   * 2) perform an action on that coordinator
   */
  async actOnCoordinator(action, room, values) {
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

    const coordinator_2 = await roomPromise;
    return await self.sonosAction(action, coordinator_2, values);
  }

  speak(response, message) {
    message = cleanSpeech(message);
    response.speak(message);
  }

  speakAndFinish(response, message) {
    this.speak(response, message);
    this.alexa.emit(':responseReady');
  }

  ok(response) {
    let message;
    if (shortResponse) {
      message = '<audio src=\'https://s3.amazonaws.com/ask-soundlibrary/ui/gameshow/amzn_ui_sfx_gameshow_positive_response_01.mp3\'/>';
    } else if (funnyResponse) {
      message = randomMessage(okMsgs.concat(funnyOkMsgs));
    } else {
      message = randomMessage(okMsgs);
    }

    this.speakAndFinish(response, message);
  }

  error(response, error, data) {
    const errorMessage = getErrorMessage(error);
    const { intent } = this.stuff;
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
        disMessage += (disMessage ? '\n' : '') + inspect(data);
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
  }

  getStuff(handler) {
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
  }
}














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

export default AlexaHandler;
