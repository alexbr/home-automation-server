'use strict';

function playpause(player) {
  if (player.coordinator.state.playbackState === 'PLAYING') {
    return player.coordinator.pause();
  }

  return player.coordinator.play();
}

function play(player) {
  return player.coordinator.play();
}

function pause(player) {
  return player.coordinator.pause();
}

export default function(api) {
  api.registerAction('playpause', playpause);
  api.registerAction('play', play);
  api.registerAction('pause', pause);
};
