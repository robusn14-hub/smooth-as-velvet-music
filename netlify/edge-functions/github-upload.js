// Server-side helper for the licensing catalog uploader.
// Keeps the GitHub token on the server only — bulk-upload.html never
// needs a token pasted into it. Runs as a Netlify Edge Function so it
// can handle audio-file-sized requests without the smaller payload
// limit that applies to classic serverless functions.

const REPO = 'robusn14-hub/smooth-as-velvet-music';
const BRANCH = 'main';
const API = 'https://api.github.com';
// Generous ceiling on the base64 text we'll accept for one file (comfortably
// covers a 15MB mp3 once base64-encoded, plus JSON overhead).
const MAX_CONTENT_CHARS = 22 * 1024 * 1024;

function isAllowedPath(path) {
  if (path === 'tracks.json') return true;
  if (/^tracks\/[^\/]+\.mp3$/i.test(path)) return true;
  if (/^assets\/[^\/]+\.(jpg|jpeg|png|webp|svg)$/i.test(path)) return true;
  return false;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export default async (request, context) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const token = Netlify.env.get('GITHUB_UPLOAD_TOKEN');
  if (!token) {
    return json({ error: 'The server is not configured with an upload token yet. Ask Reese to finish setup.' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const action = payload && payload.action;
  const path = String((payload && payload.path) || '');

  if (!isAllowedPath(path)) {
    return json({ error: 'This file path is not allowed.' }, 403);
  }

  const ghHeaders = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');

  try {
    if (action === 'get') {
      const r = await fetch(API + '/repos/' + REPO + '/contents/' + encodedPath + '?ref=' + BRANCH, {
        headers: ghHeaders
      });
      if (r.status === 404) {
        return json({ exists: false });
      }
      if (!r.ok) {
        const errBody = await r.json().catch(function () { return {}; });
        return json({ error: errBody.message || ('GitHub error ' + r.status) }, r.status);
      }
      const info = await r.json();
      const result = { exists: true, sha: info.sha };
      // Only tracks.json needs its content read back by the browser (to
      // merge new tracks into the catalog list). Audio files never need
      // to round-trip their bytes back to the client.
      if (path === 'tracks.json' && info.content) result.content = info.content;
      return json(result);
    }

    if (action === 'put') {
      const content = payload.content;
      if (!content || typeof content !== 'string') {
        return json({ error: 'Missing file content.' }, 400);
      }
      if (content.length > MAX_CONTENT_CHARS) {
        return json({ error: 'File is too large.' }, 413);
      }
      const message = String(payload.message || ('Update ' + path)).slice(0, 200);
      const body = { message: message, content: content, branch: BRANCH };
      if (payload.sha) body.sha = String(payload.sha);

      const r = await fetch(API + '/repos/' + REPO + '/contents/' + encodedPath, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify(body)
      });
      const respBody = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        return json({ error: respBody.message || ('GitHub error ' + r.status) }, r.status);
      }
      return json({ ok: true, sha: respBody.content ? respBody.content.sha : null });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    return json({ error: 'Upstream error: ' + (err && err.message ? err.message : String(err)) }, 502);
  }
};

export const config = { path: '/api/github-upload' };
