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
