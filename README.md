# Tampermonkey Scripts

個人用 Tampermonkey 使用者腳本集，針對社群媒體影片播放體驗進行增強。

## Scripts

### IG Video Control
**檔案：** `ig-video-control.js`
**適用：** https://www.instagram.com/*
**功能：**
- 在 Instagram 影片（貼文、Reel）加上全螢幕按鈕
- 自動取消靜音

### Facebook Video Control
**檔案：** `facebook-video-control.js`
**適用：** https://www.facebook.com/*
**功能：**
- 在 Facebook Reels 加上全螢幕控制器

## 安裝方式

### 手動安裝
1. 安裝 [Tampermonkey](https://www.tampermonkey.net/)
2. 點擊下方連結，Tampermonkey 會自動偵測並提示安裝：
   - [IG Video Control](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/ig-video-control.js)
   - [Facebook Video Control](https://raw.githubusercontent.com/starjou/tampermonkey-scripts/main/facebook-video-control.js)

### 自動更新
腳本內含 `@updateURL`，Tampermonkey 會定期檢查版本並自動更新。
