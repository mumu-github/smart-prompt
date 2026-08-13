# Smart Prompt 图标资产规范

## 决定

Smart Prompt 的正式图标使用现有小人 `normal` 状态，不重新设计角色。

- 品牌图标源：`assets/brand/smart-prompt-icon-source.png`
- 生成脚本：`node scripts/generate-brand-icons.js`
- 验收脚本：`node scripts/check-brand-icons.js`
- 交互状态小人：继续使用 `assets/ui-ux/mascot-states/`、`apps/desktop-shell/src/assets/mascot-states/` 和 `prototypes/browser-extension/assets/mascot-states/`

品牌图标负责安装包、桌面应用、浏览器扩展、托盘和发布物识别；交互状态小人负责网页/桌面内的动作和表情。不要把状态小人临时替换成新的图标风格，因为会导致品牌和交互角色分裂。

## 渠道矩阵

| 渠道 | 使用文件 | 尺寸 | 备注 |
| --- | --- | --- | --- |
| 品牌源图 | `assets/brand/smart-prompt-icon-source.png` | 1254x1254 | 来自现有 `normal` 小人透明 PNG |
| 品牌通用 PNG | `assets/brand/smart-prompt-icon-{16,32,48,64,128,256,512,1024}.png` | 多尺寸 | 给 README、发布说明、后续站点 favicon/OG 复用 |
| Chrome/Edge 扩展 | `prototypes/browser-extension/assets/icons/icon-{16,32,48,128}.png` | 16/32/48/128 | 已接入 `manifest.icons` 与 `action.default_icon` |
| Tauri 桌面壳 | `apps/desktop-shell/src-tauri/icons/32x32.png` | 32 | Tauri bundle icon |
| Tauri 桌面壳 | `apps/desktop-shell/src-tauri/icons/128x128.png` | 128 | Tauri bundle icon |
| Tauri 桌面壳 | `apps/desktop-shell/src-tauri/icons/128x128@2x.png` | 256 | Tauri bundle icon |
| Tauri 桌面壳 | `apps/desktop-shell/src-tauri/icons/icon.png` | 512 | 高分屏/发布物通用 PNG |
| Windows 安装包 / exe | `apps/desktop-shell/src-tauri/icons/icon.ico` | 16/32/48/64/128/256 | 多 entry ICO |
| Windows 托盘 | `apps/desktop-shell/src-tauri/icons/tray.png` | 32 | 运行时 `TrayIconBuilder` 专用图；仍使用同一个小人，裁掉透明留白后放大到接近满格 |

## 更新流程

如果后续要调整图标，只允许替换源图后重新生成整套资产：

```powershell
node scripts\generate-brand-icons.js
node scripts\check-brand-icons.js
```

完成后再运行对应渠道测试：

```powershell
npm test --prefix prototypes\browser-extension
npm test --prefix apps\desktop-shell
```

## 约束

- 不要重新设计小人角色，因为用户已确认角色原型必须保持一致。
- 不要为浏览器扩展、桌面壳、托盘分别画不同角色，因为小尺寸渠道会出现品牌不一致；托盘只允许裁掉透明留白并放大小人本体。
- 不要把 prompt card 内的动作小人当作渠道图标替换源，因为动作状态是交互反馈，不是稳定品牌识别。
