//src/lib/mpeg7.ts
export interface AlbumMeta {
  title: string;
  artist: string;
  genre?: string;
  releaseDate?: string;
  production?: string;
  publisher?: string;
  copyright?: string;
  coverUrl?: string;
  siteUrl?: string;
}

export interface SongMeta {
  title: string;
  singer?: string;
  composer?: string;
  lyricist?: string;
  genre?: string;
  releaseDate?: string;
  production?: string;
  publisher?: string;
  copyright?: string;
  isrc?: string;
  cdTrackNo?: string;
  imageUrl?: string;
  siteUrl?: string;
}

export interface TrackMeta {
  title?: string;
  performer?: string;
  recordedAt?: string;
}

// Safe XML escaper without non-null assertions.
const esc = (s?: string): string => {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  };
  const input = s ?? '';
  return input.replace(/[&<>"]/g, ch => (map[ch] !== undefined ? map[ch] : ch));
};

export function mpeg7AlbumXML(a: AlbumMeta) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MPEG7 xmlns="urn:mpeg:mpeg7:schema:2001">
  <Description xsi:type="ContentEntityType" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <MultimediaContent xsi:type="ContentCollectionType">
      <ContentCollection>
        <CreationInformation>
          <Title>${esc(a.title)}</Title>
          <Creator><Role>AlbumArtist</Role><Name>${esc(a.artist)}</Name></Creator>
          ${a.genre ? `<Classification>${esc(a.genre)}</Classification>` : ``}
          ${a.releaseDate ? `<ReleaseInformation>${esc(a.releaseDate)}</ReleaseInformation>` : ``}
          ${a.production ? `<Production>${esc(a.production)}</Production>` : ``}
          ${a.publisher ? `<Publisher>${esc(a.publisher)}</Publisher>` : ``}
          ${a.copyright ? `<Rights>${esc(a.copyright)}</Rights>` : ``}
          ${a.siteUrl ? `<RelatedMaterial href="${esc(a.siteUrl)}"/>` : ``}
          ${a.coverUrl ? `<MediaLocator href="${esc(a.coverUrl)}"/>` : ``}
        </CreationInformation>
      </ContentCollection>
    </MultimediaContent>
  </Description>
</MPEG7>`;
}

export function mpeg7SongXML(s: SongMeta) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MPEG7 xmlns="urn:mpeg:mpeg7:schema:2001">
  <Description xsi:type="ContentEntityType" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <MultimediaContent xsi:type="ContentCollectionType">
      <ContentCollection>
        <CreationInformation>
          <Title>${esc(s.title)}</Title>
          <Creator><Role>SongArtist</Role><Name>${esc(s.singer)}</Name></Creator>
          ${s.composer ? `<Contributor><Role>Composer</Role><Name>${esc(s.composer)}</Name></Contributor>` : ``}
          ${s.lyricist ? `<Contributor><Role>Lyricist</Role><Name>${esc(s.lyricist)}</Name></Contributor>` : ``}
          ${s.genre ? `<Classification>${esc(s.genre)}</Classification>` : ``}
          ${s.releaseDate ? `<ReleaseInformation>${esc(s.releaseDate)}</ReleaseInformation>` : ``}
          ${s.production ? `<Production>${esc(s.production)}</Production>` : ``}
          ${s.publisher ? `<Publisher>${esc(s.publisher)}</Publisher>` : ``}
          ${s.copyright ? `<Rights>${esc(s.copyright)}</Rights>` : ``}
          ${s.isrc ? `<ISRC>${esc(s.isrc)}</ISRC>` : ``}
          ${s.cdTrackNo ? `<CDTrackNo>${esc(s.cdTrackNo)}</CDTrackNo>` : ``}
          ${s.imageUrl ? `<MediaLocator href="${esc(s.imageUrl)}"/>` : ``}
          ${s.siteUrl ? `<RelatedMaterial href="${esc(s.siteUrl)}"/>` : ``}
        </CreationInformation>
      </ContentCollection>
    </MultimediaContent>
  </Description>
</MPEG7>`;
}

export function mpeg7TrackXML(t: TrackMeta) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MPEG7 xmlns="urn:mpeg:mpeg7:schema:2001">
  <Description xsi:type="ContentEntityType" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <MultimediaContent xsi:type="ContentCollectionType">
      <ContentCollection>
        <CreationInformation>
          <Title>${esc(t.title)}</Title>
          <Creator><Role>TrackArtist</Role><Name>${esc(t.performer)}</Name></Creator>
          ${t.recordedAt ? `<Location>${esc(t.recordedAt)}</Location>` : ``}
        </CreationInformation>
      </ContentCollection>
    </MultimediaContent>
  </Description>
