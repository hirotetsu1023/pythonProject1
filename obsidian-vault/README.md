# Obsidian Vault（Claude連携用サンプル）

このフォルダは **ObsidianのVault** としてそのまま使えるサンプル構成です。
iPhoneのObsidianとGitHubで同期し、Claude Codeと会話した内容をノートとして振り返るために作られています。

## 使い方（かんたん）

1. このフォルダを専用のGitHubリポジトリ（例：`obsidian-vault`）に置く
2. iPhoneのObsidianで、そのリポジトリを「Git」プラグインでクローンする
3. Claudeに「今日の会話を `daily/` にまとめて」と頼む → Claudeがmdを書いてコミット
4. Obsidianを開くと自動pullでノートが降りてくる → 振り返れる ✅

## フォルダ構成

```
obsidian-vault/
├── README.md          … このファイル
├── daily/             … 日付ごとの会話ログ・その日の記録
├── topics/            … テーマ別のまとめノート
├── ideas/             … 思いつき・アイデアの断片
└── templates/         … ノートのテンプレート
    ├── daily.md
    └── conversation.md
```

## タグの使い方

ノートに以下のようなタグを付けておくと、Obsidian側で検索・グラフ表示しやすくなります。

- `#claude` … Claudeとの会話由来のノート
- `#振り返り` … 振り返り対象
- `#idea` … アイデア

## Claudeへの頼み方（例）

- 「さっきの会話を `daily/2026-07-20.md` にまとめて」
- 「このテーマを `topics/` に整理して、関連ノートにリンクを張って」
- 「今週の `daily/` を読んで、`topics/週次振り返り.md` を作って」
