import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface HistoryMessage {
  role: 'user' | 'model';
  text: string;
}

interface GroundingSource {
  title: string;
  uri: string;
}

interface EmbeddedMediaItem {
  id: string;
  type: 'image' | 'video';
  title: string;
  url: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  sourceName?: string;
  sourceUrl?: string;
  mimeType?: string;
}

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  95: 'Thunderstorm',
};

const CITY_TIMEZONES: Record<string, string> = {
  london: 'Europe/London',
  tokyo: 'Asia/Tokyo',
  singapore: 'Asia/Singapore',
  seoul: 'Asia/Seoul',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  sydney: 'Australia/Sydney',
  dubai: 'Asia/Dubai',
  'hong kong': 'Asia/Hong_Kong',
  beijing: 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai',
  toronto: 'America/Toronto',
  chicago: 'America/Chicago',
};

async function fetchJsonWithTimeout<T>(url: string, ms = 4500): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; buh-lookup/1.0)' },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, ms = 4500): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+cb',
      },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function cleanCommonsTitle(fileTitle: string): string {
  return fileTitle
    .replace(/^File:/i, '')
    .replace(/\.(jpe?g|png|webp|gif|webm|mp4|ogv)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMediaFromText(text: string): EmbeddedMediaItem[] {
  const found: EmbeddedMediaItem[] = [];
  const seen = new Set<string>();
  const push = (item: EmbeddedMediaItem) => {
    const key = item.embedUrl || item.url;
    if (!key || seen.has(key)) return;
    if (!isSafeHttpUrl(item.url)) return;
    if (item.embedUrl && !isSafeHttpUrl(item.embedUrl)) return;
    seen.add(key);
    found.push(item);
  };

  // Markdown images: ![alt](https://...)
  for (const m of text.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi)) {
    const alt = m[1]?.trim() || 'Embedded image';
    const url = m[2];
    push({
      id: `md-img-${found.length}-${url.slice(-12)}`,
      type: 'image',
      title: alt,
      url,
      thumbnailUrl: url,
      sourceName: 'Web image',
      sourceUrl: url,
    });
  }

  // YouTube links
  for (const m of text.matchAll(
    /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi
  )) {
    const vid = m[1];
    push({
      id: `yt-${vid}`,
      type: 'video',
      title: 'YouTube video',
      url: `https://www.youtube.com/watch?v=${vid}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0`,
      thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
      sourceName: 'YouTube',
      sourceUrl: `https://www.youtube.com/watch?v=${vid}`,
    });
  }

  // Vimeo links
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})/gi)) {
    const vid = m[1];
    push({
      id: `vimeo-${vid}`,
      type: 'video',
      title: 'Vimeo video',
      url: `https://vimeo.com/${vid}`,
      embedUrl: `https://player.vimeo.com/video/${vid}?autoplay=1`,
      sourceName: 'Vimeo',
      sourceUrl: `https://vimeo.com/${vid}`,
    });
  }

  // Direct video URLs (.mp4, .webm)
  for (const m of text.matchAll(/https?:\/\/[^\s)"'<>]+\.(?:mp4|webm)(?:\?[^\s)"'<>]*)?/gi)) {
    const url = m[0];
    push({
      id: `vid-${found.length}-${url.slice(-12)}`,
      type: 'video',
      title: 'Embedded video',
      url,
      sourceName: 'Direct video',
      sourceUrl: url,
      mimeType: url.toLowerCase().includes('.webm') ? 'video/webm' : 'video/mp4',
    });
  }

  // Direct image URLs (.jpg, .jpeg, .png, .webp, .gif)
  for (const m of text.matchAll(/https?:\/\/[^\s)"'<>]+\.(?:jpe?g|png|webp|gif)(?:\?[^\s)"'<>]*)?/gi)) {
    const url = m[0];
    push({
      id: `img-${found.length}-${url.slice(-12)}`,
      type: 'image',
      title: 'Embedded image',
      url,
      thumbnailUrl: url,
      sourceName: 'Web image',
      sourceUrl: url,
    });
  }

  return found;
}

const FOLLOW_UP_ANAPHORA_REGEX =
  /\b(it|its|they|them|their|that|this|there|those|these|same|above|earlier|previous|before|one|ones)\b/i;

function stripVisualFiller(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(
      /\b(show|me|find|get|search|look up|lookup|give|send|display|embed|embedded|some|an?|the|and|or|of|for|about|please|can|could|would|you|i|see|want|need|what|is|are|was|were|today'?s?|today|right now|current|currently|any|more|another|also|here|images?|photos?|pictures?|pics?|videos?|clips?|watch|youtube|vimeo|trailer|review|hands[- ]?on|tutorial|how to|demo|vlog|walking|tour|weather|forecast|temperature|temp|exchange rate|rate|time|clock|specs?|specifications?|it|its|they|them|their|that|this|there|those|these|same|above|earlier|previous|before|one|ones)\b/gi,
      ' '
    )
    .replace(/[?.,!()"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLatestTopicFromHistory(history: HistoryMessage[]): string {
  const userTurns = history.filter((m) => m.role === 'user').map((m) => m.text.trim());
  for (let i = userTurns.length - 1; i >= 0; i--) {
    const subject = stripVisualFiller(userTurns[i]);
    if (subject.length >= 2) {
      return subject.slice(0, 100);
    }
  }
  return '';
}

function buildVisualSearchQuery(prompt: string, history: HistoryMessage[]): string {
  const ownSubject = stripVisualFiller(prompt);
  const hasAnaphora = FOLLOW_UP_ANAPHORA_REGEX.test(prompt);

  if (ownSubject.length >= 2 && !hasAnaphora) {
    return ownSubject.slice(0, 100);
  }

  const latestTopic = extractLatestTopicFromHistory(history);
  if (ownSubject.length >= 2 && hasAnaphora && latestTopic) {
    return `${latestTopic} ${ownSubject}`.slice(0, 100);
  }
  if (ownSubject.length >= 2) {
    return ownSubject.slice(0, 100);
  }
  if (latestTopic) {
    return latestTopic.slice(0, 100);
  }

  return prompt
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[?.,!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function buildVideoSearchQuery(prompt: string, history: HistoryMessage[], visualQuery: string): string {
  const ownSubject = stripVisualFiller(prompt);
  const hasAnaphora = FOLLOW_UP_ANAPHORA_REGEX.test(prompt);
  const cleanedPromptForVideo = prompt
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(
      /\b(show me|give me|find me|send me|can you|could you|please|embed|embedded|display|watch|some|any|a|an|the|of it|about it|for it|of that|about that|of this|about this)\b/gi,
      ' '
    )
    .replace(/[?.,!()"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If the current prompt clearly names its own subject (no pronoun back-reference), search strictly for it
  if (ownSubject.length >= 2 && !hasAnaphora) {
    return (cleanedPromptForVideo || ownSubject).slice(0, 100);
  }

  // Genuine follow-up (e.g. "show me a video of it", "any tutorial videos?") -> anchor to resolved visualQuery
  const videoModifiers = prompt.match(
    /\b(trailer|review|hands[- ]?on|tutorial|how to|demo|vlog|walking tour|tour|highlights?|unboxing|4k|live)\b/gi
  );
  const modText = videoModifiers ? Array.from(new Set(videoModifiers.map((m) => m.toLowerCase()))).join(' ') : '';
  return `${visualQuery}${modText ? ` ${modText}` : ''}`.trim().slice(0, 100);
}

async function fetchEmbeddedMedia(
  prompt: string,
  history: HistoryMessage[],
  extraTexts: string[] = []
): Promise<EmbeddedMediaItem[]> {
  const directMedia: EmbeddedMediaItem[] = [];
  for (const txt of [prompt, ...extraTexts]) {
    directMedia.push(...extractMediaFromText(txt));
  }

  const wantsVideos = /\b(video|videos|clip|clips|watch|youtube|trailer|review|hands[- ]?on|tutorial|how to|demo|vlog|tour)\b/i.test(
    prompt
  );
  const wantsImages = /\b(image|images|photo|photos|picture|pictures|pic|pics|look like|looks like|visual|diagram|gallery|wallpapers?)\b/i.test(
    prompt
  );
  const isPureArithmetic = /^[\d\s+\-*/()=.,?]+$/.test(prompt.trim());
  const isPureMetaRecap =
    !wantsImages &&
    !wantsVideos &&
    /\b(what did we|earlier in this chat|remind me what|summarize our chat|previous message)\b/i.test(prompt);

  if (isPureArithmetic || isPureMetaRecap) {
    return directMedia.slice(0, 5);
  }

  const visualQuery = buildVisualSearchQuery(prompt, history);
  if (!visualQuery || visualQuery.length < 2) {
    return directMedia.slice(0, 5);
  }

  const fetchedImages: EmbeddedMediaItem[] = [];
  const fetchedVideos: EmbeddedMediaItem[] = [];
  const seenUrls = new Set<string>(directMedia.map((m) => m.embedUrl || m.url));

  const addImage = (item: EmbeddedMediaItem) => {
    const key = item.url;
    if (!key || seenUrls.has(key) || !isSafeHttpUrl(key)) return;
    seenUrls.add(key);
    fetchedImages.push(item);
  };

  const addVideo = (item: EmbeddedMediaItem) => {
    const key = item.embedUrl || item.url;
    if (!key || seenUrls.has(key) || !isSafeHttpUrl(item.url)) return;
    if (item.embedUrl && !isSafeHttpUrl(item.embedUrl)) return;
    seenUrls.add(key);
    fetchedVideos.push(item);
  };

  const isCurrencyOnly =
    !wantsImages &&
    !wantsVideos &&
    /\b(exchange rate|convert|fx|currency)\b/i.test(prompt) &&
    !/\b(city|country|phone|device|watch|photo|video)\b/i.test(prompt);

  const tasks: Promise<void>[] = [];

  if (!isCurrencyOnly) {
    // 1. Wikipedia page thumbnail / original image for top match
    tasks.push(
      (async () => {
        const searchData = await fetchJsonWithTimeout<{
          query?: { search?: { title: string }[] };
        }>(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
            visualQuery
          )}&format=json&srlimit=2`,
          3800
        );
        const hits = searchData?.query?.search ?? [];
        for (const hit of hits.slice(0, 2)) {
          const summary = await fetchJsonWithTimeout<{
            title?: string;
            thumbnail?: { source?: string; width?: number; height?: number };
            originalimage?: { source?: string };
            content_urls?: { desktop?: { page?: string } };
          }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`, 3500);
          const thumb = summary?.thumbnail?.source;
          const orig = summary?.originalimage?.source || thumb;
          if (thumb && orig && !/\.svg(\?|$)/i.test(orig)) {
            addImage({
              id: `wiki-img-${hit.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
              type: 'image',
              title: summary?.title || hit.title,
              url: orig,
              thumbnailUrl: thumb,
              sourceName: 'Wikipedia',
              sourceUrl:
                summary?.content_urls?.desktop?.page ||
                `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/\s+/g, '_'))}`,
            });
          }
        }
      })()
    );

    // 2. Wikimedia Commons photographic images
    tasks.push(
      (async () => {
        const commons = await fetchJsonWithTimeout<{
          query?: {
            pages?: Record<
              string,
              {
                pageid: number;
                title: string;
                imageinfo?: {
                  url?: string;
                  thumburl?: string;
                  descriptionurl?: string;
                  mime?: string;
                  width?: number;
                  height?: number;
                }[];
              }
            >;
          };
        }>(
          `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(
            `${visualQuery} filetype:bitmap`
          )}&gsrlimit=6&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=640&format=json`,
          4000
        );
        const pages = Object.values(commons?.query?.pages ?? {});
        for (const page of pages) {
          const info = page.imageinfo?.[0];
          if (!info?.url || !info.mime) continue;
          if (!/^image\/(jpeg|png|webp)$/i.test(info.mime)) continue;
          if ((info.width ?? 0) < 280 || (info.height ?? 0) < 180) continue;
          if (/logo|icon|flag|coat_of_arms|map_of/i.test(page.title)) continue;
          addImage({
            id: `commons-img-${page.pageid}`,
            type: 'image',
            title: cleanCommonsTitle(page.title) || visualQuery,
            url: info.thumburl || info.url,
            thumbnailUrl: info.thumburl || info.url,
            sourceName: 'Wikimedia Commons',
            sourceUrl: info.descriptionurl || info.url,
          });
          if (fetchedImages.length >= 4) break;
        }
      })()
    );

    // 3. YouTube live video search (embeddable via youtube-nocookie.com)
    tasks.push(
      (async () => {
        const ytQuery = buildVideoSearchQuery(prompt, history, visualQuery);
        const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(ytQuery)}`;
        let html = await fetchTextWithTimeout(ytUrl, 6500);
        if (!html) {
          html = await fetchTextWithTimeout(ytUrl, 6500);
        }
        if (!html) return;
        const videoRegex =
          /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"[\s\S]{0,1400}?"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])+)"\}/g;
        const matches = html.matchAll(videoRegex);
        let count = 0;
        const seenVids = new Set<string>();
        for (const m of matches) {
          const vid = m[1];
          const rawTitle = m[2];
          if (!vid || !rawTitle || seenVids.has(vid)) continue;
          seenVids.add(vid);
          const title = decodeJsonString(rawTitle).trim();
          addVideo({
            id: `yt-${vid}`,
            type: 'video',
            title: title || `${visualQuery} video`,
            url: `https://www.youtube.com/watch?v=${vid}`,
            embedUrl: `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0`,
            thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            sourceName: 'YouTube',
            sourceUrl: `https://www.youtube.com/watch?v=${vid}`,
          });
          count += 1;
          if (count >= 2) break;
        }
      })()
    );
  }

  await Promise.allSettled(tasks);

  // Fallback to Wikimedia Commons native video if user asked for videos and YouTube yielded none
  if (wantsVideos && fetchedVideos.length === 0) {
    const commonsVid = await fetchJsonWithTimeout<{
      query?: {
        pages?: Record<
          string,
          {
            pageid: number;
            title: string;
            imageinfo?: {
              url?: string;
              thumburl?: string;
              descriptionurl?: string;
              mime?: string;
            }[];
          }
        >;
      };
    }>(
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(
        `${visualQuery} filetype:video`
      )}&gsrlimit=3&prop=imageinfo&iiprop=url|mime&iiurlwidth=480&format=json`,
      3800
    );
    const pages = Object.values(commonsVid?.query?.pages ?? {});
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info?.url || !info.mime || !/^video\/(webm|mp4)$/i.test(info.mime)) continue;
      addVideo({
        id: `commons-vid-${page.pageid}`,
        type: 'video',
        title: cleanCommonsTitle(page.title) || visualQuery,
        url: info.url,
        thumbnailUrl: info.thumburl,
        sourceName: 'Wikimedia Commons',
        sourceUrl: info.descriptionurl || info.url,
        mimeType: info.mime,
      });
      if (fetchedVideos.length >= 2) break;
    }
  }

  const directImages = directMedia.filter((m) => m.type === 'image');
  const directVideos = directMedia.filter((m) => m.type === 'video');
  const finalImages = [...directImages, ...fetchedImages].slice(0, wantsImages ? 4 : 3);
  const finalVideos = [...directVideos, ...fetchedVideos].slice(0, wantsVideos ? 2 : 1);

  return wantsVideos ? [...finalVideos, ...finalImages] : [...finalImages, ...finalVideos];
}

function normalizeHistory(rawHistory: unknown): HistoryMessage[] {
  if (!Array.isArray(rawHistory)) return [];
  const valid = rawHistory
    .filter(
      (item): item is HistoryMessage =>
        Boolean(item) &&
        typeof item === 'object' &&
        ((item as HistoryMessage).role === 'user' || (item as HistoryMessage).role === 'model') &&
        typeof (item as HistoryMessage).text === 'string' &&
        (item as HistoryMessage).text.trim().length > 0
    )
    .slice(-100);

  // Ensure valid alternating user/model turns ending with 'model' before appending the new user prompt
  const merged: HistoryMessage[] = [];
  for (const msg of valid) {
    const text = msg.text.trim();
    if (merged.length === 0 && msg.role !== 'user') continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.text = `${prev.text}\n\n${text}`;
    } else {
      merged.push({ role: msg.role, text });
    }
  }
  return merged;
}

function buildContextualQuery(prompt: string, history: HistoryMessage[]): string {
  const userTurns = history.filter((m) => m.role === 'user').map((m) => m.text.trim());
  if (userTurns.length === 0) return prompt;
  const hasExplicitFollowUpCue =
    /\b(it|its|they|them|their|that|this|there|those|these|same|above|earlier|previous|before|tomorrow|tonight|next|instead|what about|how about|and in|and for)\b/i.test(
      prompt
    );
  const hasOwnSubject = stripVisualFiller(prompt).length >= 2;
  if (!hasExplicitFollowUpCue && hasOwnSubject) {
    return prompt;
  }
  const lastTopic = userTurns[userTurns.length - 1];
  return `${prompt} ${lastTopic}`.slice(0, 280);
}

async function fetchLiveWebContext(
  prompt: string,
  history: HistoryMessage[] = []
): Promise<{
  snippets: string[];
  sources: GroundingSource[];
}> {
  const snippets: string[] = [];
  const sources: GroundingSource[] = [];
  const seenUris = new Set<string>();
  const addSource = (title: string, uri: string) => {
    if (!uri || seenUris.has(uri)) return;
    seenUris.add(uri);
    sources.push({ title, uri });
  };

  const contextualPrompt = buildContextualQuery(prompt, history);
  const lower = contextualPrompt.toLowerCase();
  const userHistoryTexts = history.filter((m) => m.role === 'user').map((m) => m.text);
  const wantsEarliest = /\b(first|earliest|initial|start|beginning)\b/i.test(prompt);
  const orderedUserHistory = wantsEarliest ? userHistoryTexts : [...userHistoryTexts].reverse();
  const tasks: Promise<void>[] = [];

  // 1. Live Weather via Open-Meteo
  if (/\b(weather|forecast|temperature|rain|raining|snow|humidity|wind|temp)\b/i.test(contextualPrompt)) {
    tasks.push(
      (async () => {
        const extractCity = (text: string) =>
          text
            .replace(
              /\b(what'?s|what|was|were|is|are|the|very|first|earliest|initial|last|current|today'?s|today|tomorrow|tonight|this|week|weekend|weather|forecast|temperature|temp|rain|raining|snow|snowing|sunny|cloudy|humid|humidity|wind|windy|outside|right|now|in|at|for|like|how|about|and|there|city|currency|pair|we|talked|check|tell|me|time)\b/gi,
              ' '
            )
            .replace(/[?.,!]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const historyWeatherText =
          orderedUserHistory.find((t) => /\b(weather|forecast|temperature|rain|snow|temp)\b/i.test(t)) ||
          orderedUserHistory.find((t) => extractCity(t).length > 0) ||
          '';
        const cityQuery = extractCity(prompt) || extractCity(historyWeatherText) || 'Tokyo';
        const geo = await fetchJsonWithTimeout<{
          results?: { name: string; country?: string; latitude: number; longitude: number; timezone?: string }[];
        }>(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityQuery)}&count=1`
        );
        const place = geo?.results?.[0];
        if (!place) return;
        const forecast = await fetchJsonWithTimeout<{
          current?: {
            time: string;
            temperature_2m: number;
            apparent_temperature?: number;
            relative_humidity_2m?: number;
            wind_speed_10m?: number;
            weather_code?: number;
          };
          daily?: {
            time?: string[];
            temperature_2m_max?: number[];
            temperature_2m_min?: number[];
          };
        }>(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`
        );
        const cur = forecast?.current;
        if (!cur) return;
        const cond = WEATHER_CODE_LABELS[cur.weather_code ?? -1] || 'Conditions observed';
        const dailySummary = (forecast?.daily?.time ?? [])
          .map((dateStr, idx) => {
            const hi = forecast?.daily?.temperature_2m_max?.[idx];
            const lo = forecast?.daily?.temperature_2m_min?.[idx];
            return hi !== undefined && lo !== undefined ? `${dateStr}: ${lo}°C–${hi}°C` : '';
          })
          .filter(Boolean)
          .join('; ');
        snippets.push(
          `Live Open-Meteo weather for ${place.name}${place.country ? `, ${place.country}` : ''} (current ${cur.time}): ${cond}, ${cur.temperature_2m}°C (feels like ${cur.apparent_temperature ?? cur.temperature_2m}°C), humidity ${cur.relative_humidity_2m ?? '—'}%, wind ${cur.wind_speed_10m ?? '—'} km/h.${
            dailySummary ? ` Multi-day range: ${dailySummary}.` : ''
          }`
        );
        addSource(`Open-Meteo Live Weather · ${place.name}`, 'https://open-meteo.com/');
      })()
    );
  }

  // 2. Live Exchange Rates via Frankfurter (ECB)
  const promptCurrencies =
    prompt.toUpperCase().match(/\b(USD|EUR|GBP|JPY|SGD|AUD|CAD|CHF|CNY|KRW|INR|MYR|THB|HKD|NZD)\b/g) ?? [];
  const contextCurrencies =
    contextualPrompt
      .toUpperCase()
      .match(/\b(USD|EUR|GBP|JPY|SGD|AUD|CAD|CHF|CNY|KRW|INR|MYR|THB|HKD|NZD)\b/g) ?? [];
  const currencyCodes = Array.from(new Set([...contextCurrencies, ...promptCurrencies]));
  if (
    currencyCodes.length >= 2 ||
    (currencyCodes.length >= 1 && /\b(exchange rate|convert|fx|currency|what about|in)\b/i.test(contextualPrompt))
  ) {
    const base = currencyCodes[0] || 'USD';
    const target =
      currencyCodes.length >= 2 ? currencyCodes[currencyCodes.length - 1] : base === 'EUR' ? 'USD' : 'EUR';
    if (base !== target) {
      tasks.push(
        (async () => {
          const fx = await fetchJsonWithTimeout<{
            amount: number;
            base: string;
            date: string;
            rates?: Record<string, number>;
          }>(`https://api.frankfurter.app/latest?from=${base}&to=${target}`);
          const rate = fx?.rates?.[target];
          if (rate === undefined) return;
          snippets.push(
            `Live ECB exchange rate via Frankfurter (published ${fx?.date}): 1 ${base} = ${rate} ${target}.`
          );
          addSource(`Frankfurter ECB Exchange Rates (${base}/${target})`, 'https://www.frankfurter.app/');
        })()
      );
    }
  }

  // 3. Live World Clock
  if (/\b(time|clock|timezone)\b/i.test(contextualPrompt)) {
    const matchedCity = Object.keys(CITY_TIMEZONES).find((c) => lower.includes(c));
    const tz = matchedCity ? CITY_TIMEZONES[matchedCity] : 'UTC';
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(now);
    snippets.push(`Live clock (${tz}): ${formatted}.`);
  }

  // 4. Wikipedia Search & REST Summary + DuckDuckGo Instant Answer
  const searchQuery = contextualPrompt;
  tasks.push(
    (async () => {
      const searchData = await fetchJsonWithTimeout<{
        query?: { search?: { title: string; snippet?: string }[] };
      }>(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          searchQuery
        )}&format=json&srlimit=3`
      );
      const hits = searchData?.query?.search ?? [];
      for (const hit of hits.slice(0, 2)) {
        const summary = await fetchJsonWithTimeout<{
          title?: string;
          extract?: string;
          content_urls?: { desktop?: { page?: string } };
        }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);
        const pageUrl =
          summary?.content_urls?.desktop?.page ||
          `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/\s+/g, '_'))}`;
        const text = summary?.extract || hit.snippet?.replace(/<[^>]+>/g, '') || '';
        if (text) {
          snippets.push(`Wikipedia (${summary?.title || hit.title}): ${text.slice(0, 700)}`);
          addSource(`${summary?.title || hit.title} — Wikipedia`, pageUrl);
        }
      }
    })(),
    (async () => {
      const ddg = await fetchJsonWithTimeout<{
        Heading?: string;
        AbstractText?: string;
        AbstractURL?: string;
        AbstractSource?: string;
      }>(`https://api.duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json&no_html=1`);
      if (ddg?.AbstractText && ddg?.AbstractURL) {
        snippets.push(`DuckDuckGo (${ddg.AbstractSource || ddg.Heading || 'Web'}): ${ddg.AbstractText}`);
        addSource(ddg.Heading || ddg.AbstractSource || 'DuckDuckGo Reference', ddg.AbstractURL);
      }
    })()
  );

  await Promise.allSettled(tasks);
  return { snippets, sources };
}