</MPEG7>`;
}

// --- XML → JSON helpers (add below existing exports) ---
export function decodeXmlBytes(xb: Uint8Array): string {
  if (xb.length >= 2 && xb[0] === 0xFF && xb[1] === 0xFE) return new TextDecoder("utf-16le").decode(xb);
  if (xb.length >= 2 && xb[0] === 0xFE && xb[1] === 0xFF) return new TextDecoder("utf-16be").decode(xb);
  if (xb.length >= 3 && xb[0] === 0xEF && xb[1] === 0xBB && xb[2] === 0xBF) return new TextDecoder("utf-8").decode(xb);
  if (xb.length >= 2 && xb[0] === 0x00) return new TextDecoder("utf-16be").decode(xb);
  if (xb.length >= 2 && xb[1] === 0x00) return new TextDecoder("utf-16le").decode(xb);
  return new TextDecoder("utf-8", { fatal: false }).decode(xb);
}

const pick = (xml: string, re: RegExp) => re.exec(xml)?.[1]?.trim();
const pickAttr = (xml: string, tagRE: RegExp, attr: string) => {
  const m = tagRE.exec(xml); if (!m) return;
  const t = m[0];
  const a = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i").exec(t);
  return a?.[1]?.trim();
};

// ------------------------------
// NEW: field lists + defaults
// ------------------------------
export const ALBUM_FIELDS: (keyof AlbumMeta)[] = [
  "title", "artist", "genre", "releaseDate", "production", "publisher", "copyright", "coverUrl", "siteUrl"
];

export const SONG_FIELDS: (keyof SongMeta)[] = [
  "title", "singer", "composer", "lyricist", "genre", "releaseDate", "production", "publisher", "copyright", "isrc", "cdTrackNo", "imageUrl", "siteUrl"
];

export const TRACK_FIELDS: (keyof TrackMeta)[] = [
  "title", "performer", "recordedAt"
];

export function albumDefaults(): AlbumMeta {
  return {
    title: "",
    artist: "",
    genre: "",
    releaseDate: "",
    production: "",
    publisher: "",
    copyright: "",
    coverUrl: "",
    siteUrl: ""
  };
}

export function songDefaults(): SongMeta {
  return {
    title: "",
    singer: "",
    composer: "",
    lyricist: "",
    genre: "",
    releaseDate: "",
    production: "",
    publisher: "",
    copyright: "",
    isrc: "",
    cdTrackNo: "",
    imageUrl: "",
    siteUrl: ""
  };
}

export function trackDefaults(): TrackMeta {
  return {
    title: "",
    performer: "",
    recordedAt: ""
  };
}

export function withAlbumDefaults(p?: Partial<AlbumMeta>): AlbumMeta {
  const base = albumDefaults();
  const src = p || {};
  for (const k of ALBUM_FIELDS) (base as any)[k] = (src as any)[k] ?? "";
  return base;
}

export function withSongDefaults(p?: Partial<SongMeta>): SongMeta {
  const base = songDefaults();
  const src = p || {};
  for (const k of SONG_FIELDS) (base as any)[k] = (src as any)[k] ?? "";
  return base;
}

export function withTrackDefaults(p?: Partial<TrackMeta>): TrackMeta {
  const base = trackDefaults();
  const src = p || {};
  for (const k of TRACK_FIELDS) (base as any)[k] = (src as any)[k] ?? "";
  return base;
}

// ------------------------------
// simple XML→JSON mappers
// return Partial<...>, and callers  wrap with
// withAlbumDefaults/withSongDefaults/withTrackDefaults.
// ------------------------------
export function mpeg7XmlToAlbum(xml: string): Partial<AlbumMeta> {
  // minimal, tag-name tolerant
  const get = (re: RegExp) => (xml.match(re)?.[1] ?? "").trim();
  return {
    title: get(/<Title>(.*?)<\/Title>/i),
    artist: get(/<Creator>.*?<Name>(.*?)<\/Name>.*?<\/Creator>/is),
    genre: get(/<Classification>(.*?)<\/Classification>/i),
    releaseDate: get(/<ReleaseInformation>(.*?)<\/ReleaseInformation>/i),
    production: get(/<Production>(.*?)<\/Production>/i),
    publisher: get(/<Publisher>(.*?)<\/Publisher>/i),
    copyright: get(/<Rights>(.*?)<\/Rights>/i),
    coverUrl: get(/<MediaLocator[^>]*href="([^"]*)"/i),
    siteUrl: get(/<RelatedMaterial[^>]*href="([^"]*)"/i),
  };
}

export function mpeg7XmlToSong(xml: string): Partial<SongMeta> {
  const get = (re: RegExp) => (xml.match(re)?.[1] ?? "").trim();
  return {
    title: get(/<Title>(.*?)<\/Title>/i),
    singer: get(/<Creator>.*?<Name>(.*?)<\/Name>.*?<\/Creator>/is),
    composer: get(/<Contributor>.*?<Role>Composer<\/Role>\s*<Name>(.*?)<\/Name>.*?<\/Contributor>/is),
    lyricist: get(/<Contributor>.*?<Role>Lyricist<\/Role>\s*<Name>(.*?)<\/Name>.*?<\/Contributor>/is),
    genre: get(/<Classification>(.*?)<\/Classification>/i),
    releaseDate: get(/<ReleaseInformation>(.*?)<\/ReleaseInformation>/i),
    production: get(/<Production>(.*?)<\/Production>/i),
    publisher: get(/<Publisher>(.*?)<\/Publisher>/i),
    copyright: get(/<Rights>(.*?)<\/Rights>/i),
    isrc: get(/<ISRC>(.*?)<\/ISRC>/i),
    cdTrackNo: get(/<CDTrackNo>(.*?)<\/CDTrackNo>/i),
    imageUrl: get(/<MediaLocator[^>]*href="([^"]*)"/i),
    siteUrl: get(/<RelatedMaterial[^>]*href="([^"]*)"/i),
  };
}

export function mpeg7XmlToTrack(xml: string): Partial<TrackMeta> {
  const get = (re: RegExp) => (xml.match(re)?.[1] ?? "").trim();
  return {
    title: get(/<Title>(.*?)<\/Title>/i),
    performer: get(/<Creator>.*?<Name>(.*?)<\/Name>.*?<\/Creator>/is),
    recordedAt: get(/<Location>(.*?)<\/Location>/i),
  };
}