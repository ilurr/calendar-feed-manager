<script setup>
import { ref, computed, onMounted } from 'vue'

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

const visibleFeeds = computed(() => feeds.value)

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
    <header class="bg-white shadow-sm">
      <div class="max-w-4xl mx-auto px-4 py-4">
        <h1 class="text-xl font-semibold text-gray-800">Calendar Sync</h1>
      </div>
    </header>
    <main class="max-w-4xl mx-auto px-4 py-8">
      <h2 class="text-lg font-medium text-gray-800 mb-4">My calendars</h2>
      <p v-if="loading" class="text-gray-500">Loading feeds…</p>
      <ul v-else class="space-y-4">
        <li
          v-for="feed in visibleFeeds"
          :key="feed.id"
          class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-3"
        >
          <span class="font-medium text-gray-800">{{ feed.name }}</span>
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
      <p v-if="!loading && visibleFeeds.length === 0" class="text-gray-500 mt-4">
        No calendars in your list. Add feeds in the registry.
      </p>
      <p class="text-sm text-gray-500 mt-6">
        Subscribe using &quot;Add to Calendar&quot; or copy the URL and add it in iOS/Mac Calendar. Use &quot;Refresh&quot; to re-crawl the source; your calendar app will pick up changes on its next sync (usually within a few hours). To unsubscribe, remove the calendar in the Calendar app.
      </p>
    </main>
  </div>
</template>
