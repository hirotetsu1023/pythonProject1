# Google Chat → Markdown エクスポート (GAS)

指定した Google Chat スペースのメッセージを **期間指定** で取得し、**Markdown** に整形して
**Google Drive** にテキストファイルとして出力する Google Apps Script プロジェクトです。

取得した Markdown を Claude などに読み込ませて活用することを想定しています。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `appsscript.json` | GAS マニフェスト（OAuth スコープ / Advanced Service 定義） |
| `Code.gs` | メインロジック（取得・整形・出力） |

## セットアップ

### 1. GAS プロジェクトを用意

新規 Apps Script プロジェクトを作成し、`Code.gs` の内容を貼り付けます。

### 2. マニフェストを設定

エディタの「プロジェクトの設定」で **「appsscript.json」マニフェスト ファイルをエディタで表示する** を有効化し、
本リポジトリの `appsscript.json` の内容で置き換えます。

### 3. Advanced Services を有効化

左メニュー「サービス（＋）」から以下を追加します（`appsscript.json` にも記載済み）:

- **Google Chat API**（userSymbol: `Chat`）
- **People API**（userSymbol: `People`）… 送信者名の解決に使用（任意）

さらに [Google Cloud Console](https://console.cloud.google.com/) の紐付け先プロジェクトで
**Google Chat API** / **People API** を有効化してください。

### 4. 設定を編集

`Code.gs` 冒頭の `CONFIG` を書き換えます。

```javascript
const CONFIG = {
  SPACE_ID: 'spaces/AAQAy4I4rHE',   // 対象スペース
  START_TIME: null,                 // 例: '2026-01-01T00:00:00+09:00'（null = 全期間）
  END_TIME: null,                   // 例: '2026-01-31T23:59:59+09:00'
  PAGE_SIZE: 100,
  TIMEZONE: 'Asia/Tokyo',
  OUTPUT_FOLDER_ID: '',             // '' ならマイドライブ直下
  RESOLVE_SENDER_NAMES: true,       // 送信者を表示名に解決（失敗時はリソース ID）
};
```

## 使い方

| 関数 | 内容 |
| --- | --- |
| `testListMessages` | 疎通確認。先頭 20 件をログ出力するだけ（Drive 出力なし）。まず最初に実行して権限承認を通す。 |
| `exportChatToMarkdown` | 本番実行。期間フィルタ付きで全件取得 → Markdown 化 → Drive に保存し、URL をログ出力。 |

初回実行時に OAuth 認可ダイアログが出るので承認してください。

## 出力例

```markdown
# Google Chat エクスポート

- スペース: `spaces/AAQAy4I4rHE`
- 期間: 2026-01-01T00:00:00+09:00 〜 2026-01-31T23:59:59+09:00
- 取得件数: 42
- 出力日時: 2026-07-20 12:00:00

---

### 2026-01-05 10:30:00 — 山田 太郎

おはようございます。今日の議題です。

---
```

## 仕様メモ

- **期間フィルタ**は Chat API の `filter` パラメータ（`createTime > "..." AND createTime < "..."`）で実装。
  `START_TIME` / `END_TIME` は片方だけの指定も可能。
- **ページネーション**は `nextPageToken` を辿って全件取得。
- **送信者名**はデフォルトでリソース ID（`users/1234...`）表記。`RESOLVE_SENDER_NAMES: true` の場合は
  People API で表示名に解決を試み、権限不足・未取得時はリソース ID にフォールバックします。

## 注意点

- 会社 Workspace の管理者スコープ制限に引っかかる可能性があります（`chat.messages.readonly` /
  `directory.readonly` が組織ポリシーで制限されている場合、承認できないことがあります）。
- **ユーザー認証のみ**対応。サービスアカウントでの実行は非対応です。
- 送信者名の解決には Directory / People API の閲覧権限が必要です。不要なら
  `RESOLVE_SENDER_NAMES: false` にし、`appsscript.json` から `directory.readonly` /
  People API を外しても動作します。
