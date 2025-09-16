---
layout: default
title: IMAF Muxer / Demuxer
---

# IMAF Muxer / Demuxer

Pure TypeScript muxer/demuxer for ISO/IEC 23000-12 (IMAF) with MPEG-7 metadata utilities and minimal ISO-BMFF builders.

<p>
  <a href="https://blockchainadvisors.github.io/imaf-muxer/api/" class="btn btn-primary">API Reference</a>
  <a href="https://github.com/blockchainadvisors/imaf-muxer" class="btn">GitHub Repo</a>
</p>

## What it does
- **Mux** AAC/ADTS, MP3, WAV/PCM (SAOC experimental) + tx3g subtitles into `.imaf` (MP4)
- **Demux** streams, extract **MPEG-7** to JSON, convert **tx3g ⇄ SRT**
- Author/read **IMAF** groups/presets/rules (`grco/prco/ruco`)

## Quick start
```bash
# Mux
npx tsx scripts/mux-imaf.ts --out out.ima --in a.aac --in b.aac --meta meta/song.json

# Demux
npx tsx scripts/demux-imaf.ts --in out.ima --out-dir extracted/
````

## Links

* **API Docs:** [https://blockchainadvisors.github.io/imaf-muxer/api/](https://blockchainadvisors.github.io/imaf-muxer/api/)
* **Repository:** [https://github.com/blockchainadvisors/imaf-muxer](https://github.com/blockchainadvisors/imaf-muxer)
