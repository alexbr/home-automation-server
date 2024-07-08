'use strict';

function favorite(player, values) {
  return player.coordinator.replaceWithFavorite(decodeURIComponent(values[0]))
    .then(() => player.coordinator.play());
}

export default function(api) {
  api.registerAction('favorite', favorite);
  api.registerAction('favourite', favorite);
};
