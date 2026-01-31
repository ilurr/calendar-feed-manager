<script setup>
import { ref, computed, onMounted } from 'vue'

const STORAGE_KEY = 'calendar-sync-hidden'

const feeds = ref([])
const loading = ref(true)
const hiddenIds = ref([])

onMounted(async () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) hiddenIds.value = JSON.parse(raw)
  } catch (_) {
    hiddenIds.value = []
  }
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

const visibleFeeds = computed(() =>
  feeds.value.filter((f) => !hiddenIds.value.includes(f.id))
)

function subscribeUrl(feedId) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/cal/${feedId}.ics`
}

function webcalUrl(feedId) {
  if (typeof window === 'undefined') return subscribeUrl(feedId)
  const protocol = window.location.protocol === 'https:' ? 'webcal:' : 'webcal:'
  return `${protocol}//${window.location.host}/cal/${feedId}.ics`
}

function removeFeed(feedId) {
  if (!hiddenIds.value.includes(feedId)) {
    hiddenIds.value = [...hiddenIds.value, feedId]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hiddenIds.value))
  }
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
const showAdmin = ref(false)
const newFeed = ref({
  id: '',
  name: '',
  type: 'url',
  sourceUrl: '',
})
const generatedJson = ref('')

function generateFeedJson() {
  const { id, name, type, sourceUrl } = newFeed.value
  if (!id.trim() || !name.trim()) {
    generatedJson.value = ''
    return
  }
  if (type === 'url' && sourceUrl.trim()) {
    generatedJson.value = JSON.stringify(
      { id: id.trim(), name: name.trim(), type: 'url', source: { url: sourceUrl.trim() } },
      null,
      2
    )
    return
  }
  if (type === 'static') {
    generatedJson.value = JSON.stringify(
      { id: id.trim(), name: name.trim(), type: 'static', source: null },
      null,
      2
    )
    return
  }
  generatedJson.value = JSON.stringify(
    { id: id.trim(), name: name.trim(), type, source: sourceUrl.trim() ? { url: sourceUrl.trim() } : null },
    null,
    2
  )
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
              class="inline-flex items-center px-3 py-1.5 rounded-md border border-red-200 text-red-700 text-sm hover:bg-red-50"
              @click="removeFeed(feed.id)"
            >
              Remove from list
            </button>
          </div>
        </li>
      </ul>
      <p v-if="!loading && visibleFeeds.length === 0" class="text-gray-500 mt-4">
        No calendars in your list. Remove the filter or add feeds in the registry.
      </p>
      <p class="text-sm text-gray-500 mt-6">
        Subscribe using &quot;Add to Calendar&quot; or copy the URL and add it in iOS/Mac Calendar. To unsubscribe, remove the calendar in the Calendar app.
      </p>

      <section class="mt-10 pt-8 border-t border-gray-200">
        <button
          type="button"
          class="text-sm text-gray-600 hover:text-gray-800"
          @click="showAdmin = !showAdmin"
        >
          {{ showAdmin ? 'Hide' : 'Add feed (admin)' }}
        </button>
        <div v-if="showAdmin" class="mt-4 bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <p class="text-sm text-gray-600">
            Add an entry to <code class="bg-gray-100 px-1 rounded">netlify/functions/feeds-registry.json</code> in the repo. Use this form to generate the JSON.
          </p>
          <div class="grid gap-3 max-w-md">
            <label class="block text-sm font-medium text-gray-700">
              ID (slug, e.g. <code>my-calendar</code>)
              <input
                v-model="newFeed.id"
                type="text"
                class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                @input="generateFeedJson"
              />
            </label>
            <label class="block text-sm font-medium text-gray-700">
              Name
              <input
                v-model="newFeed.name"
                type="text"
                class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                @input="generateFeedJson"
              />
            </label>
            <label class="block text-sm font-medium text-gray-700">
              Type
              <select
                v-model="newFeed.type"
                class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                @change="generateFeedJson"
              >
                <option value="static">static</option>
                <option value="url">url (proxy .ics)</option>
                <option value="api">api</option>
              </select>
            </label>
            <label v-if="newFeed.type === 'url'" class="block text-sm font-medium text-gray-700">
              Source URL (.ics)
              <input
                v-model="newFeed.sourceUrl"
                type="url"
                class="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                placeholder="https://..."
                @input="generateFeedJson"
              />
            </label>
          </div>
          <div v-if="generatedJson" class="mt-2">
            <p class="text-xs font-medium text-gray-500 mb-1">Paste this into feeds-registry.json:</p>
            <pre class="bg-gray-100 rounded p-3 text-xs overflow-x-auto">{{ generatedJson }}</pre>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
