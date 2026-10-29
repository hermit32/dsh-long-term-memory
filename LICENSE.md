# Licensing

This package is a **collection** of components with different origins. There is
no single copyright holder for the whole tree.

## Component map

| Path | License | Copyright |
| --- | --- | --- |
| `plugins/memory/lib`, `bin`, `test`, `docs`, `examples`, `cordis.patch.yml` | MIT | upstream `dsh-memory`: Copyright (c) 2026 dsh-memory contributors; local modifications: see below |
| `plugins/memory/LICENSE` | MIT (verbatim) | Copyright (c) 2026 dsh-memory contributors |
| `plugins/session-manager/src`, `locale`, `test`, `icon.svg`, `cordis.patch.yml` | MIT | Copyright (c) 2026 liuyu-f; Copyright (c) 2026 lsz-asd |
| `plugins/session-manager/LICENSE` | MIT (verbatim) | as above |
| `scripts/notify/**`, `examples/**`, `tests/**`, `review/**`, `.gitignore`, `README.md`, `INSTALL.md`, `ARCHITECTURE.md`, `STATUS.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE.md` | MIT | Copyright (c) 2026 miyouchen52-bot |

> 可选组件（推理强度滑块、公开行情 Skill）**不在本包内**，其许可证信息见
> `THIRD_PARTY_NOTICES.md` 第 6.1 节。它们不属于本包的许可范围。

## Local modifications

- `plugins/memory/` is a modified fork; the modification list is
  `plugins/memory/FORK-NOTES.md`.
- `plugins/session-manager/` is a modified copy; the modification list is at the
  top of its `README.md`.
- `scripts/notify/` is a modified copy of a local script: personal paths and the
  personal default `appExe` were removed, and `DSH_HOME` support was added. See
  `scripts/notify/README.md` §Known limitations.

## MIT text for original contributions

```text
MIT License

Copyright (c) 2026 miyouchen52-bot

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
```

> 原创文档及自编脚本使用以上署名；第三方组件请同时遵守各自目录中的原始 MIT LICENSE。

## What is not licensed by this package

- DeepSeek Harness itself (MIT, DeepSeek) is not included.
- `@xmanrui/dsh-im` (MIT, xmanrui) is not included.
- Any private memory data, session logs, IM credentials, or machine
  configuration from the deployment this package was derived from is **not**
  part of this package and is not licensed here.
