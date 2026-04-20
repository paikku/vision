/* eslint-disable no-restricted-globals */
self.onmessage = async (event) => {
  const { file, duration, maxFrames } = event.data || {};

  if (!file) {
    self.postMessage({ ok: false, reason: "missing-file" });
    return;
  }

  try {
    if (typeof self.MP4Box === "undefined") {
      self.importScripts("https://cdn.jsdelivr.net/npm/mp4box@0.5.4/dist/mp4box.all.min.js");
    }

    if (typeof self.MP4Box === "undefined") {
      self.postMessage({ ok: false, reason: "mp4box-unavailable" });
      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const mp4file = self.MP4Box.createFile();

    const times = await new Promise((resolve, reject) => {
      let done = false;
      const keyframes = [];

      const finish = () => {
        if (done) return;
        done = true;
        try {
          mp4file.stop();
        } catch {}
        resolve(keyframes);
      };

      mp4file.onError = (err) => reject(err || new Error("mp4box parse failed"));

      mp4file.onReady = (info) => {
        const track = (info.videoTracks || [])[0];
        if (!track) {
          finish();
          return;
        }
        mp4file.setExtractionOptions(track.id, null, { nbSamples: 100000 });
        mp4file.start();
      };

      mp4file.onSamples = (_trackId, _user, samples) => {
        for (const sample of samples || []) {
          if (sample.is_sync) {
            const scale = sample.timescale || 1;
            keyframes.push(sample.cts / scale);
            if (keyframes.length >= maxFrames * 4) {
              finish();
              return;
            }
          }
        }
      };

      const buf = arrayBuffer;
      buf.fileStart = 0;
      mp4file.appendBuffer(buf);
      mp4file.flush();
      setTimeout(finish, 1500);
    });

    const bounded = (times || []).filter((t) => Number.isFinite(t) && t >= 0 && t <= duration);
    self.postMessage({ ok: true, times: bounded });
  } catch (_err) {
    self.postMessage({ ok: false, reason: "worker-failure" });
  }
};
