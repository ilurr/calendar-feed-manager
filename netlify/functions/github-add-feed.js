/**
 * Netlify Function: add a feed entry via GitHub API.
 * Creates a branch, updates feeds-registry.json, opens a PR.
 * Requires: GITHUB_TOKEN (repo scope), REPOSITORY_URL (e.g. https://github.com/owner/repo.git)
 */

const REGISTRY_PATH = 'netlify/functions/feeds-registry.json';

function parseRepo(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') return null;
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, '') } : null;
}

async function githubApi(path, token, { method = 'GET', body } = {}) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const opts = {
    method,
    headers: {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = res.ok ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const err = data?.message || res.statusText || `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const token = process.env.GITHUB_TOKEN;
  const repoUrl = process.env.REPOSITORY_URL || process.env.GITHUB_REPO_URL;
  if (!token || !repoUrl) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Server misconfigured: set GITHUB_TOKEN and REPOSITORY_URL in Netlify env',
      }),
    };
  }

  const repo = parseRepo(repoUrl);
  if (!repo) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Invalid REPOSITORY_URL (expected GitHub owner/repo)' }),
    };
  }

  let payload;
  try {
    payload = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (_) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { id, name, type, source } = payload;
  if (!id || typeof id !== 'string' || !name || typeof name !== 'string' || !type) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing or invalid: id, name, type' }),
    };
  }

  const entry = {
    id: id.trim().replace(/\s+/g, '-').toLowerCase(),
    name: name.trim(),
    type: type === 'url' ? 'url' : type === 'api' ? 'api' : 'scrape',
    source: source && typeof source === 'object' ? source : {},
  };

  if (entry.type === 'url' && (!entry.source.url || typeof entry.source.url !== 'string')) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'type "url" requires source.url' }),
    };
  }
  if (entry.type === 'scrape' && (!entry.source.url || typeof entry.source.url !== 'string')) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'type "scrape" requires source.url' }),
    };
  }

  const { owner, repo: repoName } = repo;
  const basePath = `/repos/${owner}/${repoName}`;

  try {
    const repoInfo = await githubApi(`${basePath}`, token);
    const defaultBranch = repoInfo.default_branch || 'main';

    const fileRes = await githubApi(
      `${basePath}/contents/${REGISTRY_PATH}?ref=${defaultBranch}`,
      token
    );
    const currentContent = Buffer.from(fileRes.content, 'base64').toString('utf8');
    let registry;
    try {
      registry = JSON.parse(currentContent);
    } catch (_) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Registry file is not valid JSON' }),
      };
    }
    if (!Array.isArray(registry)) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Registry must be a JSON array' }),
      };
    }
    if (registry.some((e) => e.id === entry.id)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Feed id "${entry.id}" already exists` }),
      };
    }

    registry.push(entry);
    const newContent = JSON.stringify(registry, null, 2);
    const branchName = `add-feed-${entry.id}-${Date.now().toString(36)}`;

    const refRes = await githubApi(`${basePath}/git/refs/heads/${defaultBranch}`, token);
    await githubApi(`${basePath}/git/refs`, token, {
      method: 'POST',
      body: { ref: `refs/heads/${branchName}`, sha: refRes.object.sha },
    });

    await githubApi(`${basePath}/contents/${REGISTRY_PATH}`, token, {
      method: 'PUT',
      body: {
        message: `Add feed: ${entry.name} (${entry.id})`,
        content: Buffer.from(newContent, 'utf8').toString('base64'),
        sha: fileRes.sha,
        branch: branchName,
      },
    });

    const pr = await githubApi(`${basePath}/pulls`, token, {
      method: 'POST',
      body: {
        title: `Add feed: ${entry.name}`,
        head: branchName,
        base: defaultBranch,
        body: `Adds calendar feed **${entry.name}** (\`${entry.id}\`) to the registry. Merge to publish.`,
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        pr_url: pr.html_url,
        pr_number: pr.number,
        message: 'Pull request created. Merge it to add the feed.',
      }),
    };
  } catch (err) {
    const message = err?.message || String(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: message, ok: false }),
    };
  }
};
