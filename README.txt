Pirate Browser Facebook source page feature

Changed files:
- index.html
- main.js
- preload.js
- renderer.js

What it adds:
- A new FB button in the toolbar.
- Paste a Facebook post URL or use the current tab URL.
- The browser derives the likely Facebook page, profile, or group URL from common post URL formats.
- If the URL alone is not enough, it checks metadata from the loaded page.
- When a page URL is found, it is copied to the clipboard.
- Open reels from the detected page when Facebook exposes a direct reels URL.
- Show the existing detected-video download menu after you open/play a reel and the browser detects a downloadable stream.
- Forward media requests with the webview id so downloads attach to the correct tab.
- Scan the current page/player for direct video URLs when the network detector misses them.
- Watch page-side fetch, XHR, resource, and video element URLs for playable media.
- Add DASH .mpd detection and FFmpeg downloading for HLS/DASH manifests.
- Parse Facebook fbcdn.net efg metadata to group by xpv_asset_id.
- Prefer progressive Facebook MP4 URLs and hide chunk/audio-only noise in the download menu.
- Label Facebook streams from real metadata like 720p instead of random URL numbers.
- Show one best Download button instead of a debug list of every detected stream.

This feature does not crawl or bulk-scrape Facebook. It only helps you open the reels area and download videos that the browser detects while you view them, where you have permission to save the content. It cannot bypass DRM/protected playback or reconstruct encrypted streams.
