<script setup>
import { ref, computed, onMounted } from 'vue'

const version = '0.1.0'
const githubRepoUrl = 'https://github.com/ilurr/calendar-feed-manager'
const feeds = ref([])
const loading = ref(true)

onMounted(async () => {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${base}/.netlify/functions/feeds`)
    if (res.ok) feeds.value = await res.json()
    else feeds.value = [
      { id: 'football', name: 'Serie A', type: 'static' },
      { id: 'fasting', name: 'Fasting times', type: 'static' },
    ]
  } catch (_) {
    feeds.value = [
      { id: 'football', name: 'Serie A', type: 'static' },
      { id: 'fasting', name: 'Fasting times', type: 'static' },
    ]
  } finally {
    loading.value = false
  }
})

const categoryLabels = {
  religion: 'Religion',
  football: 'Football',
  other: 'Other',
}

const categoryTeasers = {
  religion: 'Fasting days (Ayyamul Bidh), prayer times, and other Islamic calendar feeds.',
  football: 'Club fixtures and match schedules. Subscribe to get games in your calendar.',
  other: 'Other calendar feeds.',
}

const visibleFeeds = computed(() => feeds.value)

const feedsByCategory = computed(() => {
  const map = {}
  for (const feed of feeds.value) {
    const cat = feed.category || 'other'
    if (!map[cat]) map[cat] = []
    map[cat].push(feed)
  }
  const order = ['religion', 'football', 'other']
  return order.filter((c) => map[c]?.length).map((c) => ({
    id: c,
    label: categoryLabels[c] || c,
    teaser: categoryTeasers[c] || '',
    feeds: map[c],
  }))
})

function subscribeUrl(feedId) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/cal/${feedId}.ics`
}

function webcalUrl(feedId) {
  if (typeof window === 'undefined') return subscribeUrl(feedId)
  const protocol = window.location.protocol === 'https:' ? 'webcal:' : 'webcal:'
  return `${protocol}//${window.location.host}/cal/${feedId}.ics`
}

function copyUrl(feedId) {
  const url = subscribeUrl(feedId)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      copyFeedback.value = feedId
      setTimeout(() => { copyFeedback.value = null }, 2000)
    })
  }
}

const copyFeedback = ref(null)
const refreshFeedback = ref(null)

async function refreshFeed(feedId) {
  refreshFeedback.value = feedId
  try {
    const url = subscribeUrl(feedId) + '?refresh=1'
    const res = await fetch(url)
    refreshFeedback.value = res.ok ? `ok:${feedId}` : `err:${feedId}`
  } catch {
    refreshFeedback.value = `err:${feedId}`
  }
  setTimeout(() => { refreshFeedback.value = null }, 3000)
}
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow-sm border-b border-gray-200">
      <div class="max-w-4xl mx-auto px-4 py-6">
        <div class="flex items-center gap-2 flex-wrap">
        <h1 class="text-2xl font-semibold text-gray-900 tracking-tight">Subs Calendar</h1>
        <span class="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
          Beta {{ version }}
        </span>
        </div>
        <p class="mt-1 text-sm text-gray-600 max-w-xl">
          Add feeds to your calendar.
        </p>
      </div>
    </header>
    <main class="max-w-4xl mx-auto px-4 py-8">
      <p v-if="loading" class="text-gray-500">Loading feeds…</p>
      <template v-else>
        <section
          v-for="group in feedsByCategory"
          :key="group.id"
          class="mb-8"
        >
          <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
            {{ group.label }}
          </h3>
          <p v-if="group.teaser" class="text-sm text-gray-500 mb-3">
            {{ group.teaser }}
          </p>
          <ul class="space-y-4">
            <li
              v-for="feed in group.feeds"
              :key="feed.id"
              class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-3"
            >
              <div class="min-w-0 flex-1">
                <span class="font-medium text-gray-800">{{ feed.name }}</span>
                <p v-if="feed.teaser" class="text-sm text-gray-500 mt-0.5">{{ feed.teaser }}</p>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <a
                  :href="webcalUrl(feed.id)"
                  class="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
                >
                  Add to Calendar
                </a>
                <button
                  type="button"
                  class="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-sm hover:bg-gray-50"
                  @click="copyUrl(feed.id)"
                >
                  {{ copyFeedback === feed.id ? 'Copied!' : 'Copy URL' }}
                </button>
                <button
                  type="button"
                  class="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-60"
                  :disabled="refreshFeedback === feed.id"
                  @click="refreshFeed(feed.id)"
                  title="Re-crawl the source. Your calendar app syncs periodically; to get updates immediately, remove and re-add this calendar."
                >
                  {{ refreshFeedback === feed.id ? 'Checking…' : refreshFeedback === `ok:${feed.id}` ? 'Refreshed!' : refreshFeedback === `err:${feed.id}` ? 'Error' : 'Refresh' }}
                </button>
              </div>
            </li>
          </ul>
        </section>
      </template>
      <p v-if="!loading && visibleFeeds.length === 0" class="text-gray-500 mt-4">
        No calendars in your list. Add feeds in the registry.
      </p>
      <p class="text-sm text-gray-500 mt-6">
        Subscribe using &quot;Add to Calendar&quot; or copy the URL and add it in iOS/Mac Calendar. Use &quot;Refresh&quot; to re-crawl the source; your calendar app will pick up changes on its next sync (usually within a few hours). To unsubscribe, remove the calendar in the Calendar app.
      </p>

      <footer class="mt-16 pt-8 pb-6 border-t border-gray-200 text-center text-sm text-gray-500">
        <p class="mb-2">
          Subs Calendar <span class="text-gray-400">·</span> Beta {{ version }}
        </p>
        <a
          v-if="githubRepoUrl"
          :href="githubRepoUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900"
          aria-label="View on GitHub"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" />
          </svg>
          View on GitHub
        </a>
      </footer>
    </main>
  </div>
</template>
