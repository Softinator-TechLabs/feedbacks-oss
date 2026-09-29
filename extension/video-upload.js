// XHR's upload events report bytes sent by Chrome. The server response is a
// separate confirmation: reaching 100% on the wire is not a completed upload.
export function uploadVideoWithProgress({
  server,
  token,
  input,
  onProgress = () => {},
  xhrFactory = () => new XMLHttpRequest(),
}) {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const report = (phase, percent) => onProgress({ phase, percent });
    xhr.open("POST", `${server}/api/assets.uploadVideo`);
    xhr.timeout = 180000;
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      const percent = Math.min(
        100,
        Math.max(0, Math.round((event.loaded / event.total) * 100)),
      );
      report(percent === 100 ? "confirming" : "uploading", percent);
    };
    xhr.onload = () => {
      let result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        fail(
          Error(
            `Feedbacks server returned HTTP ${xhr.status} without a valid API response.`,
          ),
        );
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !result.ok) {
        fail(
          Object.assign(Error(result.error?.message || `Server returned ${xhr.status}`), {
            code: result.error?.code,
            status: xhr.status,
          }),
        );
        return;
      }
      if (settled) return;
      settled = true;
      report("complete", 100);
      resolve(result.data);
    };
    xhr.onerror = () => fail(Error("Video upload connection failed. Retry Send video."));
    xhr.ontimeout = () => fail(Error("Video upload timed out. Retry Send video."));
    xhr.onabort = () => fail(Error("Video upload was cancelled. Retry Send video."));
    report("uploading", 0);
    xhr.send(JSON.stringify(input));
  });
}
