# Logo 与网站图标

本目录保留原始图片和生成脚本。使用项目已安装的 sharp，从项目根目录运行：

```sh
node logo/generate-brand-icons.mjs
```

脚本以自身位置解析路径，也可在本目录运行 `node generate-brand-icons.mjs`。

| 原图 | 输出 | 用途与尺寸 |
| --- | --- | --- |
| `logo.png` | `../public/icons/logo-128.png` | Header 图片，128×128 |
| `logo2.png` | `../public/icons/icon-{16,32,48}.png` | 网站图标，16×16、32×32、48×48 |
| `logo2.png` | `../public/favicon.ico` | 包含 16、32、48px PNG 的多尺寸 ICO |
| `logo2.png` | `../public/icons/apple-touch-icon.png` | Apple 触控图标，180×180 |
| `logo2.png` | `../public/icons/icon-{192,512}.png` | 网站应用图标，192×192、512×512 |

脚本同时生成 `../public/site.webmanifest`，声明网站应用图标。PNG 均通过 sharp 缩放并编码，ICO 封装 sharp 编码的 PNG。

原图不会被覆盖。输出文件为生成产物，不手工编辑；需要调整时修改脚本并重新运行。Header 通过 `/icons/logo-128.png` 引用图片，网站图标与 manifest 由根目录 `index.html` 引用。
