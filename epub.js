/* EbookForge Web EPUB tools.
 * Independent implementation inspired by the MIT-licensed xteink-jp-epub-converter
 * by daikori (2026). See THIRD_PARTY_NOTICES.md.
 *
 * ZIP is handled locally with native Web Compression Streams. No upload or CDN.
 */
(function (global) {
  'use strict';
  const utf8 = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const MAX_ZIP_BYTES = 70 * 1024 * 1024;
  const MAX_UNCOMPRESSED = 160 * 1024 * 1024;
  const MAX_FILE_BYTES = 35 * 1024 * 1024;
  const MAX_ENTRIES = 6000;
  const MAX_OUTPUT_BYTES = 220 * 1024 * 1024;
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    crcTable[n] = c >>> 0;
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255];
    return (crc ^ 0xffffffff) >>> 0;
  }
  function checkRange(total, offset, size, where) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > total)
      throw new Error(`不正なZIP領域: ${where}`);
  }
  function readZIP(input, requireEpub = true) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b.length > MAX_ZIP_BYTES) throw new Error('EPUBは70MB以下にしてください。');
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--) {
      if (v.getUint32(p, true) === 0x06054b50 && p + 22 + v.getUint16(p + 20, true) === b.length) {
        eocd = p; break;
      }
    }
    if (eocd < 0) throw new Error('ZIP/EPUBの終端情報がありません。');
    if (v.getUint16(eocd + 4, true) !== 0 || v.getUint16(eocd + 6, true) !== 0)
      throw new Error('分割ZIPには対応していません。');
    const count = v.getUint16(eocd + 10, true);
    if (count !== v.getUint16(eocd + 8, true) || count > MAX_ENTRIES)
      throw new Error('ZIPエントリ数が不正または上限超過です。');
    const directorySize = v.getUint32(eocd + 12, true);
    const directoryOffset = v.getUint32(eocd + 16, true);
    if (directorySize === 0xffffffff || directoryOffset === 0xffffffff)
      throw new Error('ZIP64形式には未対応です。');
    checkRange(b.length, directoryOffset, directorySize, '中央ディレクトリ');
    let p = directoryOffset, uncompressedTotal = 0;
    const entries = [], seen = new Set();
    for (let i = 0; i < count; i++) {
      checkRange(b.length, p, 46, '中央ディレクトリ見出し');
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('中央ディレクトリが破損しています。');
      const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
      const crc = v.getUint32(p + 16, true);
      const packedSize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
      const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true), localOffset = v.getUint32(p + 42, true);
      checkRange(b.length, p, 46 + nameLen + extraLen + commentLen, '中央ディレクトリ名');
      if ((flags & 1) || ![0, 8].includes(method)) throw new Error('暗号化EPUBまたは未対応のZIP圧縮方式です。');
      if (packedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
        throw new Error('ZIP64形式には未対応です。');
      if (size > MAX_FILE_BYTES) throw new Error('EPUB内のファイルが大きすぎます。');
      uncompressedTotal += size;
      if (uncompressedTotal > MAX_UNCOMPRESSED) throw new Error('展開後のEPUBが160MBを超えます。');
      if (size > 1_000_000 && size > Math.max(packedSize, 1) * 1000)
        throw new Error('圧縮率が極端に高いファイルを検出しました。');
      const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
      if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || seen.has(name))
        throw new Error('ZIPに不正または重複したファイル名があります。');
      seen.add(name);
      checkRange(b.length, localOffset, 30, 'ローカルヘッダー');
      if (v.getUint32(localOffset, true) !== 0x04034b50) throw new Error('ZIPローカルヘッダーが破損しています。');
      const lName = v.getUint16(localOffset + 26, true), lExtra = v.getUint16(localOffset + 28, true);
      const dataPos = localOffset + 30 + lName + lExtra;
      checkRange(b.length, dataPos, packedSize, '圧縮データ');
      if (method !== v.getUint16(localOffset + 8, true)) throw new Error('ZIP圧縮方式が一致しません。');
      const localName = decoder.decode(b.subarray(localOffset + 30, localOffset + 30 + lName));
      if (localName !== name) throw new Error('ZIPファイル名が一致しません。');
      entries.push({ name, method, flags, crc, size,
        compressed: b.subarray(dataPos, dataPos + packedSize) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (p !== directoryOffset + directorySize) throw new Error('ZIP中央ディレクトリ長が不正です。');
    if (requireEpub && (!seen.has('META-INF/container.xml') || !seen.has('mimetype')))
      throw new Error('有効なEPUB構造が見つかりません。');
    return entries;
  }
  async function unpack(entry) {
    if (entry.size > MAX_FILE_BYTES) throw new Error('ZIPエントリが大きすぎます。');
    let bytes;
    if (entry.method === 0) bytes = entry.compressed;
    else {
      if (typeof DecompressionStream === 'undefined')
        throw new Error('このブラウザはEPUB解凍に対応していません。Safariを更新してください。');
      try {
        const stream = new Blob([entry.compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (err) {
        throw new Error(`圧縮データを展開できません: ${entry.name}`);
      }
    }
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc)
      throw new Error(`EPUB内部ファイルのチェックサムが一致しません: ${entry.name}`);
    return bytes;
  }
  async function packModified(name, bytes) {
    if (bytes.length > MAX_FILE_BYTES) throw new Error('変換後のファイルが大きすぎます。');
    let compressed = bytes, method = 0;
    if (name !== 'mimetype' && typeof CompressionStream !== 'undefined') {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const packed = new Uint8Array(await new Response(stream).arrayBuffer());
        if (packed.length < bytes.length) { compressed = packed; method = 8; }
      } catch (_) { /* store without compression */ }
    }
    return { name, method, flags: 0x0800, crc: crc32(bytes), size: bytes.length, compressed };
  }
  function writeZIP(entries) {
    if (entries.length > MAX_ENTRIES) throw new Error('ZIP内のファイル数が多すぎます。');
    const infos = entries.map(e => ({ ...e, nameBytes: utf8.encode(e.name) }));
    let localSize = 0, centralSize = 0;
    for (const e of infos) {
      if (e.nameBytes.length > 65535) throw new Error('ZIPファイル名が長すぎます。');
      localSize += 30 + e.nameBytes.length + e.compressed.length;
      centralSize += 46 + e.nameBytes.length;
    }
    const total = localSize + centralSize + 22;
    if (total > MAX_OUTPUT_BYTES) throw new Error('変換後のEPUBが220MBを超えます。');
    const b = new Uint8Array(total), v = new DataView(b.buffer);
    let p = 0, c = localSize;
    for (const e of infos) {
      const here = p, n = e.nameBytes.length;
      v.setUint32(p, 0x04034b50, true); v.setUint16(p + 4, 20, true);
      v.setUint16(p + 6, 0x0800, true); v.setUint16(p + 8, e.method, true);
      v.setUint32(p + 14, e.crc, true); v.setUint32(p + 18, e.compressed.length, true);
      v.setUint32(p + 22, e.size, true); v.setUint16(p + 26, n, true);
      p += 30; b.set(e.nameBytes, p); p += n;
      b.set(e.compressed, p); p += e.compressed.length;
      v.setUint32(c, 0x02014b50, true); v.setUint16(c + 4, 20, true);
      v.setUint16(c + 6, 20, true); v.setUint16(c + 8, 0x0800, true);
      v.setUint16(c + 10, e.method, true); v.setUint32(c + 16, e.crc, true);
      v.setUint32(c + 20, e.compressed.length, true); v.setUint32(c + 24, e.size, true);
      v.setUint16(c + 28, n, true); v.setUint32(c + 42, here, true);
      c += 46; b.set(e.nameBytes, c); c += n;
    }
    v.setUint32(c, 0x06054b50, true);
    v.setUint16(c + 8, infos.length, true); v.setUint16(c + 10, infos.length, true);
    v.setUint32(c + 12, centralSize, true); v.setUint32(c + 16, localSize, true);
    return b;
  }
  function localName(element) { return (element.localName || '').toLowerCase(); }
  function descendants(doc, local) {
    return Array.from(doc.getElementsByTagName('*')).filter(el => localName(el) === local);
  }
  function parseXML(text) {
    const dom = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (dom.getElementsByTagName('parsererror').length || localName(dom.documentElement) === 'parsererror')
      throw new Error('XML/XHTML構文が不正です。');
    return dom;
  }
  function rubyText(ruby) {
    const parts = [];
    let base = '';
    let hasRt = false;
    for (const node of Array.from(ruby.childNodes)) {
      if (node.nodeType === 1 && localName(node) === 'rt') {
        hasRt = true;
        const annotation = (node.textContent || '').trim();
        if (base) { parts.push(base + (annotation ? `（${annotation}）` : '')); base = ''; }
      } else if (node.nodeType === 1 && ['rp', 'rtc'].includes(localName(node))) {
        // Ignore ruby fallback parentheses and optional secondary annotations.
      } else base += node.textContent || '';
    }
    if (base) parts.push(base);
    return { value: parts.join(''), hasRt };
  }
  function isInside(node, tag) {
    for (let p = node.parentElement; p; p = p.parentElement) if (localName(p) === tag) return true;
    return false;
  }
  function onlyWhitespaceBetween(from, to) {
    for (let n = from.nextSibling; n && n !== to; n = n.nextSibling) {
      if (n.nodeType !== 3 || n.textContent.trim()) return false;
    }
    return true;
  }
  function rewriteDocument(text, options, counts) {
    if (!options.ruby && options.indent === 'none' && options.breaks === 'none') return text;
    const doc = parseXML(text);
    if (options.ruby) for (const ruby of descendants(doc, 'ruby').reverse()) {
      const data = rubyText(ruby);
      if (data.hasRt) {
        ruby.parentNode.replaceChild(doc.createTextNode(data.value), ruby);
        counts.ruby++;
      }
    }
    if (options.indent === 'old') for (const p of descendants(doc, 'p')) {
      if (!p.textContent.trim()) continue; // Do not change synthetic blank lines.
      if (p.firstElementChild && localName(p.firstElementChild) === 'span' &&
          !p.firstElementChild.attributes.length && !p.firstElementChild.childNodes.length) continue;
      const span = doc.createElementNS(p.namespaceURI, 'span');
      p.insertBefore(span, p.firstChild); counts.indent++;
    }
    if (options.indent === 'new') {
      // Only adjacent paragraphs with no attributes; leave ids/classes and other
      // structural elements untouched. This is deliberately conservative.
      for (const parent of descendants(doc, 'body').concat(descendants(doc, 'section'), descendants(doc, 'div'))) {
        let p = parent.firstElementChild;
        while (p) {
          if (localName(p) !== 'p' || p.attributes.length || !p.textContent.trim()) {
            p = p.nextElementSibling; continue;
          }
          let next = p.nextElementSibling;
          while (next && localName(next) === 'p' && !next.attributes.length &&
                 next.textContent.trim() && onlyWhitespaceBetween(p, next)) {
            const br = doc.createElementNS(p.namespaceURI, 'br');
            p.appendChild(br);
            while (next.firstChild) p.appendChild(next.firstChild);
            const after = next.nextElementSibling;
            parent.removeChild(next); counts.indent++;
            next = after;
          }
          p = next;
        }
      }
    }
    if (options.breaks !== 'none') {
      for (const br of descendants(doc, 'br')) {
        if (isInside(br, 'p')) continue;
        const parent = br.parentElement;
        if (!parent || !['body','div','section','article'].includes(localName(parent))) {
          counts.skippedBreaks++; continue;
        }
        const p = doc.createElementNS(br.namespaceURI, 'p');
        p.appendChild(doc.createTextNode(options.breaks === 'new' ? '　' : ' '));
        if (options.breaks === 'new') p.appendChild(doc.createElementNS(br.namespaceURI, 'br'));
        br.parentNode.replaceChild(p, br); counts.breaks++;
      }
    }
    return new XMLSerializer().serializeToString(doc);
  }
  async function optimize(fileBytes, options = {}, onProgress = () => {}) {
    const opt = {
      ruby: !!options.ruby,
      indent: ['none','old','new'].includes(options.indent) ? options.indent : 'none',
      breaks: ['none','old','new'].includes(options.breaks) ? options.breaks : 'none'
    };
    const entries = readZIP(fileBytes);
    const mimetype = entries.find(e => e.name === 'mimetype');
    const mimeBytes = await unpack(mimetype);
    if (new TextDecoder().decode(mimeBytes) !== 'application/epub+zip')
      throw new Error('mimetypeがEPUBではありません。');
    const counts = { files: 0, ruby: 0, indent: 0, breaks: 0, skippedBreaks: 0, warnings: [] };
    const output = [await packModified('mimetype', utf8.encode('application/epub+zip'))];
    const docs = entries.filter(e => /\.(xhtml|html|htm)$/i.test(e.name) && !e.name.endsWith('/'));
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.name === 'mimetype') continue;
      if (/\.(xhtml|html|htm)$/i.test(e.name) && !e.name.endsWith('/')) {
        try {
          const input = await unpack(e);
          const xml = decoder.decode(input);
          const fileCounts = { ruby: 0, indent: 0, breaks: 0, skippedBreaks: 0 };
          const transformed = rewriteDocument(xml, opt, fileCounts);
          if (transformed !== xml) output.push(await packModified(e.name, utf8.encode(transformed)));
          else output.push(e);
          for (const key of ['ruby','indent','breaks','skippedBreaks']) counts[key] += fileCounts[key];
          counts.files++;
        } catch (err) {
          // Do not silently skip or corrupt XHTML; abort the conversion.
          throw new Error(`${e.name}: ${err.message}`);
        }
      } else output.push(e);
      onProgress(i + 1, entries.length);
      if (i % 8 === 0) await new Promise(r => setTimeout(r, 0));
    }
    if (docs.length === 0) throw new Error('本文XHTMLがありません。');
    return { bytes: writeZIP(output), counts };
  }
  global.EbookForgeEpub = { crc32, readZIP, unpack, writeZIP, rewriteDocument, optimize };
})(typeof window !== 'undefined' ? window : globalThis);