const NO_WS_VITE_CLIENT = `
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay {}
`;

async function startServer() {
  const app = express();
  const isDev = process.env.NODE_ENV !== 'production';
  const port = isDev ? 3000 : Number(process.env.PORT) || 3000;
  const httpServer = http.createServer(app);

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/agent/check', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    const body = (req.body ?? {}) as {
      prompt?: unknown;
      history?: unknown;
      taskContext?: unknown;
    };

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ error: 'Please enter a question or quick check prompt.' });
      return;
    }

    const history = normalizeHistory(body.history);

    const taskContext =
      typeof body.taskContext === 'string' && body.taskContext.trim().length > 0
        ? body.taskContext.trim().slice(0, 1500)
        : '';

    const systemInstructionParts = [
      'You are buh Lookup, a lightweight, accurate assistant built into a personal productivity app.',
      'Always read and use the full conversation history in this chat to resolve follow-up questions, pronouns ("it", "there", "that"), comparisons, and references to earlier answers or user prompts.',
      'Use live Google Search grounding or provided live web context whenever facts, current events, weather, exchange rates, schedules, product specs, or local/live web data are involved.',
      'The buh Lookup UI automatically embeds relevant web images and playable videos right beneath your answer whenever visual topics, places, products, or media requests come up. Never claim that you cannot show images or videos—answer helpfully and concisely while the media renders below.',
      'Keep answers concise, direct, and easy to scan on a phone screen: lead with the direct answer in 1-2 sentences, followed by at most 3-4 brief bullet points if helpful.',
      'Never fabricate URLs or live figures; rely strictly on verified Google Search results, provided live web data, or facts already established in the conversation.',
    ];

    if (taskContext) {
      systemInstructionParts.push(
        `The user also shared their current buh agenda for context:\n${taskContext}`
      );
    }

    const baseHistory =
      history.length > 0 && history[history.length - 1].role === 'user'
        ? history.slice(0, -1)
        : history;

    const contents = [
      ...baseHistory.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      })),
      {
        role: 'user' as const,
        parts: [{ text: prompt }],
      },
    ];

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      // Kick off embedded image & video lookup in parallel with Gemini generation
      const mediaPromise = fetchEmbeddedMedia(prompt, baseHistory);

      const candidateModels = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const;
      let response;
      let usedModel: string = candidateModels[0];
      let lastError: unknown = null;
      let fallbackSources: GroundingSource[] = [];
      let usedLiveWebFallback = false;
      let hitSearchQuota429 = false;

      for (const modelName of candidateModels) {
        try {
          usedModel = modelName;
          response = await ai.models.generateContent({
            model: modelName,
            contents,
            config: {
              systemInstruction: systemInstructionParts.join('\n\n'),
              tools: [{ googleSearch: {} }],
            },
          });
          lastError = null;
          break;
        } catch (err: unknown) {
          lastError = err;
          const errObj = err as { status?: number; message?: string };
          console.warn(
            `Lookup attempt with ${modelName} (googleSearch) failed (${errObj?.status ?? 'unknown'}):`,
            errObj?.message
          );
          if (errObj?.status === 429) {
            hitSearchQuota429 = true;
            break;
          }
          if (errObj?.status !== 404 && errObj?.status !== 503) {
            throw err;
          }
        }
      }

      // If Google Search grounding hit 429 on free-tier key (or transient 503), retrieve real live web data server-side
      // and synthesize with lightweight Gemini models directly.
      const lastStatus = (lastError as { status?: number })?.status;
      if (!response && (hitSearchQuota429 || lastStatus === 429 || lastStatus === 503)) {
        const liveData = await fetchLiveWebContext(prompt, baseHistory);
        const nowIso = new Date().toISOString();
        const liveContextBlock =
          liveData.snippets.length > 0
            ? `Current UTC time: ${nowIso}\n\nVerified live web context:\n${liveData.snippets.join('\n\n')}`
            : `Current UTC time: ${nowIso}\nNote: Live web search snippets were unavailable for this specific query; use the full conversation history and verified known facts, and clearly note if real-time data could not be retrieved.`;

        const fallbackContents = [
          ...baseHistory.map((m) => ({
            role: m.role,
            parts: [{ text: m.text }],
          })),
          {
            role: 'user' as const,
            parts: [{ text: `${liveContextBlock}\n\nUser question: ${prompt}` }],
          },
        ];

        const retryDelaysMs = [600, 1400];
        for (const modelName of candidateModels) {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              usedModel = modelName;
              response = await ai.models.generateContent({
                model: modelName,
                contents: fallbackContents,
                config: {
                  systemInstruction: systemInstructionParts.join('\n\n'),
                },
              });
              lastError = null;
              break;
            } catch (err: unknown) {
              lastError = err;
              const errObj = err as { status?: number; message?: string };
              console.warn(
                `Lookup fallback with ${modelName} (attempt ${attempt + 1}) failed (${errObj?.status ?? 'unknown'}):`,
                errObj?.message
              );
              if (errObj?.status === 503 && attempt < retryDelaysMs.length) {
                await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
                continue;
              }
              break;
            }
          }
          if (response) break;
        }

        if (!response && lastError) {
          throw lastError;
        }

        fallbackSources = liveData.sources;
        usedLiveWebFallback = true;
      } else if (!response && lastError) {
        throw lastError;
      }

      const answer = response?.text?.trim() || '';
      const metadata = response?.candidates?.[0]?.groundingMetadata;
      const rawChunks = metadata?.groundingChunks ?? [];

      const seenUris = new Set<string>();
      const sources: GroundingSource[] = [...fallbackSources];
      for (const s of fallbackSources) seenUris.add(s.uri);

      for (const chunk of rawChunks) {
        const uri = chunk.web?.uri;
        if (!uri || seenUris.has(uri)) continue;
        seenUris.add(uri);
        sources.push({
          title: chunk.web?.title?.trim() || uri,
          uri,
        });
      }

      const webSearchQueries = Array.isArray(metadata?.webSearchQueries)
        ? metadata.webSearchQueries.filter((q): q is string => typeof q === 'string' && q.length > 0)
        : usedLiveWebFallback
          ? [prompt]
          : [];

      if (!answer) {
        res.status(502).json({ error: 'Gemini returned an empty response. Please try again.' });
        return;
      }

      const fetchedMedia = await mediaPromise;
      const answerMedia = extractMediaFromText(answer);
      const seenMediaKeys = new Set<string>();
      const mergedImages: EmbeddedMediaItem[] = [];
      const mergedVideos: EmbeddedMediaItem[] = [];

      for (const item of [...fetchedMedia, ...answerMedia]) {
        const key = item.embedUrl || item.url;
        if (!key || seenMediaKeys.has(key)) continue;
        seenMediaKeys.add(key);
        if (item.type === 'image') {
          if (mergedImages.length < 4) mergedImages.push(item);
        } else if (mergedVideos.length < 3) {
          mergedVideos.push(item);
        }
      }

      const wantsVideosFirst = /\b(video|videos|clip|clips|watch|youtube|trailer|review|hands[- ]?on|tutorial|vlog|tour)\b/i.test(
        prompt
      );
      const media: EmbeddedMediaItem[] = wantsVideosFirst
        ? [...mergedVideos, ...mergedImages]
        : [...mergedImages, ...mergedVideos];

      res.json({
        answer,
        sources,
        webSearchQueries,
        media,
        model: usedModel,
      });
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      const status = typeof e?.status === 'number' && e.status >= 400 && e.status < 600 ? e.status : 500;
      let rawMessage = e?.message || 'Failed to complete live web check with Gemini.';
      try {
        const parsed = JSON.parse(rawMessage) as { error?: { message?: string } };
        if (parsed?.error?.message) {
          rawMessage = parsed.error.message;
        }
      } catch {
        // Keep plain string message
      }
      let friendlyMessage = rawMessage;
      if (status === 429 || rawMessage.includes('RESOURCE_EXHAUSTED')) {
        friendlyMessage =
          'Gemini API quota exceeded (429 RESOURCE_EXHAUSTED) on the current API key. Wait for the quota window to reset or select a billing-enabled API key in AI Studio Settings > Secrets.';
      } else if (status === 503) {
        friendlyMessage = 'Gemini is experiencing a brief demand spike (503). Please try again in a moment.';
      }
      console.error('Gemini quick check error:', err);
      res.status(status).json({ error: friendlyMessage });
    }
  });

  // Pure-Node ZIP archive export of clean project source files (no secrets, node_modules, or build output)
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c >>> 0;
  }

  const computeCrc32 = (buf: Buffer): number => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const buildZipBuffer = (entries: { name: string; data: Buffer }[]): Buffer => {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBuf = Buffer.from(entry.name, 'utf8');
      const raw = entry.data;
      const compressed = zlib.deflateRawSync(raw, { level: 6 });
      const crc = computeCrc32(raw);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4); // version needed
      localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
      localHeader.writeUInt16LE(8, 8); // Deflate compression
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(compressed.length, 18);
      localHeader.writeUInt32LE(raw.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);

      localParts.push(localHeader, nameBuf, compressed);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4); // version made by
      centralHeader.writeUInt16LE(20, 6); // version needed
      centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
      centralHeader.writeUInt16LE(8, 10); // Deflate
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt16LE(0, 14);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(compressed.length, 20);
      centralHeader.writeUInt32LE(raw.length, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);

      centralParts.push(centralHeader, nameBuf);
      offset += localHeader.length + nameBuf.length + compressed.length;
    }

    const centralDir = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDir, eocd]);
  };

  app.get('/api/export/source', (_req, res) => {
    try {
      const rootDir = __dirname;
      const rootFiles = [
        'index.html',
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'server.ts',
        'metadata.json',
        'firebase-applet-config.json',
        '.env.example',
        '.gitignore',
      ];
      const files: { name: string; data: Buffer }[] = [];

      for (const rel of rootFiles) {
        const full = path.join(rootDir, rel);
        if (fs.existsSync(full) && fs.lstatSync(full).isFile()) {
          files.push({ name: `buh-source/${rel}`, data: fs.readFileSync(full) });
        }
      }

      const walkDir = (dirFull: string, relPrefix: string) => {
        if (!fs.existsSync(dirFull)) return;
        const items = fs.readdirSync(dirFull, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
          const nextFull = path.join(dirFull, item.name);
          const nextRel = `${relPrefix}/${item.name}`;
          if (item.isDirectory()) {
            walkDir(nextFull, nextRel);
          } else if (item.isFile()) {
            files.push({ name: `buh-source/${nextRel}`, data: fs.readFileSync(nextFull) });
          }
        }
      };

      walkDir(path.join(rootDir, 'src'), 'src');
      walkDir(path.join(rootDir, 'public'), 'public');

      const zipBuf = buildZipBuffer(files);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="buh-source.zip"');
      res.setHeader('Content-Length', String(zipBuf.length));
      res.send(zipBuf);
    } catch (err) {
      console.error('Source export failed:', err);
      res.status(500).json({ error: 'Failed to export source archive.' });
    }
  });

  if (isDev) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });

    if (hmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.send(NO_WS_VITE_CLIENT);
      });
    }

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          } else if (filePath.endsWith('sw.js') || filePath.endsWith('registerSW.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`buh server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
