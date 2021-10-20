/* eslint-disable no-await-in-loop */
module.exports.dependencies = ['axios', '@cospired/i18n-iso-languages', 'path'];
const details = () => ({
  id: 'Tdarr_Plugin_henk_Keep_Native_Lang_Plus_Eng',
  Stage: 'Pre-processing',
  Name: 'Remove all langs except native and English',
  Type: 'Audio',
  Operation: 'Transcode',
  Description: `This plugin will remove all language audio tracks except the 'native'
     (requires TMDB api key) and English.
    'Native' languages are the ones that are listed on imdb. It does an API call to 
    Radarr, Sonarr to check if the movie/series exists and grabs the IMDB id. As a last resort it 
    falls back to '[imdb-ttDIGITS] in the filename.`,
  Version: '1.00',
  Link: 'https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/Community/'
    + 'Tdarr_Plugin_henk_Keep_Native_Lang_Plus_Eng.js',
  Tags: 'pre-processing,configurable',

  Inputs: [
    {
      name: 'user_langs',
      tooltip: 'Input a comma separated list of ISO-639-2 languages. It will still keep English and undefined tracks.'
        + '(https://en.wikipedia.org/wiki/List_of_ISO_639-2_codes 639-2 column)'
        + '\\nExample:\\n'
        + 'nld,nor',
    },
    {
      name: 'priority',
      tooltip: 'Priority for either Radarr or Sonarr. Leaving it empty defaults to Radarr first.'
        + '\\nExample:\\n'
        + 'sonarr',
    },
    {
      name: 'api_key',
      tooltip: 'Input your TMDB api key here. (https://www.themoviedb.org/)',
    },
    {
      name: 'radarr_api_key',
      tooltip: 'Input your Radarr api key here.',
    },
    {
      name: 'radarr_url',
      tooltip: 'Input your Radarr url here. (Without http://). Do include the port.'
        + '\\nExample:\\n'
        + '192.168.1.2:7878',
    },
    {
      name: 'sonarr_api_key',
      tooltip: 'Input your Sonarr api key here.',
    },
    {
      name: 'sonarr_url',
      tooltip: 'Input your Sonarr url here. (Without http://). Do include the port.'
        + '\\nExample:\\n'
        + '192.168.1.2:8989',
    },
  ],
});
const response = {
  processFile: false,
  preset: ', -map 0 ',
  container: '.',
  handBrakeMode: false,
  FFmpegMode: true,
  reQueueAfter: false,
  infoLog: '',
};

