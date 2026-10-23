# Third-party acknowledgments

## xteink-jp-epub-converter

- Project: https://github.com/daikori/xteink-jp-epub-converter
- Author: daikori
- Copyright (c) 2026 daikori
- License: MIT
- Used as a **functional reference**, including EPUB ruby/paragraph/line-break
  compatibility ideas. The EbookForge Web implementation in `epub.js` is
  independently authored; no upstream source file was copied.

The reference project is licensed under the following terms:

MIT License

Copyright (c) 2026 daikori

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## PDF.js (optional runtime dependency)

- Mozilla PDF.js, version 3.11.174
- Source: https://github.com/mozilla/pdf.js
- License: Apache License, Version 2.0
- Loaded from cdnjs **only when PDF input is selected**; library source/binaries are not distributed in this ZIP.
- License text: https://www.apache.org/licenses/LICENSE-2.0

## node-unrar-js (optional runtime dependency)

- node-unrar-js, version 2.0.2
- Maintainer: Jianrong Yu and contributors
- Source: https://github.com/YuJianrong/node-unrar.js
- JavaScript library license: MIT
- WebAssembly is based on the official UnRAR sources, which have separate license restrictions; do not interpret the JavaScript MIT license as authorizing uses prohibited by UnRAR's upstream license.
- Loaded dynamically via esm.sh and jsDelivr **only when RAR or CBR is selected**; these third-party binary files are not redistributed in this ZIP.
- License details: https://github.com/YuJianrong/node-unrar.js/blob/master/LICENSE.md
