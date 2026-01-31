const icalGenerator = require('ical-generator');
const ical = typeof icalGenerator === 'function' ? icalGenerator : icalGenerator.default;

const registry = require('./feeds-registry.json');

/**
 * Proxy an external .ics URL: fetch and return as-is.
 */
async function fetchUrlIcs(source) {
  const url = source?.url;
  if (!url || typeof url !== 'string') return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Calendar-Sync/1.0' } });
    if (!res.ok) return null;
    return await res.text();
  } catch (_) {
    return null;
  }
}

/**
 * Get events for static or api feeds. Add your own feed logic here when you add registry entries.
 * Returns empty array for unknown feeds; implement per feedId/type as needed.
 */
async function getEventsForFeed(feedId, type, source) {
  if (type === 'static') {
    // Add static feed handlers here, e.g. if (feedId === 'my-feed') return getMyFeedEvents();
    return [];
  }
  if (type === 'api') {
    // Add api providers here, e.g. if (source?.provider === 'my-api') return getMyApiEvents(source);
    return [];
  }
  return [];
}

function buildIcs(feedId, name, events) {
  const cal = ical({
    name: name || feedId,
    description: `Calendar feed: ${name || feedId}`,
  });
  events.forEach((ev) => {
    cal.createEvent({
      start: ev.start,
      end: ev.end,
      summary: ev.summary,
      description: ev.description || '',
      location: ev.location || '',
    });
  });
  return cal.toString();
}

exports.handler = async (event) => {
  const path = event.path || '';
  const feedFromPath = path.replace(/^\/cal\/?/, '').replace(/\.ics$/, '').trim();
  const feedId = event.queryStringParameters?.feed || feedFromPath || '';

  const entry = registry.find((e) => e.id === feedId);
  const name = entry ? entry.name : feedId;
  const type = entry ? entry.type : 'static';
  const source = entry?.source ?? null;

  if (type === 'url') {
    const icsBody = await fetchUrlIcs(source);
    if (icsBody) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
        body: icsBody,
      };
    }
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'text/plain' },
      body: 'Failed to fetch calendar',
    };
  }

  const events = await getEventsForFeed(feedId, type, source);
  const icsBody = buildIcs(feedId, name, events);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
    body: icsBody,
  };
};