const processStreams = (result, file, user_langs) => {
  // eslint-disable-next-line global-require,import/no-unresolved
  const languages = require('@cospired/i18n-iso-languages');
  const tracks = {
    keep: [],
    remove: [],
    remLangs: '',
  };
  let streamIndex = 0;

  const langsTemp = result.original_language;
  let langs = [];

  if (Array.isArray(langsTemp)) {
    // For loop because I thought some imdb stuff returns multiple languages
    // Translates 'en' to 'eng', because imdb uses a different format compared to ffmpeg
    for (let i = 0; i < langsTemp.length; i += 1) {
      langs.push(languages.alpha2ToAlpha3B(langsTemp));
    }
  } else {
    langs.push(languages.alpha2ToAlpha3B(langsTemp));
  }

  if (user_langs) {
    langs = langs.concat(user_langs);
  }
  if (!langs.includes('eng')) langs.push('eng');
  if (!langs.includes('und')) langs.push('und');

  response.infoLog += 'Keeping languages: ';
  // Print languages to UI
  langs.forEach((l) => {
    response.infoLog += `${languages.getName(l, 'en')}, `;
  });

  response.infoLog = `${response.infoLog.slice(0, -2)}\n`;

  for (let i = 0; i < file.ffProbeData.streams.length; i += 1) {
    const stream = file.ffProbeData.streams[i];

    if (stream.codec_type === 'audio') {
      if (!stream.tags) {
        response.infoLog += `☒No tags found on audio track ${streamIndex}. Keeping it. \n`;
        tracks.keep.push(streamIndex);
        streamIndex += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      if (stream.tags.language) {
        if (langs.includes(stream.tags.language)) {
          tracks.keep.push(streamIndex);
        } else {
          tracks.remove.push(streamIndex);
          response.preset += `-map -0:a:${streamIndex} `;
          tracks.remLangs += `${languages.getName(stream.tags.language, 'en')}, `;
        }
        streamIndex += 1;
      } else {
        response.infoLog += `☒No language tag found on audio track ${streamIndex}. Keeping it. \n`;
      }
    }
  }
  response.preset += ' -c copy -max_muxing_queue_size 9999';
  return tracks;
};

const tmdbApi = async (filename, api_key, axios) => {
  let fileName;
  // If filename begins with tt, it's already an imdb id
  if (filename) {
    if (filename.substr(0, 2) === 'tt') {
      fileName = filename;
    } else {
      const idRegex = /\[imdb-(tt\d*)]/;
      const fileMatch = filename.match(idRegex);
      // eslint-disable-next-line prefer-destructuring
      if (fileMatch) fileName = fileMatch[1];
    }
  }

  if (fileName) {
    const result = await axios.get(`https://api.themoviedb.org/3/find/${fileName}?api_key=`
      + `${api_key}&language=en-US&external_source=imdb_id`)
      .then((resp) => (resp.data.movie_results.length > 0 ? resp.data.movie_results[0] : resp.data.tv_results[0]));

    if (!result) {
      response.infoLog += '☒No IMDB result was found. \n';
    }
    return result;
  }
  return null;
};

// eslint-disable-next-line consistent-return
const parseArrResponse = async (body, filePath, arr) => {
  // eslint-disable-next-line default-case
  switch (arr) {
    case 'radarr':
      // filePath = file
      for (let i = 0; i < body.length; i += 1) {
        if (body[i].movieFile) {
          if (body[i].movieFile.relativePath) {
            if (body[i].movieFile.relativePath === filePath) {
              return body[i];
            }
          }
        }
      }
      break;
    case 'sonarr':
      // filePath = directory the file is in
      // eslint-disable-next-line global-require,import/no-unresolved
      const path = require('path');
      for (let i = 0; i < body.length; i += 1) {
        if (body[i].path) {
          if (path.basename(body[i].path) === path.basename(path.dirname(filePath))) {
            return body[i];
          }
        }
      }
  }
};

const plugin = async (file, librarySettings, inputs) => {
  // eslint-disable-next-line global-require,import/no-unresolved
  const axios = require('axios').default;
  response.container = `.${file.container}`;
  let prio = ['radarr', 'sonarr'];
  let radarrResult = null;
  let sonarrResult = null;
  let tmdbResult = null;

  if (inputs.priority) {
    if (inputs.priority === 'sonarr') {
      prio = ['sonarr', 'radarr'];
    }
  }

  for (let i = 0; i < prio.length; i += 1) {
    let imdbId;
    // eslint-disable-next-line default-case
    switch (prio[i]) {
      case 'radarr':
        if (tmdbResult) break;
        if (inputs.radarr_api_key) {
          radarrResult = await parseArrResponse(
            await axios.get(`http://${inputs.radarr_url}/api/v3/movie?apiKey=${inputs.radarr_api_key}`)
              .then((resp) => resp.data),
            file.meta.FileName, 'radarr',
          );

          if (radarrResult) {
            imdbId = radarrResult.imdbId;
            response.infoLog += `Grabbed ID (${imdbId}) from Radarr \n`;
          } else {
            response.infoLog += 'Couldn\'t grab ID from Radarr/Sonarr, grabbing it from file name \n';
            imdbId = file.meta.FileName;
          }
          tmdbResult = await tmdbApi(imdbId, inputs.api_key, axios);
        }
        break;
      case 'sonarr':
        if (tmdbResult) break;
        if (inputs.sonarr_api_key) {
          sonarrResult = await parseArrResponse(
            await axios.get(`http://${inputs.sonarr_url}/api/series?apikey=${inputs.sonarr_api_key}`)
              .then((resp) => resp.data),
            file.meta.Directory, 'sonarr',
          );

          if (sonarrResult) {
            imdbId = sonarrResult.imdbId;
            response.infoLog += `Grabbed ID (${imdbId}) from Sonarr \n`;
          } else {
            response.infoLog += 'Couldn\'t grab ID from Radarr/Sonarr, grabbing it from file name \n';
            imdbId = file.meta.FileName;
          }
          tmdbResult = await tmdbApi(imdbId, inputs.api_key, axios);
        }
    }
  }

  if (tmdbResult) {
    const tracks = processStreams(tmdbResult, file, inputs.user_langs ? inputs.user_langs.split(',') : '');

    if (tracks.remove.length > 0) {
      if (tracks.keep.length > 0) {
        response.infoLog += `☑Removing tracks with languages: ${tracks.remLangs.slice(0, -2)}. \n`;
        response.processFile = true;
        response.infoLog += '\n';
      } else {
        response.infoLog += '☒Cancelling plugin otherwise all audio tracks would be removed. \n';
      }
    } else {
      response.infoLog += '☒No audio tracks to be removed. \n';
    }
  } else {
    response.infoLog += '☒Couldn\'t find the IMDB id of this file. Skipping. \n';
  }
  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;